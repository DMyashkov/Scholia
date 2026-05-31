import type { ChunkRow, PageRow, SourceRow } from '../types.ts';

export function buildCorpusContextBlock(params: {
  pages: PageRow[];
  sourceById: Map<string, SourceRow>;
  leadChunks: ChunkRow[];
  maxPages?: number;
  maxSnippets?: number;
}): string {
  const { pages, sourceById, leadChunks, maxPages = 8, maxSnippets = 4 } = params;

  const domains = [
    ...new Set(
      pages
        .map((p) => sourceById.get(p.source_id)?.domain ?? '')
        .filter((d) => d.length > 0),
    ),
  ];

  const pageLines = pages.slice(0, maxPages).map((p) => {
    const domain = sourceById.get(p.source_id)?.domain ?? '';
    const label = (p.title?.trim() || p.path?.trim() || p.url || 'Untitled').slice(0, 120);
    return domain ? `- ${label} (${domain})` : `- ${label}`;
  });

  const snippetLines = leadChunks
    .slice(0, maxSnippets)
    .map((c) => {
      const text = (c.content ?? '').trim().slice(0, 280);
      if (!text) return null;
      const title = c.page_title?.trim();
      const prefix = title ? `[${title}] ` : '';
      return `> ${prefix}${text}${text.length >= 280 ? '…' : ''}`;
    })
    .filter((line): line is string => line != null);

  if (domains.length === 0 && pageLines.length === 0 && snippetLines.length === 0) {
    return '';
  }

  const parts = ['Indexed corpus (use this to infer the site’s primary language):'];
  if (domains.length > 0) parts.push(`Domains: ${domains.join(', ')}`);
  if (pageLines.length > 0) parts.push(`Sample pages:\n${pageLines.join('\n')}`);
  if (snippetLines.length > 0) parts.push(`Sample passages:\n${snippetLines.join('\n\n')}`);
  return parts.join('\n\n');
}

export function buildPlanUserMessage(userMessage: string, corpusContext: string): string {
  const trimmed = userMessage.trim();
  if (!corpusContext.trim()) {
    return trimmed;
  }
  return `${corpusContext.trim()}\n\n---\n\nQuestion: ${trimmed}`;
}
