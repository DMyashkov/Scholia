// Supabase Edge Function: chat-with-rag
// Embeds user message, retrieves relevant chunks, calls OpenAI Chat, creates assistant message + citations.
// Supports 2-round retrieval for complex questions. Streams step progress as NDJSON.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const MATCH_CHUNKS_PER_QUERY = 12;
const MATCH_CHUNKS_PER_QUERY_ROUND2 = 10;
const MATCH_CHUNKS_MERGED_CAP = 45;
const ROUND2_QUERIES_CAP = 10;
const LAST_MESSAGES_COUNT = 10;

interface QuotePayload {
  snippet: string;
  pageId: string;
  ref?: number;
}

interface ChatResponse {
  content: string;
  quotes: QuotePayload[];
  title?: string;
}

interface QuoteOut {
  id: string;
  sourceId: string;
  pageId: string;
  snippet: string;
  pageTitle: string;
  pagePath: string;
  domain: string;
  pageUrl?: string;
  contextBefore?: string;
  contextAfter?: string;
}

interface DecomposeResult {
  queries: string[];
  needsSecondRound?: boolean;
  round2?: {
    extractionPrompt: string;
    queryInstructions: string;
  };
}

type ChunkRow = { id: string; page_id: string; content: string; page_title: string; page_path: string; source_domain: string; distance?: number };
type PageRow = { id: string; source_id: string; title: string | null; path: string; url: string };
type SourceRow = { id: string; domain: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const emit = async (obj: unknown) => {
    await writer.write(encoder.encode(JSON.stringify(obj) + '\n'));
  };

  const run = async () => {
  try {
    const body = (await req.json()) as {
      conversationId: string;
      userMessage: string;
      appendToMessageId?: string;
      indexedPageDisplay?: string;
      unfoldMode?: 'auto' | 'unfold' | 'direct';
    };
    const { conversationId, userMessage, appendToMessageId, indexedPageDisplay, unfoldMode = 'auto' } = body;
    if (!conversationId || !userMessage?.trim()) {
        await emit({ error: 'conversationId and userMessage required' });
        return;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
        await emit({ error: 'OPENAI_API_KEY secret not configured' });
        return;
    }

    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      await emit({ error: 'Authentication required' });
      return;
    }

    const { data: sources } = await supabase
      .from('sources')
      .select('id')
      .eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    const { data: pagesData, error: pagesError } =
      sourceIds.length > 0
        ? await supabase
            .from('pages')
            .select('id, source_id, title, path, url')
            .in('source_id', sourceIds)
            .eq('status', 'indexed')
        : { data: [] as PageRow[], error: null };
    const pages = (pagesData ?? []) as PageRow[];

    if (pagesError || !pages?.length) {
      const content = !pages?.length
        ? "I don't have any indexed sources for this conversation yet. Add a source and run a crawl, then ask again."
        : "I couldn't load the source pages. Please try again.";
      const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content,
      }).select('*');
      if (insertErr || !inserted?.length) {
          await emit({ error: insertErr?.message ?? 'Failed to save message' });
          return;
        }
        await emit({ done: true, message: inserted[0], quotes: [] });
        return;
    }

    const pageIds = pages.map((p) => p.id);
    const chunkShape = (c: ChunkRow) => `page_id: ${c.page_id}\n[${c.source_domain}${c.page_path}] ${c.page_title}\n${c.content}`;

      const { data: leadChunks = [] } = await supabase.rpc('get_lead_chunks', { match_page_ids: pageIds });
    const leadList = (leadChunks || []) as ChunkRow[];
    const leadIds = new Set(leadList.map((c) => c.id));

      // Decomposition with 2-round support
      let decomposeResult: DecomposeResult;
      try {
        decomposeResult = await decomposeAndReformulate(openaiKey, userMessage.trim());
      } catch (e) {
        console.warn('[RAG decomposition] failed:', e);
        decomposeResult = { queries: [userMessage.trim()] };
      }

      let { queries: searchQueries, needsSecondRound, round2 } = decomposeResult;

      // Apply unfoldMode overrides (decomposition always runs for reformulated queries)
      if (unfoldMode === 'direct') {
        needsSecondRound = false;
        round2 = undefined;
        console.log('[RAG-2ROUND] unfoldMode=direct: forcing single round');
      } else if (unfoldMode === 'unfold') {
        needsSecondRound = true;
        if (!round2) {
          round2 = {
            extractionPrompt: 'Extract key entities, topics, or items from the context that are relevant to answering the question. Output JSON: {"items": ["...", ...]}',
            queryInstructions: 'For each item, create a search query combining the item with the question to find supporting details.',
          };
          console.log('[RAG-2ROUND] unfoldMode=unfold: using generic round2 fallback');
        }
      }

      const totalSteps = needsSecondRound && round2 ? 3 : 2;

      console.log('[RAG-2ROUND] decomposition:', {
        unfoldMode,
        needsSecondRound,
        hasRound2: !!round2,
        queriesCount: searchQueries.length,
      });

      await emit({ step: 1, totalSteps, label: 'Gathering context' });

      const doRetrieve = async (queries: string[], perQuery = MATCH_CHUNKS_PER_QUERY) => {
        const embeddings = await embedBatch(openaiKey, queries);
        const chunkMap = new Map<string, ChunkRow>();
        for (let i = 0; i < embeddings.length; i++) {
          const { data: matchedChunks } = await supabase.rpc('match_chunks', {
            query_embedding: embeddings[i],
      match_page_ids: pageIds,
            match_count: perQuery,
          });
          const list = (matchedChunks || []) as ChunkRow[];
          for (const c of list) {
            const dist = (c as { distance?: number }).distance ?? 1;
            const existing = chunkMap.get(c.id);
            if (!existing || ((existing as { distance?: number }).distance ?? 1) > dist) {
              chunkMap.set(c.id, { ...c, distance: dist });
            }
          }
        }
        const matchedList = Array.from(chunkMap.values()).sort((a, b) => ((a as { distance?: number }).distance ?? 1) - ((b as { distance?: number }).distance ?? 1));
        return matchedList.slice(0, MATCH_CHUNKS_MERGED_CAP);
      };

      const cappedMatch = await doRetrieve(searchQueries);
      const combined: ChunkRow[] = [...leadList, ...cappedMatch.filter((c) => !leadIds.has(c.id))];
      let didSecondRound = false;

      if (needsSecondRound && round2 && combined.length > 0) {
        didSecondRound = true;
        console.log('[RAG-2ROUND] entering round 2');
        await emit({ step: 2, totalSteps, label: 'Extracting...' });

        const contextStr = combined.map(chunkShape).join('\n\n---\n\n');
        let extracted: Record<string, unknown> = {};
        try {
          extracted = await runExtraction(openaiKey, contextStr, round2.extractionPrompt);
        } catch (e) {
          console.warn('[RAG-2ROUND] extraction failed:', e);
        }

        const extractedKeys = Object.keys(extracted);
        console.log('[RAG-2ROUND] extraction:', { keyCount: extractedKeys.length, keys: extractedKeys });

        if (extractedKeys.length > 0) {
          const round2Queries = await buildRound2Queries(openaiKey, userMessage.trim(), extracted, round2.queryInstructions);
          console.log('[RAG-2ROUND] round2Queries:', round2Queries.length, round2Queries);
          if (round2Queries.length > 0) {
            const round2Match = await doRetrieve(round2Queries, MATCH_CHUNKS_PER_QUERY_ROUND2);
            const existingIds = new Set(combined.map((c) => c.id));
            for (const c of round2Match) {
              if (!existingIds.has(c.id)) {
                combined.push(c);
                existingIds.add(c.id);
              }
            }
          }
        } else {
          console.log('[RAG-2ROUND] skipped: extraction empty');
        }
      } else {
        if (needsSecondRound && !round2) console.log('[RAG-2ROUND] skipped: no round2 config');
        if (needsSecondRound && combined.length === 0) console.log('[RAG-2ROUND] skipped: no chunks');
      }

      console.log('[RAG-2ROUND] didSecondRound:', didSecondRound);

      await emit({ step: totalSteps, totalSteps, label: 'Answering' });

    if (combined.length === 0) {
        const noChunksMessage = "I don't have indexed source content to cite yet. The crawl may have finished but chunking/embeddings may still be running. Please try again in a moment.";
        const { data: inserted } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: noChunksMessage,
      }).select('*');
        await emit({ done: true, message: inserted?.[0] ?? { content: noChunksMessage }, quotes: [] });
        return;
    }

    const context = combined.map(chunkShape).join('\n\n---\n\n');
    const lastMessages = await getLastMessages(supabase, conversationId);
    const isFirstMessage = !appendToMessageId && lastMessages.length === 1;
    console.log('[RAG-TITLE] isFirstMessage=', isFirstMessage, 'lastMessages.length=', lastMessages.length, 'appendToMessageId=', appendToMessageId);
    const chatResult = await chat(openaiKey, context, lastMessages, userMessage.trim(), combined, isFirstMessage);

    const pageById = new Map<string, PageRow>(pages.map((p) => [p.id, p]));
    const { data: sourceRows } = await supabase
      .from('sources')
      .select('id, domain')
      .in('id', [...new Set(pages.map((p) => p.source_id))]);
    const sourceById = new Map<string, SourceRow>(((sourceRows || []) as SourceRow[]).map((s) => [s.id, s]));

    // Fetch full page content for quoted pages (to show richer context in sidebar)
    const quotedPageIds = [...new Set(chatResult.quotes.map((q) => q.pageId))];
    const { data: pagesWithContent = [] } = await supabase
      .from('pages')
      .select('id, content')
      .in('id', quotedPageIds);
    const pageContentById = new Map((pagesWithContent as { id: string; content: string | null }[]).map((p) => [p.id, p.content ?? '']));

    const PAGE_CONTEXT_CHARS = 350; // ~2–3 sentences before and after
    /** Find snippet in text; returns start index and length of actual match (for prefix matches, use matched length not snippet.length to avoid cutting mid-word) */
    const findSnippetInText = (text: string, snippet: string): { start: number; matchLen: number } | null => {
      const idx = text.indexOf(snippet);
      if (idx >= 0) return { start: idx, matchLen: snippet.length };
      for (const len of [80, 60, 40]) {
        if (snippet.length < len) continue;
        const prefix = snippet.slice(0, len);
        const i = text.indexOf(prefix);
        if (i >= 0) return { start: i, matchLen: prefix.length };
      }
      return null;
    };
    const getContextFromPage = (pageText: string, snippet: string, contextChars: number) => {
      const found = findSnippetInText(pageText, snippet);
      if (!found) return { contextBefore: '', contextAfter: '' };
      const { start: idx, matchLen } = found;
      // Omit "before" when snippet is at start (would be template/coordinate junk); omit "after" when at end
      const nearStart = idx < 80;
      const nearEnd = idx + matchLen > pageText.length - 80;
      const beforeStart = nearStart ? idx : Math.max(0, idx - contextChars);
      const afterEnd = nearEnd ? idx + matchLen : Math.min(pageText.length, idx + matchLen + contextChars);
      const before = pageText.slice(beforeStart, idx).replace(/^\s+/, '').trim();
      const after = pageText.slice(idx + matchLen, afterEnd).replace(/\s+$/, '').trim();
      return { contextBefore: before, contextAfter: after };
    };

    const quotesOut: QuoteOut[] = chatResult.quotes.map((q, i) => {
      const page = pageById.get(q.pageId);
      const source = page ? sourceById.get(page.source_id) : null;
      const pageContent = pageContentById.get(q.pageId);
      // Always use page content for context—every quote originates from page text. Chunks are just windows into it.
      const { contextBefore, contextAfter } = pageContent
        ? getContextFromPage(pageContent, q.snippet, PAGE_CONTEXT_CHARS)
        : { contextBefore: '', contextAfter: '' };
        const fullPageUrl = page?.url ?? null;
        let domain = '';
        if (fullPageUrl) {
          try {
            domain = new URL(fullPageUrl).hostname;
          } catch {
            domain = '';
          }
        }
        if (!domain) domain = source?.domain ?? '';
      return {
        id: `quote-${conversationId}-${i}-${Date.now()}`,
        sourceId: page?.source_id ?? '',
        pageId: q.pageId,
        snippet: q.snippet,
        pageTitle: page?.title ?? '',
        pagePath: page?.path ?? '',
          domain,
          ...(fullPageUrl ? { pageUrl: fullPageUrl } : {}),
        ...(contextBefore ? { contextBefore } : {}),
        ...(contextAfter ? { contextAfter } : {}),
      };
    });

    const { data: conv } = await supabase
      .from('conversations')
      .select('owner_id, dynamic_mode')
      .eq('id', conversationId)
      .single();
    if (!conv) {
      await emit({ error: 'Conversation not found' });
      return;
    }
    const ownerId = conv.owner_id;

    let logReason = '1 round';
    if (didSecondRound) logReason = '2 rounds (decomposition + extraction + round2 queries)';
    else if (decomposeResult?.needsSecondRound && !decomposeResult?.round2) logReason = 'decomposition said needsSecondRound but no round2 config';
    else if (decomposeResult?.needsSecondRound) logReason = 'decomposition said needsSecondRound but round 2 skipped (extraction empty or no queries)';

    let assistantRow: Record<string, unknown>;

    if (appendToMessageId) {
      // Insert new assistant message as follow-up (add-page + re-ask flow)
      // Clear suggested_page on the original message
      await supabase
        .from('messages')
        .update({ suggested_page: null })
        .eq('id', appendToMessageId);
      console.log('[RAG-2ROUND] inserting follow-up message:', { follows: appendToMessageId, indexedPageDisplay });
      const { data: insertedMsg, error: msgInsertErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: chatResult.content,
          owner_id: ownerId,
          was_multi_step: didSecondRound,
          follows_message_id: appendToMessageId,
          indexed_page_display: indexedPageDisplay ?? null,
        })
        .select('*');
      assistantRow = insertedMsg?.[0] as Record<string, unknown>;
      if (msgInsertErr || !assistantRow) {
        console.error('[RAG-2ROUND] follow-up message insert failed:', msgInsertErr);
        await emit({ error: msgInsertErr?.message ?? 'Failed to save message' });
        return;
      }
    } else {
      // Normal flow: insert new message
      console.log('[RAG-2ROUND] inserting message:', { was_multi_step: didSecondRound, reason: logReason });
      const { data: insertedMsg, error: msgInsertErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: chatResult.content,
          owner_id: ownerId,
          was_multi_step: didSecondRound,
        })
        .select('*');
      assistantRow = insertedMsg?.[0] as Record<string, unknown>;
      if (msgInsertErr || !assistantRow) {
        console.error('[RAG-2ROUND] message insert failed:', msgInsertErr);
        await emit({ error: msgInsertErr?.message ?? 'Failed to save message' });
        return;
      }
      const { data: updated } = await supabase
        .from('messages')
        .update({ was_multi_step: didSecondRound })
        .eq('id', assistantRow.id)
        .select('*')
        .single();
      if (updated) assistantRow = updated as Record<string, unknown>;
      console.log('[RAG-2ROUND] message inserted:', { id: assistantRow?.id });
    }

    if (quotesOut.length > 0) {
      for (const q of quotesOut) {
        await supabase.from('quotes').insert({
          message_id: assistantRow.id,
          page_id: q.pageId,
          snippet: q.snippet,
          page_title: q.pageTitle ?? '',
          page_path: q.pagePath ?? '',
          domain: q.domain ?? '',
          page_url: q.pageUrl ?? null,
          context_before: q.contextBefore ?? null,
          context_after: q.contextAfter ?? null,
          owner_id: ownerId,
        });
      }
    }

    // Page suggestion: only when answer indicates context doesn't include the info (skip when appending)
    let suggestedPage: { url: string; title: string; snippet: string; sourceId: string; promptedByQuestion?: string; fromPageTitle?: string; unfoldMode?: 'unfold' | 'direct' | 'auto' } | null = null;
    const cantAnswer = indicatesCantAnswer(chatResult.content);
    const dynamicMode = (conv as { dynamic_mode?: boolean } | null)?.dynamic_mode !== false;
    console.log('[RAG-SUGGEST] evaluating', JSON.stringify({ appendToMessageId, cantAnswer, dynamicMode, conversationId }));

    if (appendToMessageId) {
      console.log('[RAG-SUGGEST] no suggested page: appendToMessageId=true');
    } else if (!cantAnswer) {
      console.log('[RAG-SUGGEST] no suggested page: cantAnswer=false (model did not indicate lack of context)');
    } else if (!dynamicMode) {
      console.log('[RAG-SUGGEST] no suggested page: dynamicMode=false');
    } else {
      const { data: convSources } = await supabase
        .from('sources')
        .select('id')
        .eq('conversation_id', conversationId);
      const allSourceIds = (convSources || []).map((s: { id: string }) => s.id);
      if (allSourceIds.length === 0) {
        console.log('[RAG-SUGGEST] no suggested page: no sources for conversation', conversationId);
      } else {
        console.log('[RAG-SUGGEST] attempting suggestion: sourceIds=', allSourceIds.length, '| conversationId=', conversationId);
        try {
          const suggestionQueries = [
            ...searchQueries.slice(0, 3),
            ...(searchQueries.some((q) => q.toLowerCase().includes(userMessage.trim().toLowerCase().slice(0, 30))) ? [] : [userMessage.trim()]),
          ];
          const uniqueQueries = [...new Set(suggestionQueries)].slice(0, 4);
          const queryEmbs = await embedBatch(openaiKey, uniqueQueries);

          const matchMap = new Map<string, { m: { to_url: string; anchor_text: string | null; snippet: string; source_id: string; from_page_id: string | null }; distance: number }>();
          for (let i = 0; i < queryEmbs.length; i++) {
            const { data: matches, error: rpcErr } = await supabase.rpc('match_discovered_links', {
              query_embedding: queryEmbs[i],
              match_source_ids: allSourceIds,
              match_count: 12,
            });
            if (rpcErr) {
              console.log('[RAG-SUGGEST] match_discovered_links RPC error:', rpcErr.message, '| queryIndex:', i);
            }
            const list = (matches || []) as { to_url: string; anchor_text: string | null; snippet: string; source_id: string; from_page_id: string | null; distance: number }[];
            if (list.length === 0 && i === 0) {
              console.log('[RAG-SUGGEST] match_discovered_links returned 0 rows for first query | sourceIds:', allSourceIds.length);
            }
            for (const m of list) {
              const key = `${m.source_id}:${m.to_url}`;
              const dist = m.distance ?? 1;
              const existing = matchMap.get(key);
              if (!existing || existing.distance > dist) {
                matchMap.set(key, { m, distance: dist });
              }
            }
          }

          const sorted = Array.from(matchMap.values()).sort((a, b) => a.distance - b.distance);
          let list = sorted.map((x) => x.m);

          const terms = extractQueryTerms(userMessage.trim());
          if (terms.length > 0) {
            const { withMatch, withoutMatch } = partitionByTermMatch(list, terms);
            list = [...withMatch, ...withoutMatch];
          }

          const top = list[0];
          if (top) {
            let fromPageTitle: string | undefined;
            if (top.from_page_id) {
              const { data: fromPage } = await supabase.from('pages').select('title').eq('id', top.from_page_id).single();
              fromPageTitle = (fromPage as { title: string | null } | null)?.title ?? undefined;
            }
            suggestedPage = {
              url: top.to_url,
              title: top.anchor_text?.trim() || deriveTitleFromUrl(top.to_url),
              snippet: top.snippet,
              sourceId: top.source_id,
              promptedByQuestion: userMessage.trim(),
              fromPageTitle,
              unfoldMode: unfoldMode === 'unfold' || unfoldMode === 'direct' ? unfoldMode : 'auto',
            };
            console.log('[RAG-SUGGEST] suggested page set:', top.to_url);
          } else {
            console.log('[RAG-SUGGEST] no suggested page: match_discovered_links returned no non-indexed candidates | matchMapSize:', matchMap.size, '| sortedCount:', sorted.length);
          }
        } catch (e) {
          console.warn('[RAG-SUGGEST] match_discovered_links failed:', e);
        }
      }
    }

    if (suggestedPage) {
      await supabase
        .from('messages')
        .update({ suggested_page: suggestedPage as Record<string, unknown> })
        .eq('id', assistantRow.id);
    }

    let suggestedTitle: string | undefined;
    if (isFirstMessage && chatResult.title && typeof chatResult.title === 'string') {
      const t = String(chatResult.title).trim().slice(0, 80);
      if (t.length > 0) {
        suggestedTitle = t;
        const { data: convBefore } = await supabase.from('conversations').select('title').eq('id', conversationId).single();
        const previousTitle = (convBefore as { title?: string } | null)?.title ?? '(unknown)';
        const { error: updateErr } = await supabase.from('conversations').update({ title: suggestedTitle }).eq('id', conversationId);
        console.log('[RAG-TITLE] AI suggested title:', JSON.stringify(suggestedTitle), '| previous:', JSON.stringify(previousTitle), '| swapped:', previousTitle !== suggestedTitle, '| updateErr:', updateErr?.message ?? 'none');
      }
    } else {
      if (isFirstMessage) {
        console.log('[RAG-TITLE] First message but no title from AI; chatResult.title=', chatResult.title, '(type:', typeof chatResult.title, ')');
      }
    }

      await emit({ done: true, message: assistantRow, quotes: quotesOut, suggestedPage: suggestedPage ?? undefined, ...(suggestedTitle ? { suggestedTitle } : {}) });
  } catch (e) {
    console.error(e);
      await emit({ error: (e as Error).message });
    } finally {
      await writer.close();
    }
  };

  run();

  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});

