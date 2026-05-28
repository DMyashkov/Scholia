


export function normalizeSlotEntityString(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  s = s.replace(/\s*\(\s*/g, '(').replace(/\s*\)\s*/g, ')');
  try {
    s = s.normalize('NFKC');
  } catch {
    /* older runtimes */
  }
  return s;
}


export function splitListEntityValues(raw: string): string[] {
  const normalized = normalizeSlotEntityString(raw);
  if (!/[,;]/.test(normalized)) return [normalized];
  const parts = normalized.split(/[,;]+/).map((p) => normalizeSlotEntityString(p)).filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [normalized];
}


export function slotValueDedupKey(valueJson: unknown): string {
  if (typeof valueJson === 'string') return normalizeSlotEntityString(valueJson);
  if (typeof valueJson === 'number' || typeof valueJson === 'boolean') return String(valueJson);
  return JSON.stringify(valueJson);
}

export function capWithFairAllocation<T>(
  map: Map<string, T>,
  groups: T[][],
  cap: number,
  getKey: (t: T) => string,
  getDistance: (t: T) => number,
): T[] {
  const numQueries = groups.length;
  if (numQueries === 0) return [];
  const perQueryQuota = Math.max(1, Math.floor(cap / numQueries));
  const selectedKeys = new Set<string>();

  for (let i = 0; i < groups.length; i++) {
    const list = groups[i].slice().sort((a, b) => getDistance(a) - getDistance(b));
    let taken = 0;
    for (const item of list) {
      if (taken >= perQueryQuota) break;
      const key = getKey(item);
      if (selectedKeys.has(key)) continue;
      selectedKeys.add(key);
      taken++;
    }
  }

  const selected = Array.from(selectedKeys)
    .map((key) => map.get(key)!)
    .filter(Boolean)
    .sort((a, b) => getDistance(a) - getDistance(b));

  if (selected.length >= cap) return selected.slice(0, cap);
  const remaining = Array.from(map.values())
    .filter((item) => !selectedKeys.has(getKey(item)))
    .sort((a, b) => getDistance(a) - getDistance(b));
  const fill = remaining.slice(0, cap - selected.length);
  return [...selected, ...fill].sort((a, b) => getDistance(a) - getDistance(b)).slice(0, cap);
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


export function extractQueryTerms(query: string): string[] {
  const stop = new Set([
    // English
    'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'with',
    'other', 'than', 'give', 'me', 'get', 'show', 'find', 'what', 'how',
    'is', 'are', 'was', 'were', 'all', 'each', 'every', 'list', 'about',
    // Bulgarian
    'за', 'на', 'в', 'и', 'от', 'с', 'е', 'да', 'се', 'не', 'по', 'до',
    'при', 'като', 'но', 'или', 'са', 'ще', 'ми', 'му', 'им', 'тя', 'те',
    'той', 'то', 'ги', 'го', 'си', 'ти', 'аз', 'ни',
  ]);
  // Use unicode-aware replacement so Cyrillic/Greek letters are preserved
  return query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !stop.has(w));
}


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