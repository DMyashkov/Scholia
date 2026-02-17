/**
 * Derives a human-readable label from a source URL when source_label is wrong
 * (e.g. Wikipedia start page is Joe Biden but first crawled page was President of the United States).
 */
export function getSourceDisplayLabel(source: {
  initial_url: string;
  domain: string;
  source_label?: string | null;
}): string {
  const derived = deriveLabelFromUrl(source.initial_url);
  if (derived) return derived;
  return source.source_label ?? source.domain;
}

function deriveLabelFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // Wikipedia: /wiki/Page_Name
    const m = u.pathname.match(/^\/wiki\/([^/?#]+)$/);
    if (m) {
      const raw = decodeURIComponent(m[1].replace(/_/g, ' '));
      if (raw && raw.length < 100) return raw;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Strip redundant site suffixes from page titles (e.g. "Article - Wikipedia" → "Article") */
export function cleanPageTitleForDisplay(title: string | null | undefined, domain?: string): string {
  if (!title?.trim()) return title || '';
  let s = title.trim();
  // Common suffixes that repeat the domain/source
  const suffixes = [
    /\s*-\s*Wikipedia\s*$/i,
    /\s*–\s*Wikipedia\s*$/i,
    /\s*-\s*Wikidata\s*$/i,
    /\s*-\s*Wikimedia\s*$/i,
  ];
  for (const suffix of suffixes) {
    s = s.replace(suffix, '').trim();
  }
  return s || title.trim();
}