function indicatesCantAnswer(content: string): boolean {
  const lower = content.toLowerCase();
  const patterns = [
    /doesn't include|does not include|context does not|context doesn't/,
    /does not provide|doesn't provide|does not contain|doesn't contain/,
    /does not list|doesn't list|does not have|doesn't have/,
    /unable to (find|provide|list|answer)/,
    /i don't have|i do not have|i cannot find|i can't find/,
    /no (indexed |)(information|content|list|data) (in |)(the |)context/,
    /the (provided |)context does not/,
    /(the |)context (does not|doesn't) (include|contain|have|provide|list)/,
    /focuses exclusively on|mainly discusses|only (discusses|mentions|covers)/,
    /aside from|other than.*not (included|mentioned|listed)/,
    /not (available|mentioned|covered|included|found) (in |)(the |)context/,
    /(the |)context (only |)(includes|contains|covers|mentions)/,
    /cannot (find|provide|answer|determine)/,
    /is not (in |)(the |)context|not in the (provided |)context/,
    /limited to.*context|based (solely |)on the context/,
  ];
  return patterns.some((p) => p.test(lower));
}

function deriveTitleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathParts = u.pathname.split('/').filter(Boolean);
    const last = pathParts[pathParts.length - 1];
    if (last) return decodeURIComponent(last).replace(/_/g, ' ');
    return url;
  } catch {
    return url;
  }
}

