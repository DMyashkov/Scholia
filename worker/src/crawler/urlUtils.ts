function stripFragmentAndQuery(input: string): string {
  let s = (input || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.trim();
  s = s.replace(/^(https?:\/\/)+/i, '');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

// Returns the canonical fetch URL — preserves trailing slash from original so servers
// that require it (e.g. agrico.bg) don't 404.
export function normalizeUrlForCrawl(input: string): string {
  const s = stripFragmentAndQuery(input);
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    return u.toString();
  } catch {
    return s;
  }
}

// Returns a deduplication key — trailing slash is stripped so
// "/foo/" and "/foo" are treated as the same page.
export function urlDedupKey(input: string): string {
  const s = stripFragmentAndQuery(input);
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return s;
  }
}