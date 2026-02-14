// Supabase Edge Function: chat-with-rag
// Embeds user message, retrieves relevant chunks, calls OpenAI Chat, creates assistant message + citations, returns message with quotes.

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_CHAT_MODEL = 'gpt-4o-mini';
 const MATCH_CHUNKS_PER_QUERY = 12;
const MATCH_CHUNKS_MERGED_CAP = 45;
const LAST_MESSAGES_COUNT = 10;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuotePayload {
  snippet: string;
  pageId: string;
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
  pageUrl?: string; // Full canonical URL for "Open source page" - avoids domain+path construction bugs
  contextBefore?: string;
  contextAfter?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { conversationId, userMessage } = (await req.json()) as {
      conversationId: string;
      userMessage: string;
    };
    console.log('[RAG] Request:', { conversationId, question: userMessage?.trim().slice(0, 80) });
    if (!conversationId || !userMessage?.trim()) {
      return new Response(
        JSON.stringify({ error: 'conversationId and userMessage required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY secret not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
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
        return new Response(
          JSON.stringify({ error: insertErr?.message ?? 'Failed to save message' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ message: inserted[0], quotes: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const pageIds = pages.map((p) => p.id);

    type ChunkRow = { id: string; page_id: string; content: string; page_title: string; page_path: string; source_domain: string; distance?: number };
    const chunkShape = (c: ChunkRow) => `page_id: ${c.page_id}\n[${c.source_domain}${c.page_path}] ${c.page_title}\n${c.content}`;
    const preview = (c: ChunkRow, maxLen = 100) => c.content.slice(0, maxLen).replace(/\s+/g, ' ').trim() + (c.content.length > maxLen ? '...' : '');

    // Lead chunks: one per page (shortest content = likely lead paragraph with birth date etc.)
    const { data: leadChunks = [], error: leadErr } = await supabase.rpc('get_lead_chunks', { match_page_ids: pageIds });
    const leadList = (leadChunks || []) as ChunkRow[];
    const leadIds = new Set(leadList.map((c) => c.id));

    // Step 1: Decompose + reformulate — split multi-part questions and make each search-optimized
    let searchQueries: string[];
    try {
      searchQueries = await decomposeAndReformulate(openaiKey, userMessage.trim());
    } catch (e) {
      console.warn('[RAG decomposition] failed, using original message:', e);
      searchQueries = [userMessage.trim()];
    }
    console.log('[RAG decomposition] searchQueries=', searchQueries.length, searchQueries);

    // Step 2: Embed all search queries (batch)
    const embeddings = await embedBatch(openaiKey, searchQueries);

    // Step 3: Retrieve per query, merge by chunk id (keep best distance)
    const chunkMap = new Map<string, ChunkRow>();
    for (let i = 0; i < embeddings.length; i++) {
      const { data: matchedChunks, error: rpcError } = await supabase.rpc('match_chunks', {
        query_embedding: embeddings[i],
        match_page_ids: pageIds,
        match_count: MATCH_CHUNKS_PER_QUERY,
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
    const cappedMatch = matchedList.slice(0, MATCH_CHUNKS_MERGED_CAP);

    console.log('[RAG retrieval] pages=', pageIds.length, 'leadChunks=', leadList.length, 'matchChunks=', cappedMatch.length, 'queries=', searchQueries.length);

    console.log('[RAG retrieval] Question:', userMessage.trim());
    console.log('[RAG retrieval] Search queries:', searchQueries);
    console.log('[RAG retrieval] Similarity chunks (top by distance):');
    cappedMatch.forEach((c, i) => {
      const dist = (c as { distance?: number }).distance ?? null;
      console.log(`  ${i + 1}. distance=${dist?.toFixed(4) ?? '?'} | ${c.source_domain}${c.page_path} | ${preview(c)}`);
    });

    const combined = [...leadList, ...cappedMatch.filter((c) => !leadIds.has(c.id))];

    if (combined.length === 0) {
      const noChunksMessage = "I don't have indexed source content to cite yet. The crawl may have finished but chunking/embeddings may still be running (often 1–2 minutes after the crawl). Please try again in a moment, or re-open the source drawer to confirm indexing completed.";
      const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: noChunksMessage,
        quotes: null,
      }).select('*');
      if (insertErr || !inserted?.length) {
        return new Response(
          JSON.stringify({ error: insertErr?.message ?? 'Failed to save message' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ message: inserted[0], quotes: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const context = combined.map(chunkShape).join('\n\n---\n\n');
    console.log('[RAG] Context: chunks=', combined.length, 'contextLength=', context.length);

    const lastMessages = await getLastMessages(supabase, conversationId);
    const chatResult = await chat(openaiKey, context, lastMessages, userMessage.trim(), combined);

    console.log('[RAG] Chat result: contentLength=', chatResult.content?.length ?? 0, 'quotesCount=', chatResult.quotes?.length ?? 0);

    const pageById = new Map(pages.map((p) => [p.id, p]));
    const { data: sources } = await supabase
      .from('sources')
      .select('id, domain')
      .in('id', [...new Set(pages.map((p) => p.source_id))]);
    const sourceById = new Map((sources || []).map((s) => [s.id, s]));

    const CONTEXT_CHARS = 120;
    const getContextAroundSnippet = (chunkContent: string, snippet: string): { contextBefore: string; contextAfter: string } => {
      const idx = chunkContent.indexOf(snippet);
      if (idx < 0) return { contextBefore: '', contextAfter: '' };
      const start = Math.max(0, idx - CONTEXT_CHARS);
      const end = Math.min(chunkContent.length, idx + snippet.length + CONTEXT_CHARS);
      const contextBefore = chunkContent.slice(start, idx).replace(/^\s+/, '').trim();
      const contextAfter = chunkContent.slice(idx + snippet.length, end).replace(/\s+$/, '').trim();
      return { contextBefore, contextAfter };
    };

    const quotesOut: QuoteOut[] = chatResult.quotes.map((q, i) => {
      const page = pageById.get(q.pageId);
      const source = page ? sourceById.get(page.source_id) : null;
      const chunk = combined.find((c) => c.page_id === q.pageId && c.content.includes(q.snippet));
      const { contextBefore, contextAfter } = chunk ? getContextAroundSnippet(chunk.content, q.snippet) : { contextBefore: '', contextAfter: '' };
      const fullPageUrl = page?.url ?? null;
      // Derive domain from page URL when available (source.domain can be overwritten with page title)
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
        ...(fullPageUrl ? { pageUrl: fullPageUrl } : {}), // Always include when available for direct link
        ...(contextBefore ? { contextBefore } : {}),
        ...(contextAfter ? { contextAfter } : {}),
      };
    });

    const { data: conv } = await supabase.from('conversations').select('owner_id').eq('id', conversationId).single();
    const { data: insertedMsg, error: msgInsertErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: chatResult.content,
        quotes: quotesOut,
        owner_id: conv?.owner_id ?? null,
      })
      .select('*');
    const assistantRow = insertedMsg?.[0];
    if (msgInsertErr || !assistantRow) {
      return new Response(
        JSON.stringify({ error: msgInsertErr?.message ?? 'Failed to save message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

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

    return new Response(
      JSON.stringify({
        message: assistantRow ?? { content: chatResult.content, quotes: quotesOut },
        quotes: quotesOut,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

async function embed(apiKey: string, text: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`OpenAI embed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embed batch: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

/**
 * Splits multi-part questions and reformulates each for optimal semantic search.
 * Returns search-optimized sub-queries: explicit, factual, keyword-rich.
 */
async function decomposeAndReformulate(apiKey: string, userMessage: string): Promise<string[]> {
  const sys = `You help reformulate user questions for semantic search over indexed documents (e.g. Wikipedia).

If the user asks a SINGLE question: output exactly 1 reformulated query that is explicit, factual, and keyword-rich. E.g. "when was Biden born" → "Joe Biden birth date and place".

If the user asks MULTIPLE questions or a complex request: split into 2-6 sub-questions. Each must be explicit, factual, keyword-rich for semantic search. Use names, dates, specific terms.

Output a JSON object: {"queries": ["query1", "query2", ...]}. No other text.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
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
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [userMessage];
  }
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
    return parsed as string[];
  }
  if (parsed && typeof parsed === 'object' && 'queries' in parsed && Array.isArray((parsed as { queries: unknown }).queries)) {
    const q = (parsed as { queries: unknown[] }).queries.filter((x) => typeof x === 'string') as string[];
    if (q.length > 0) return q;
  }
  if (parsed && typeof parsed === 'object' && 'query' in parsed && typeof (parsed as { query: unknown }).query === 'string') {
    return [(parsed as { query: string }).query];
  }
  return [userMessage];
}

async function getLastMessages(
  supabase: ReturnType<typeof createClient>,
  conversationId: string,
): Promise<{ role: string; content: string }[]> {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(LAST_MESSAGES_COUNT);
  return (data || []).reverse();
}

async function chat(
  apiKey: string,
  context: string,
  lastMessages: { role: string; content: string }[],
  userMessage: string,
  chunks: { id: string; page_id: string; content: string; page_title: string; page_path: string; source_domain: string }[],
): Promise<ChatResponse> {
  const systemPrompt = `You answer the user's question using ONLY the provided source context below. The context is from the user's indexed pages (e.g. Wikipedia). Do not say the context lacks information if the answer appears anywhere in it—look carefully, including in the first sections (e.g. lead paragraph) where birth dates and basic facts often appear.

Context from indexed pages:
---
${context}
---

Output a JSON object with this structure only (no other text):
{"content":"your answer in markdown","quotes":[{"snippet":"verbatim passage from context","pageId":"uuid-from-first-line-of-that-block"}]}

Rules:
- Answer using ONLY the context above. Each context block has a first line "page_id: " followed by a UUID. Put that exact UUID in "pageId" when citing that block.
- For "snippet": you MUST copy-paste a verbatim sentence or phrase from the context—do not paraphrase or rewrite. Example: if the context says "Joseph Robinette Biden Jr. (born November 20, 1942) is an American politician", then snippet must be that exact text or a contiguous part of it, not "Joe Biden was born on November 20, 1942."
- For every factual claim, add one entry to "quotes" with snippet = verbatim text from context and pageId = that block's UUID. You MUST include at least one quote when your answer comes from the context.
- "content" = your answer. "quotes" = array of { snippet, pageId }. Output only valid JSON.`;

  const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...lastMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI chat: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message?.content ?? '{}';
  console.log('[RAG chat] LLM raw length=', raw.length, 'preview=', raw.slice(0, 120));
  const parsed = JSON.parse(raw) as ChatResponse;
  if (!parsed.quotes || !Array.isArray(parsed.quotes)) parsed.quotes = [];
  if (!parsed.content) parsed.content = 'I could not generate a response.';
  // Unwrap if the model returned JSON inside content (e.g. content is the string "{\"content\":\"...\",\"quotes\":[]}")
  if (typeof parsed.content === 'string' && parsed.content.trim().startsWith('{')) {
    try {
      const inner = JSON.parse(parsed.content) as { content?: string; quotes?: unknown[] };
      if (typeof inner?.content === 'string') {
        parsed.content = inner.content;
        if (Array.isArray(inner.quotes)) parsed.quotes = inner.quotes as QuotePayload[];
      }
    } catch {
      // leave parsed as-is
    }
  }
  const pageIds = new Set(chunks.map((c) => c.page_id));
  const beforeFilter = parsed.quotes.length;
  // Accept both pageId and page_id from the model (some models use snake_case)
  const normalized = parsed.quotes
    .filter((q) => q && (typeof (q as any).snippet === 'string' && String((q as any).snippet).trim()))
    .map((q) => ({
      snippet: String((q as any).snippet).trim(),
      pageId: String((q as any).pageId ?? (q as any).page_id ?? '').trim(),
    }));
  const modelPageIds = normalized.map((q) => q.pageId);
  // Use the model's snippet exactly. Only resolve pageId when missing; if we can't resolve, drop the quote (no fallback snippet).
  const resolved: QuotePayload[] = [];
  for (const q of normalized) {
    let pageId: string | null = q.pageId && pageIds.has(q.pageId) ? q.pageId : null;
    if (!pageId) {
      const snippet = q.snippet.slice(0, 200);
      const chunk = chunks.find((c) => c.content.includes(snippet) || (snippet.length > 20 && c.content.includes(q.snippet.slice(0, 50)))) ?? (chunks.length === 1 ? chunks[0] : null);
      if (chunk) pageId = chunk.page_id;
    }
    if (!pageId) continue;
    resolved.push({ snippet: q.snippet, pageId });
  }
  parsed.quotes = resolved;
  if (beforeFilter > 0 && resolved.length === 0) {
    console.log('[RAG chat] Quotes dropped: model returned', beforeFilter, 'quotes; valid pageIds (sample)=', Array.from(pageIds).slice(0, 2), 'model pageIds=', modelPageIds.slice(0, 5));
  }
  console.log('[RAG chat] Quotes: beforeFilter=', beforeFilter, 'afterFilter=', parsed.quotes.length);
  return parsed;
}
