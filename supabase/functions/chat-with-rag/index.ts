// Supabase Edge Function: chat-with-rag
// Embeds user message, retrieves relevant chunks, calls OpenAI Chat, creates assistant message + citations.
// Supports 2-round retrieval for complex questions. Streams step progress as NDJSON.

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
const MATCH_CHUNKS_PER_QUERY = 12;
const MATCH_CHUNKS_PER_QUERY_ROUND2 = 10;
const MATCH_CHUNKS_MERGED_CAP = 45;
const ROUND2_QUERIES_CAP = 10;
const LAST_MESSAGES_COUNT = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuotePayload {
  snippet: string;
  pageId: string;
  ref?: number;
}

interface ChatResponse {
  content: string;
  quotes: QuotePayload[];
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
    };
    const { conversationId, userMessage, appendToMessageId, indexedPageDisplay } = body;
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

    const { data: pages, error: pagesError } = await supabase
      .from('pages')
      .select('id, source_id, title, path, url')
      .eq('conversation_id', conversationId)
      .eq('status', 'indexed');

    if (pagesError || !pages?.length) {
      const content = !pages?.length
        ? "I don't have any indexed sources for this conversation yet. Add a source and run a crawl, then ask again."
        : "I couldn't load the source pages. Please try again.";
      const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content,
        quotes: null,
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

      const { queries: searchQueries, needsSecondRound, round2 } = decomposeResult;
      const totalSteps = needsSecondRound && round2 ? 3 : 2;

      console.log('[RAG-2ROUND] decomposition:', {
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

      let cappedMatch = await doRetrieve(searchQueries);
      let combined: ChunkRow[] = [...leadList, ...cappedMatch.filter((c) => !leadIds.has(c.id))];
      let didSecondRound = false;

      if (needsSecondRound && round2 && combined.length > 0) {
        didSecondRound = true;
        console.log('[RAG-2ROUND] entering round 2');
        await emit({ step: 2, totalSteps, label: 'Analyzing' });

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
        quotes: null,
      }).select('*');
        await emit({ done: true, message: inserted?.[0] ?? { content: noChunksMessage }, quotes: [] });
        return;
    }

    const context = combined.map(chunkShape).join('\n\n---\n\n');
    const lastMessages = await getLastMessages(supabase, conversationId);
    const chatResult = await chat(openaiKey, context, lastMessages, userMessage.trim(), combined);

    const pageById = new Map(pages.map((p) => [p.id, p]));
    const { data: sources } = await supabase
      .from('sources')
      .select('id, domain')
      .in('id', [...new Set(pages.map((p) => p.source_id))]);
    const sourceById = new Map((sources || []).map((s) => [s.id, s]));

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
    const ownerId = conv?.owner_id ?? null;

    let logReason = '1 round';
    if (didSecondRound) logReason = '2 rounds (decomposition + extraction + round2 queries)';
    else if (decomposeResult?.needsSecondRound && !decomposeResult?.round2) logReason = 'decomposition said needsSecondRound but no round2 config';
    else if (decomposeResult?.needsSecondRound) logReason = 'decomposition said needsSecondRound but round 2 skipped (extraction empty or no queries)';

    let assistantRow: Record<string, unknown>;

    if (appendToMessageId) {
      // Insert new assistant message as follow-up (add-page + re-ask flow)
      // Clear suggested_pages on the original message
      await supabase
        .from('messages')
        .update({ suggested_pages: null })
        .eq('id', appendToMessageId);
      console.log('[RAG-2ROUND] inserting follow-up message:', { follows: appendToMessageId, indexedPageDisplay });
      const { data: insertedMsg, error: msgInsertErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: chatResult.content,
          quotes: quotesOut,
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
          quotes: quotesOut,
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

    await supabase.from('rag_run_log').insert({
      conversation_id: conversationId,
      message_id: assistantRow?.id ?? null,
      owner_id: ownerId,
      needs_second_round: decomposeResult?.needsSecondRound ?? false,
      did_second_round: didSecondRound,
      reason: logReason,
    }).then(({ error }) => { if (error) console.warn('[RAG-2ROUND] rag_run_log insert failed:', error); });

    if (quotesOut.length > 0) {
      for (const q of quotesOut) {
        await supabase.from('citations').insert({
          message_id: assistantRow.id,
          page_id: q.pageId,
          source_id: q.sourceId,
          snippet: q.snippet,
          owner_id: conv?.owner_id ?? null,
        });
          }
    }

    // Page suggestion: only when answer indicates context doesn't include the info (skip when appending)
    let suggestedPages: { url: string; title: string; contextSnippet: string; sourceId: string; promptedByQuestion?: string }[] = [];
    const cantAnswer = indicatesCantAnswer(chatResult.content);
    const dynamicMode = (conv as { dynamic_mode?: boolean } | null)?.dynamic_mode !== false;

    if (!appendToMessageId && cantAnswer && dynamicMode) {
      const { data: convSources } = await supabase
        .from('conversation_sources')
        .select('source_id')
        .eq('conversation_id', conversationId);
      const allSourceIds = (convSources || []).map((cs: { source_id: string }) => cs.source_id);
      if (allSourceIds.length > 0) {
        try {
          const suggestionQueries = [
            ...searchQueries.slice(0, 3),
            ...(searchQueries.some((q) => q.toLowerCase().includes(userMessage.trim().toLowerCase().slice(0, 30))) ? [] : [userMessage.trim()]),
          ];
          const uniqueQueries = [...new Set(suggestionQueries)].slice(0, 4);
          const queryEmbs = await embedBatch(openaiKey, uniqueQueries);

          const matchMap = new Map<string, { m: { to_url: string; anchor_text: string | null; context_snippet: string; source_id: string; from_page_id: string | null }; distance: number }>();
          for (let i = 0; i < queryEmbs.length; i++) {
            const { data: matches } = await supabase.rpc('match_discovered_links', {
              query_embedding: queryEmbs[i],
              match_conversation_id: conversationId,
              match_source_ids: allSourceIds,
              match_count: 12,
            });
            const list = (matches || []) as { to_url: string; anchor_text: string | null; context_snippet: string; source_id: string; from_page_id: string | null; distance: number }[];
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
            suggestedPages = [{
              url: top.to_url,
              title: top.anchor_text?.trim() || deriveTitleFromUrl(top.to_url),
              contextSnippet: top.context_snippet,
              sourceId: top.source_id,
              promptedByQuestion: userMessage.trim(),
              fromPageTitle,
            }];
          }
        } catch (e) {
          console.warn('[RAG] match_discovered_links failed:', e);
        }
      }
    }

    if (suggestedPages.length > 0) {
      await supabase
        .from('messages')
        .update({ suggested_pages: suggestedPages })
        .eq('id', assistantRow.id);
    }

      await emit({ done: true, message: assistantRow, quotes: quotesOut, suggestedPages });
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
    /i don't have|i do not have/,
    /no (indexed |)(information|content|list|data) (in |)(the |)context/,
    /the (provided |)context does not/,
    /(the |)context (does not|doesn't) (include|contain|have|provide|list)/,
    /focuses exclusively on|mainly discusses|only (discusses|mentions|covers)/,
    /aside from|other than.*not (included|mentioned|listed)/,
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
function partitionByTermMatch(
  list: { to_url: string; anchor_text: string | null }[],
  terms: string[]
): { withMatch: typeof list; withoutMatch: typeof list } {
  const withMatch: typeof list = [];
  const withoutMatch: typeof list = [];
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
  const sys = `You plan semantic search for answering a user question over indexed documents (e.g. Wikipedia).

You can run 1 or 2 rounds of search:
- Round 1: search with the queries you specify.
- Round 2 (optional): after seeing round 1 results, extract entities/data from round 1, then run targeted searches. Use when the question requires discovering entities first, then searching for details about each.

Use 2 rounds when the question requires BOTH:
1. Discovering a list or set of entities from the documents (offices, people, topics, events, etc.), AND
2. Getting more specific information about each of those entities.

Examples that need 2 rounds:
- "For each office X held, find when elected and main achievement" → round 1 finds the person and lists offices; round 2 searches each office + "elected when achievement".
- "Compare A, B, C on criteria X, Y" when A,B,C are not fully known → round 1 finds them, round 2 gets comparison data per entity.
- "What are the main themes and how does each relate to Z?" → round 1 finds themes, round 2 searches each theme + Z.
- "List the key events, then for each find the cause" → round 1 finds events, round 2 searches each event + cause.
- Any question that says "for each", "per", "respectively", "in turn" when the list comes from the documents.
- Cross-product: "For each X and each Y, assess Z" → round 1 finds X and Y, round 2 combines them.

Use 1 round when:
- Single factual question (all entities already mentioned).
- The question is specific enough that round 1 queries can retrieve everything needed.
- The user is asking about one thing, not a list of things each requiring separate lookup.

Output JSON:
{
  "queries": ["search query 1", "search query 2", ...],
  "needsSecondRound": true or false,
  "round2": {
    "extractionPrompt": "Instructions for extracting structured data from round 1 context. Be specific: what JSON shape? E.g. 'Extract the list of offices/roles. Output: {\"items\": [\"office1\", \"office2\", ...]}'",
    "queryInstructions": "How to build round 2 search queries from the extracted data. E.g. 'For each item, create a query: item + \"elected when main achievement\"'"
  }
}

If needsSecondRound is false, omit round2 or set to null.
Round 1 queries should be broad enough to find the entities or overview.`;

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
): Promise<ChatResponse> {
  const systemPrompt = `You answer the user's question using ONLY the provided source context below. The context is from the user's indexed pages (e.g. Wikipedia).

CRITICAL: Do NOT infer, extrapolate, or assume. Only state facts that are EXPLICITLY written in the context. If the user asks "does X have a museum" and the context only mentions "Hall of Fame" or "inducted into X" without explicitly stating there is a museum, you MUST say "The context does not include information about whether..." or "The provided context does not mention a museum." Do not guess or use external knowledge—stick strictly to what the text says.
When the context truly does NOT contain the information needed, say clearly: "The context does not include..." or "The provided context does not list..." Be concise. This allows the system to suggest indexing another page.

Context from indexed pages:
---
${context}
---

Output a JSON object with this structure only (no other text):
{"content":"your answer in markdown with inline citations","quotes":[{"snippet":"verbatim passage","pageId":"uuid","ref":1}]}

Rules:
- Use INLINE numbered citations: place [1], [2], [3] etc. immediately after each claim. Format: "Statement [1]. Another fact [2]." Every quote MUST have a matching [n] in the content—if you have 4 quotes, the content must include [1], [2], [3], [4].
- Each quote MUST include "ref" (1-based number) matching its citation: the quote that supports [3] in the text must have "ref":3.
- The snippet you cite MUST DIRECTLY support the claim. If you state "there is a museum," the snippet must explicitly mention a museum—not just a related term like "Hall of Fame" unless the context clearly equates them.
- NEVER cite meta-statements as evidence. Do NOT add a quote when your answer is "The context does not include...", "The provided context does not mention...", or similar—these are YOUR words, not from the source. Only cite verbatim passages from the context. When the context lacks information, say so clearly but leave "quotes" empty or omit that part.
- Only use citation numbers for which you have a quote.
- Answer using ONLY the context above. Each context block has a first line "page_id: " followed by a UUID. Put that exact UUID in "pageId" when citing that block.
- For "snippet": you MUST copy-paste a verbatim sentence or phrase from the context—do not paraphrase.
- For every factual claim, add one entry to "quotes" with snippet = verbatim text and pageId = that block's UUID. You MUST include at least one quote when your answer comes from the context.
- When the context contains BOTH overview/list info (e.g. list of roles, offices) AND detailed info (e.g. dates, achievements per role), you MUST cite BOTH. Add [n] after list items AND after each detailed claim. Every factual statement needs its own citation—do not skip citing the overview just because you also cite details.
- Output only valid JSON.`;

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
      const inner = JSON.parse(raw) as { content?: string; quotes?: unknown[] };
      if (typeof inner?.content === 'string') {
        raw = JSON.stringify({ content: inner.content, quotes: inner.quotes ?? [] });
      }
    } catch {
      /* no-op */
    }
  }
  const parsed = JSON.parse(raw) as ChatResponse;
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
  // If we have quotes but content lacks citation markers, append them so evidence cards are linkable
  if (resolved.length > 0 && parsed.content) {
    const hasAnyRef = /\[\d+\]/.test(parsed.content);
    if (!hasAnyRef) {
      const markers = resolved.map((_, i) => `[${i + 1}]`).join(' ');
      parsed.content = parsed.content.trimEnd() + ' ' + markers;
    }
  }
  return parsed;
}
