/**
 * Fetch the first ~200 chars (lead) of a target page for encoded_discovered.
 * Strips common fluff: CSS, coordinates, "From Wikipedia...", etc.
 */
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';

const TARGET_LEAD_MAX_CHARS = 200;
const FETCH_DELAY_MS = 400; // Delay between fetches to avoid hammering servers

/** Strip leading junk (CSS, coordinates, boilerplate) from page text */
export function stripLeadFluff(text: string): string {
  let s = text.trim();
  if (!s) return '';

  // Remove CSS rules (e.g. ".mw-parser-output .geo-nondefault{display:none}")
  while (/\.[^{]+\{[^}]*\}/.test(s)) {
    s = s.replace(/\.[^{]+\{[^}]*\}/g, '').trim();
  }

  // Remove coordinate blocks (e.g. "35°11′40″N 101°48′28″W / 35.194327°N 101.807771°W / 35.194327; -101.807771")
  s = s.replace(/^[\d.°′″\s\/;:-]+[NS]\s*[\d.°′″\s\/;:-]+[EW][\s\/;.-]*/gi, '').trim();
  s = s.replace(/^[\d.-]+\s*;\s*[\d.-]+[\s.]*/g, '').trim();

  // Remove "From X, the free encyclopedia" and variants
  s = s.replace(/\bFrom\s+[^,]+,\s*the\s+free\s+encyclopedia\.?\s*/gi, '').trim();

  // Drop lines that are purely CSS-like (contain braces)
  const lines = s.split('\n');
  const filtered = lines.filter((line) => {
    const t = line.trim();
    return t && !(t.includes('{') && t.includes('}'));
  });
  s = filtered.join('\n').trim();

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Fetch a URL and return the first ~200 chars of main content (lead), with fluff stripped */
export async function fetchTargetPageLead(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ScholiaCrawler/1.0' },
      redirect: 'follow',
    });
    if (!res.ok) return '';
    const html = await res.text();
    const $ = cheerio.load(html);
    const mainContent =
      $('main, article, .content, #content, #bodyContent, .mw-parser-output').first().text().trim() ||
      $('body').text().trim();
    const cleaned = stripLeadFluff(mainContent);
    return cleaned.substring(0, TARGET_LEAD_MAX_CHARS).trim() || cleaned.substring(0, TARGET_LEAD_MAX_CHARS);
  } catch {
    return '';
  }
}

/** Fetch leads for multiple URLs with delay between requests. Returns map of url -> lead. */
export async function fetchTargetLeadsBatch(
  urls: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const total = urls.length;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const lead = await fetchTargetPageLead(url);
    if (lead) result.set(url, lead);
    onProgress?.(i + 1, total);
    if (i < urls.length - 1) {
      await new Promise((r) => setTimeout(r, FETCH_DELAY_MS));
    }
  }
  return result;
}
