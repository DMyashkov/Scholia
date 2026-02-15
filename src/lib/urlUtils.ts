/**
 * Normalize a URL for use as a source or page URL.
 * - Strips fragment (#section) and query params
 * - Strips existing protocol (http/https) then adds https:// for consistent handling
 * - Removes duplicate protocol (https://https://...)
 * - Removes trailing slash from path (except for root)
 */
export function normalizeSourceUrl(input: string): string {
  let s = input.trim();
  if (!s) return s;

  // Strip fragment and query before parsing (handles malformed URLs)
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.trim();

  // Strip protocol if present so we always rebuild from host+path (avoids double-protocol issues)
  s = s.replace(/^(https?:\/\/)+/i, '');

  // Add protocol
  s = 'https://' + s;

  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    if (u.pathname.endsWith('/') && u.pathname !== '/') {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.toString();
  } catch {
    return s;
  }
}
