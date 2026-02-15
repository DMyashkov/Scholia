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
    const { conversationId, userMessage } = (await req.json()) as {
      conversationId: string;
      userMessage: string;
    };
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

    const CHUNK_CONTEXT_CHARS = 120;
    const PAGE_CONTEXT_CHARS = 280; // ~2–3 sentences for richer "in context" display
    const findSnippetInText = (text: string, snippet: string): number => {
      let idx = text.indexOf(snippet);
      if (idx >= 0) return idx;
      for (const prefix of [snippet.slice(0, 80), snippet.slice(0, 60), snippet.slice(0, 40)]) {
        if (prefix.length < 15) break;
        idx = text.indexOf(prefix);
        if (idx >= 0) return idx;
      }
      return -1;
    };
    const getContextAroundSnippet = (fullText: string, snippet: string, contextChars: number) => {
      const idx = findSnippetInText(fullText, snippet);
      if (idx < 0) return { contextBefore: '', contextAfter: '' };
      const start = Math.max(0, idx - contextChars);
      const end = Math.min(fullText.length, idx + snippet.length + contextChars);
      return {
        contextBefore: fullText.slice(start, idx).replace(/^\s+/, '').trim(),
        contextAfter: fullText.slice(idx + snippet.length, end).replace(/\s+$/, '').trim(),
      };
    };

    const quotesOut: QuoteOut[] = chatResult.quotes.map((q, i) => {
      const page = pageById.get(q.pageId);
      const source = page ? sourceById.get(page.source_id) : null;
      const chunk = combined.find((c) => c.page_id === q.pageId && c.content.includes(q.snippet));
      let { contextBefore, contextAfter } = chunk
        ? getContextAroundSnippet(chunk.content, q.snippet, CHUNK_CONTEXT_CHARS)
        : { contextBefore: '', contextAfter: '' };
      const pageContent = pageContentById.get(q.pageId);
      const chunkContextWeak = (contextBefore.length + contextAfter.length) < 80;
      if (pageContent && chunkContextWeak) {
        const fromPage = getContextAroundSnippet(pageContent, q.snippet, PAGE_CONTEXT_CHARS);
        if (fromPage.contextBefore.length > contextBefore.length || fromPage.contextAfter.length > contextAfter.length) {
          contextBefore = fromPage.contextBefore;
          contextAfter = fromPage.contextAfter;
        }
      }
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

    const { data: conv } = await supabase.from('conversations').select('owner_id').eq('id', conversationId).single();
    const ownerId = conv?.owner_id ?? null;

    let logReason = '1 round';
    if (didSecondRound) logReason = '2 rounds (decomposition + extraction + round2 queries)';
    else if (decomposeResult?.needsSecondRound && !decomposeResult?.round2) logReason = 'decomposition said needsSecondRound but no round2 config';
    else if (decomposeResult?.needsSecondRound) logReason = 'decomposition said needsSecondRound but round 2 skipped (extraction empty or no queries)';

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
    const assistantRow = insertedMsg?.[0];
    if (msgInsertErr || !assistantRow) {
        console.error('[RAG-2ROUND] message insert failed:', msgInsertErr);
        await emit({ error: msgInsertErr?.message ?? 'Failed to save message' });
        return;
    }

    console.log('[RAG-2ROUND] message inserted:', { id: assistantRow?.id, was_multi_step: (assistantRow as { was_multi_step?: boolean })?.was_multi_step });

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

      await emit({ done: true, message: assistantRow, quotes: quotesOut });
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
  const systemPrompt = `You answer the user's question using ONLY the provided source context below. The context is from the user's indexed pages (e.g. Wikipedia). Do not say the context lacks information if the answer appears anywhere in it—look carefully, including in the first sections (e.g. lead paragraph) where birth dates and basic facts often appear.

Context from indexed pages:
---
${context}
---

Output a JSON object with this structure only (no other text):
{"content":"your answer in markdown with inline citations","quotes":[{"snippet":"verbatim passage","pageId":"uuid","ref":1}]}

Rules:
- Use INLINE numbered citations: place [1], [2], [3] etc. immediately after each claim. Format: "Statement [1]. Another fact [2]."
- Each quote MUST include "ref" (1-based number) matching its citation: the quote that supports [3] in the text must have "ref":3.
- Only use citation numbers for which you have a quote.
- Answer using ONLY the context above. Each context block has a first line "page_id: " followed by a UUID. Put that exact UUID in "pageId" when citing that block.
- For "snippet": you MUST copy-paste a verbatim sentence or phrase from the context—do not paraphrase.
- For every factual claim, add one entry to "quotes" with snippet = verbatim text and pageId = that block's UUID. You MUST include at least one quote when your answer comes from the context.
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
  const normalized = parsed.quotes
    .filter((q: unknown) => q && typeof (q as Record<string, unknown>).snippet === 'string')
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
  return parsed;
}
