import type { ChunkRow, PageRow, SourceRow, QuoteOut } from './types.ts';
import { PAGE_CONTEXT_CHARS } from './config.ts';

export function chunkShape(c: ChunkRow): string {
  return `page_id: ${c.page_id}\n[${c.source_domain}${c.page_path}] ${c.page_title}\n${c.content}`;
}

function findSnippetInText(text: string, snippet: string): { start: number; matchLen: number } | null {
  const idx = text.indexOf(snippet);
  if (idx >= 0) return { start: idx, matchLen: snippet.length };
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
