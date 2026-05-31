import type { EvidenceChunk, EvidenceChunkProvenance } from './types.ts';

export function mergeEvidenceProvenance(
  existing: EvidenceChunkProvenance[],
  added: EvidenceChunkProvenance[],
): EvidenceChunkProvenance[] {
  const seen = new Set(existing.map((p) => `${p.slot}\0${p.query}`));
  const out = [...existing];
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
  params: EvidenceChunk,
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

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function normalizeLineKey(line: string): string {
  return normalizeLine(line).toLowerCase();
}

function splitSnippetLines(snippet: string): string[] {
  return snippet.split(/\r?\n/).map(normalizeLine).filter((line) => line.length > 0);
}

/** Lines repeated across many chunks in one step — likely shared page chrome, not content. */
export function detectBoilerplateLines(allSnippets: string[]): Set<string> {
  const counts = new Map<string, number>();
  const chunkCount = allSnippets.length;
  if (chunkCount < 2) return new Set();

  for (const snippet of allSnippets) {
    const seenInChunk = new Set<string>();
    for (const line of splitSnippetLines(snippet)) {
      const key = normalizeLineKey(line);
      if (key.length < 3) continue;
      if (seenInChunk.has(key)) continue;
      seenInChunk.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  // Minimum count thresholds: keep them high enough that short content lines (e.g.
  // "АГАТА, семена картофи" appearing in a navigation sidebar on every variety page)
  // are not mistakenly stripped alongside true boilerplate (headers, footers, contact info).
  // A short line appearing in only 2-3 chunks is almost certainly content, not chrome.
  const twoFifths = Math.max(5, Math.ceil(chunkCount * 0.4));
  const half = Math.ceil(chunkCount * 0.5);
  const shortLineMin = Math.max(5, Math.ceil(chunkCount * 0.3));
  const boilerplate = new Set<string>();

  for (const [key, count] of counts) {
    const len = key.length;
    if (count >= chunkCount && len <= 200) {
      boilerplate.add(key);
    } else if (count >= twoFifths && len <= 120) {
      boilerplate.add(key);
    } else if (count >= half && len <= 200) {
      boilerplate.add(key);
    } else if (count >= shortLineMin && len <= 48) {
      boilerplate.add(key);
    }
  }

  return boilerplate;
}

export function trimEvidenceSnippet(snippet: string, boilerplate: Set<string>): string {
  const lines = splitSnippetLines(snippet);
  const filtered = lines.filter((line) => {
    const key = normalizeLineKey(line);
    if (key.length < 2) return false;
    return !boilerplate.has(key);
  });

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const line of filtered) {
    const key = normalizeLineKey(line);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }

  if (deduped.length > 0) return deduped.join('\n');
  const trimmed = snippet.trim();
  return trimmed.length > 0 ? trimmed : lines.join('\n');
}

export function trimEvidenceChunksForPrompt(chunks: EvidenceChunk[]): EvidenceChunk[] {
  if (chunks.length === 0) return [];
  const boilerplate = detectBoilerplateLines(chunks.map((c) => c.snippet ?? ''));
  return chunks
    .map((c) => ({
      ...c,
      snippet: trimEvidenceSnippet(c.snippet ?? '', boilerplate),
    }))
    .filter((c) => c.snippet.length > 0);
}

export function formatEvidenceForPrompt(chunks: EvidenceChunk[]): string {
  return chunks
    .map((q, i) => {
      const lines: string[] = [`(evidence ${i + 1})`];
      if (q.pageTitle) lines.push(`page_title: ${q.pageTitle}`);
      if (q.pageUrl) lines.push(`page_url: ${q.pageUrl}`);
      const by = q.retrievedBy;
      if (by.length > 0) {
        const uniqueSlots = [...new Set(by.map((p) => p.slot))];
        lines.push(`retrieved_by: ${uniqueSlots.map((s) => `"${s}"`).join(', ')}`);
      }
      lines.push(q.snippet);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');
}
