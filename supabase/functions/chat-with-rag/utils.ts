export function indicatesCantAnswer(content: string): boolean {
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

export function deriveTitleFromUrl(url: string): string {
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
export function extractQueryTerms(query: string): string[] {
  const stop = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with', 'other', 'than', 'give', 'me', 'get', 'show', 'find']);
  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Partition: pages whose URL/anchor matches query terms go first */
export function partitionByTermMatch<T extends { to_url: string; anchor_text: string | null }>(
  list: T[],
  terms: string[],
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