/** Extract meaningful terms for re-ranking (skip stopwords) */
function extractQueryTerms(query: string): string[] {
  const stop = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'other', 'than', 'give', 'me', 'get', 'show', 'find']);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Partition: pages whose URL/anchor matches query terms go first (e.g. American_Quarter_Horse for "quarter horse") */
function partitionByTermMatch<T extends { to_url: string; anchor_text: string | null }>(
  list: T[],
  terms: string[]
): { withMatch: T[]; withoutMatch: T[] } {
  const withMatch: T[] = [];
  const withoutMatch: T[] = [];
  for (const m of list) {
    const urlNorm = (m.to_url + ' ' + (m.anchor_text || '') + ' ' + deriveTitleFromUrl(m.to_url)).toLowerCase().replace(/_/g, ' ');
    const matches = terms.some((term) => urlNorm.includes(term));
    if (matches) withMatch.push(m);
    else withoutMatch.push(m);
  }
  return { withMatch, withoutMatch };
}

async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

async function decomposeAndReformulate(apiKey: string, userMessage: string): Promise<DecomposeResult> {
  const sys = `Plan semantic search for a question over indexed documents.

Single-step: Use multiple queries to cover the question—e.g. ["achievements", "earnings"] for "What were X's achievements and earnings?". Most questions need only this.

Multi-step (unfold): Use when the question has a dependency—you must first retrieve info from the docs to reformulate the search. Example: "From this children's book, what are the two things little Jake most loved? Then find their ancient archetype from this research paper." Here you must: (1) search the children's book for Jake's two loved things; (2) extract them; (3) search the research paper for archetype of each. The second search depends on what the first finds. Another: "List the offices X held, then for each find when elected" → first find offices, then search each for election date. Multi-step only when the question cannot be answered without first discovering something from the docs that enables a follow-up search.

Output JSON:
{"queries": ["q1","q2",...], "needsSecondRound": false}
If needsSecondRound true, add "round2": {"extractionPrompt":"...","queryInstructions":"..."}
Omit round2 when false.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI decompose: ${res.status}`);
  const raw = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { queries: [userMessage] };
  }
  const obj = parsed as Record<string, unknown>;
  const queries = Array.isArray(obj.queries) ? (obj.queries as unknown[]).filter((x): x is string => typeof x === 'string') : [userMessage];
  if (queries.length === 0) queries.push(userMessage);
  const r2 = obj.round2 as Record<string, unknown> | undefined;
  const getStr = (o: Record<string, unknown> | undefined, ...keys: string[]) => {
    if (!o) return undefined;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
  };
  const extractionPrompt = getStr(r2, 'extractionPrompt', 'extraction_prompt');
  const queryInstructions = getStr(r2, 'queryInstructions', 'query_instructions');
  const hasRound2 = obj.round2 && typeof obj.round2 === 'object' && extractionPrompt && queryInstructions;
  const needsSecondRound = obj.needsSecondRound === true && hasRound2;
  const round2 = needsSecondRound ? { extractionPrompt: extractionPrompt!, queryInstructions: queryInstructions! } : undefined;
  console.log('[RAG-2ROUND] decompose parsed:', { rawNeedsSecondRound: obj.needsSecondRound, hasRound2, needsSecondRound, hasExtractionPrompt: !!extractionPrompt, hasQueryInstructions: !!queryInstructions });
  return { queries, needsSecondRound: !!needsSecondRound, round2 };
}

