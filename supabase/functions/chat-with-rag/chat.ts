import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, ChatResponse, QuotePayload } from './types.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';
import { LAST_MESSAGES_COUNT } from './config.ts';

export async function getLastMessages(supabase: SupabaseClient, conversationId: string) {
  const { data } = await supabase
    .from('messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(LAST_MESSAGES_COUNT);
  return ((data || []) as { role: string; content: string }[]).reverse();
}

export async function chat(
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
