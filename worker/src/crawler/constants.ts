import type { Source } from '../types';

export const MAX_PAGES: Record<Source['crawl_depth'], number> = {
  shallow: 5,
  medium: 15,
  deep: 35,
  singular: 1,
  dynamic: 1,
};

export const PAGE_TITLE_SUFFIX_REGEX = /\s*[–-]\s*(Wikipedia|Wikidata|Wikimedia)\s*$/i;

export const WIKI_STYLE_DOMAINS = ['wikipedia.org', 'wikimedia.org'];

export function isWikiStyleDomain(hostname: string): boolean {
  return WIKI_STYLE_DOMAINS.some((d) => hostname.includes(d));
}

export const MEDIAWIKI_NS_PREFIXES = [
  'Wikipedia:', 'Wikipedia_talk:', 'Special:', 'Portal:', 'Help:', 'Template:',
  'Category:', 'File:', 'Media:', 'Talk:', 'User:', 'User_talk:',
];

export const CONTEXT_SNIPPET_LENGTH = 200;

export const WIKI_SKIP_SECTION_HEADINGS = [
  'references',
  'citations',
  'external links',
  'further reading',
  'bibliography',
  'notes',
  'sources',
] as const;

export function isSkipSectionHeading(text: string): boolean {
  const t = text.trim().toLowerCase();
  return WIKI_SKIP_SECTION_HEADINGS.some(
    (h) => t === h || t.startsWith(h + ' ') || t.startsWith(h + '(')
  );
}