async function runExtraction(apiKey: string, context: string, extractionPrompt: string): Promise<Record<string, unknown>> {
  const truncated = context.length > 12000 ? context.slice(0, 12000) + '\n\n[...truncated]' : context;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You extract structured data. Output only valid JSON. No other text.' },
        { role: 'user', content: `Context:\n---\n${truncated}\n---\n\n${extractionPrompt}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI extraction: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const out = JSON.parse(content) as Record<string, unknown>;
    return typeof out === 'object' && out !== null ? out : {};
  } catch {
    return {};
  }
}

async function buildRound2Queries(
  apiKey: string,
  userMessage: string,
  extracted: Record<string, unknown>,
  queryInstructions: string,
): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        {
          role: 'user',
          content: `User question: "${userMessage}"

Extracted data from round 1 context: ${JSON.stringify(extracted)}

Instructions for round 2 queries: ${queryInstructions}

Generate 3-${ROUND2_QUERIES_CAP} search queries (keyword-rich, for semantic search) to find the remaining evidence. Output JSON: {"queries": ["query1", "query2", ...]}`,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI round2 queries: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const out = JSON.parse(content) as { queries?: unknown[] };
    const q = Array.isArray(out.queries) ? out.queries.filter((x): x is string => typeof x === 'string').slice(0, ROUND2_QUERIES_CAP) : [];
    return q;
  } catch {
    return [];
  }
}

async function getLastMessages(supabase: ReturnType<typeof createClient>, conversationId: string) {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(LAST_MESSAGES_COUNT);
  return ((data || []) as { role: string; content: string }[]).reverse();
}

async function chat(
  apiKey: string,
  context: string,
  lastMessages: { role: string; content: string }[],
  userMessage: string,
  chunks: ChunkRow[],
  requestTitle = false,
): Promise<ChatResponse> {
  const titleInstruction = requestTitle
    ? '\n- Include a "title" field: a 3-6 word phrase summarizing this conversation topic (e.g. "Quarter Horse Racing History", "Miss Meyers Career").'
    : '';
  const systemPrompt = `Answer using ONLY the context below. No inference. If context lacks info, say "The context does not include..." and leave quotes empty.

Context:
---
${context}
---

Output JSON only:
{"content":"answer in markdown","quotes":[{"snippet":"verbatim passage","pageId":"uuid","ref":1}]}${requestTitle ? ',"title":"3-6 word summary"' : ''}

Citation rules:
- Every factual claim needs [n] immediately after it. Put the marker right after the sentence it supports—never group citations at the end. WRONG: "Answer 1. Answer 2. [1][2]" RIGHT: "Answer 1 [1]. Answer 2 [2]." For multi-question responses, cite each answer inline.
- ref:N = the passage supporting [N]. Match by claim. snippet = verbatim from context. Numbers exact. Don't cite a different fact for a claim. Use page_id from blocks.
- No quotes for "The context does not...".${titleInstruction}`;

  const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...lastMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_CHAT_MODEL, messages, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`OpenAI chat: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  let raw = data.choices?.[0]?.message?.content ?? '{}';
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const inner = JSON.parse(raw) as { content?: string; quotes?: unknown[]; title?: string };
      if (typeof inner?.content === 'string') {
        raw = JSON.stringify({ content: inner.content, quotes: inner.quotes ?? [], title: inner.title });
      }
    } catch {
      /* no-op */
    }
  }
  const parsed = JSON.parse(raw) as ChatResponse & { title?: string };
  if (!parsed.quotes || !Array.isArray(parsed.quotes)) parsed.quotes = [];
  if (!parsed.content) parsed.content = 'I could not generate a response.';
  const pageIds = new Set(chunks.map((c) => c.page_id));
  const isMetaStatement = (s: string) => /^(The context does not include|The provided context does not|context does not include|provided context does not)/i.test(s.trim());
  const normalized = parsed.quotes
    .filter((q: unknown) => q && typeof (q as Record<string, unknown>).snippet === 'string' && !isMetaStatement(String((q as Record<string, unknown>).snippet)))
    .map((q: unknown) => ({
      snippet: String((q as Record<string, unknown>).snippet).trim(),
      pageId: String((q as Record<string, unknown>).pageId ?? (q as Record<string, unknown>).page_id ?? '').trim(),
      ref: typeof (q as Record<string, unknown>).ref === 'number' ? (q as Record<string, unknown>).ref as number : undefined,
    }));
  const resolved: QuotePayload[] = [];
  for (const q of normalized) {
    let pageId: string | null = q.pageId && pageIds.has(q.pageId) ? q.pageId : null;
    if (!pageId) {
      const chunk = chunks.find((c) => c.content.includes(q.snippet.slice(0, 100))) ?? (chunks.length === 1 ? chunks[0] : null);
      if (chunk) pageId = chunk.page_id;
    }
    if (pageId) resolved.push({ snippet: q.snippet, pageId, ref: q.ref });
  }
  if (resolved.some((q) => q.ref != null)) {
    resolved.sort((a, b) => (a.ref ?? 999) - (b.ref ?? 999));
  }
  parsed.quotes = resolved.map(({ snippet, pageId }) => ({ snippet, pageId }));
  // Only append missing refs when model cited zero—otherwise appending worsens placement.
  if (resolved.length > 0 && parsed.content) {
    const refsInContent = new Set<number>();
    for (const m of parsed.content.matchAll(/\[(\d+)\]/g)) refsInContent.add(parseInt(m[1], 10));
    if (refsInContent.size === 0) {
      const missing = Array.from({ length: resolved.length }, (_, i) => `[${i + 1}]`);
      parsed.content = parsed.content.trimEnd() + ' ' + missing.join(' ');
    } else if (refsInContent.size < resolved.length) {
      console.warn('[RAG] Model cited', refsInContent.size, 'refs but', resolved.length, 'quotes—some refs missing');
    }
  }
  return parsed;
}
