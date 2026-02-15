/**
 * Derives a human-readable label from a source URL when source_label is wrong
 * (e.g. Wikipedia start page is Joe Biden but first crawled page was President of the United States).
 */
export function getSourceDisplayLabel(source: {
  url: string;
  domain: string;
  source_label?: string | null;
}): string {
  const derived = deriveLabelFromUrl(source.url);
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
