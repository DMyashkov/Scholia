export function normalizeUrlForCrawl(input: string): string {
  let s = (input || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.trim();
  s = s.replace(/^(https?:\/\/)+/i, '');
  s = 'https://' + s;
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
