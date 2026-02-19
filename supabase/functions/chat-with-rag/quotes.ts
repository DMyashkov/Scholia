import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, PageRow, SourceRow, QuoteOut } from './types.ts';
import { PAGE_CONTEXT_CHARS } from './config.ts';

/**
 * Use full chunk content as the stored quote snippet (no length limit).
 * Extract sees the full chunk; UI can use context_before/after to show a focused region if needed.
 */
export function snippetFromChunk(c: ChunkRow): string {
  return (c.content ?? '').trim();
}

/**
 * Create one quote row from a chunk at retrieval time. Inserts into DB and returns the new quote id.
 * Caller must provide page info for page_title, page_path, domain.
 */
export async function createQuoteFromChunk(
  supabase: SupabaseClient,
  params: {
    chunk: ChunkRow;
    page: PageRow;
    domain: string;
    retrievedInReasoningStepId: string;
    ownerId: string;
  },
): Promise<string | null> {
  const { chunk, page, domain, retrievedInReasoningStepId, ownerId } = params;
  const snippet = snippetFromChunk(chunk);
  const { data: row, error } = await supabase
    .from('quotes')
    .insert({
      message_id: null,
      page_id: chunk.page_id,
      chunk_id: chunk.id,
      snippet,
      page_title: page.title ?? '',
      page_path: page.path ?? '',
      domain,
      page_url: page.url ?? null,
      retrieved_in_reasoning_step_id: retrievedInReasoningStepId,
      owner_id: ownerId,
    })
    .select('id')
    .single();
  if (error || !row?.id) return null;
  return row.id;
}

const QUOTE_PLACEHOLDER_REGEX = /\[\[quote:([^\]]+)\]\]/g;

/**
 * Parse [[quote:uuid]] from final_answer, dedupe by first appearance, return content with [1],[2],... and ordered quote ids.
 * Only includes quote ids that are in validQuoteIds.
 */
export function replaceCitationPlaceholders(
  finalAnswer: string,
  validQuoteIds: Set<string>,
): { content: string; quoteIdsOrdered: string[] } {
  const quoteIdsOrdered: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  QUOTE_PLACEHOLDER_REGEX.lastIndex = 0;
  while ((m = QUOTE_PLACEHOLDER_REGEX.exec(finalAnswer)) !== null) {
    const id = m[1].trim();
    if (validQuoteIds.has(id) && !seen.has(id)) {
      seen.add(id);
      quoteIdsOrdered.push(id);
    }
  }
  let content = finalAnswer;
  for (let n = 0; n < quoteIdsOrdered.length; n++) {
    const placeholder = `[[quote:${quoteIdsOrdered[n]}]]`;
    content = content.split(placeholder).join(`[${n + 1}]`);
  }
  // Remove any remaining [[quote:...]] that weren't valid
  content = content.replace(QUOTE_PLACEHOLDER_REGEX, '');
  return { content, quoteIdsOrdered };
}

/**
 * Attach quotes to the final assistant message with citation order.
 * quoteIdsOrdered = list of quote ids in first-appearance order in the answer (deduplicated).
 */
export async function attachQuotesToMessage(
  supabase: SupabaseClient,
  messageId: string,
  quoteIdsOrdered: string[],
): Promise<void> {
  for (let n = 0; n < quoteIdsOrdered.length; n++) {
    await supabase
      .from('quotes')
      .update({ message_id: messageId, citation_order: n + 1 })
      .eq('id', quoteIdsOrdered[n]);
  }
}

/**
 * Update a quote row with context_before and context_after derived from full page content,
 * so the quote displays as a statement with surrounding context.
 */
export async function updateQuoteContextFromPage(
  supabase: SupabaseClient,
  quoteId: string,
  snippet: string,
  pageContent: string,
): Promise<void> {
  const { contextBefore, contextAfter } = getContextFromPage(pageContent, snippet, PAGE_CONTEXT_CHARS);
  await supabase
    .from('quotes')
    .update({
      context_before: contextBefore || null,
      context_after: contextAfter || null,
    })
    .eq('id', quoteId);
}

export function chunkShape(c: ChunkRow): string {
  return `page_id: ${c.page_id}\n[${c.source_domain}${c.page_path}] ${c.page_title}\n${c.content}`;
}

/** Ellipsis pattern: ... or .... or … (U+2026) - model sometimes inserts these in cited_snippets and breaks context lookup */
const ELLIPSIS_RE = /\s*\.{2,}\s*|\s*…\s*/g;

function findSnippetInText(text: string, snippet: string): { start: number; matchLen: number } | null {
  const idx = text.indexOf(snippet);
  if (idx >= 0) return { start: idx, matchLen: snippet.length };
  // If snippet contains ellipsis, find using the first segment so context_after starts in the right place
  if (/\s*\.{2,}\s*|\s*…\s*/.test(snippet)) {
    const segments = snippet.split(ELLIPSIS_RE).map((s) => s.trim()).filter((s) => s.length >= 20);
    for (const seg of segments) {
      const i = text.indexOf(seg);
      if (i >= 0) return { start: i, matchLen: seg.length };
    }
  }
  for (const len of [80, 60, 40]) {
    if (snippet.length < len) continue;
    const prefix = snippet.slice(0, len);
    const i = text.indexOf(prefix);
    if (i >= 0) return { start: i, matchLen: prefix.length };
  }
  return null;
}

function getContextFromPage(pageText: string, snippet: string, contextChars: number): { contextBefore: string; contextAfter: string } {
  const found = findSnippetInText(pageText, snippet);
  if (!found) return { contextBefore: '', contextAfter: '' };
  const { start: idx, matchLen } = found;
  const nearStart = idx < 80;
  const nearEnd = idx + matchLen > pageText.length - 80;
  const beforeStart = nearStart ? idx : Math.max(0, idx - contextChars);
  const afterEnd = nearEnd ? idx + matchLen : Math.min(pageText.length, idx + matchLen + contextChars);
  const before = pageText.slice(beforeStart, idx).replace(/^\s+/, '').trim();
  const after = pageText.slice(idx + matchLen, afterEnd).replace(/\s+$/, '').trim();
  return { contextBefore: before, contextAfter: after };
}

export function buildQuotesOut(
  conversationId: string,
  quotes: { snippet: string; pageId: string }[],
  pageById: Map<string, PageRow>,
  sourceById: Map<string, SourceRow>,
  pageContentById: Map<string, string>,
): QuoteOut[] {
  return quotes.map((q, i) => {
    const page = pageById.get(q.pageId);
    const source = page ? sourceById.get(page.source_id) : null;
    const pageContent = pageContentById.get(q.pageId);
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
}
