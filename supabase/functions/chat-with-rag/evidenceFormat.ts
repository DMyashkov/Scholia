import type { EvidenceChunk, EvidenceChunkProvenance } from './types.ts';

export function mergeEvidenceProvenance(
  existing: EvidenceChunkProvenance[] | undefined,
  added: EvidenceChunkProvenance[],
): EvidenceChunkProvenance[] {
  const seen = new Set((existing ?? []).map((p) => `${p.slot}\0${p.query}`));
  const out = [...(existing ?? [])];
  for (const p of added) {
    const key = `${p.slot}\0${p.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function upsertEvidenceChunk(
  map: Map<string, EvidenceChunk>,
  params: {
    id: string;
    snippet: string;
    pageUrl?: string;
    pageTitle?: string;
    retrievedBy: EvidenceChunkProvenance[];
  },
): void {
  const { id, snippet, pageUrl, pageTitle, retrievedBy } = params;
  if (!snippet) return;
  const existing = map.get(id);
  if (!existing) {
    map.set(id, { id, snippet, pageUrl, pageTitle, retrievedBy: [...retrievedBy] });
    return;
  }
  map.set(id, {
    id,
    snippet: existing.snippet.length >= snippet.length ? existing.snippet : snippet,
    pageUrl: existing.pageUrl ?? pageUrl,
    pageTitle: existing.pageTitle ?? pageTitle,
    retrievedBy: mergeEvidenceProvenance(existing.retrievedBy, retrievedBy),
  });
}

export function formatEvidenceForPrompt(chunks: EvidenceChunk[]): string {
  return chunks
    .map((q, i) => {
      const lines: string[] = [`[${q.id}] (evidence ${i + 1})`];
      if (q.pageUrl) lines.push(`page: ${q.pageUrl}`);
      else if (q.pageTitle) lines.push(`page_title: ${q.pageTitle}`);
      const by = q.retrievedBy ?? [];
      if (by.length > 0) {
        lines.push(
          'retrieved_by:',
          ...by.map((p) => `  - slot "${p.slot}": ${p.query}`),
        );
      }
      lines.push(q.snippet);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
