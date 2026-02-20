/** Selector for main page content (body text and links). Generic (main, article, .content, #content) plus MediaWiki (#bodyContent, .mw-parser-output). Callers fall back to body when none match. */
export const MAIN_CONTENT_SELECTOR = 'main, article, .content, #content, #bodyContent, .mw-parser-output';
/** Max characters of page body text to store. */
export const MAX_PAGE_CONTENT_LENGTH = 50000;
/** User-Agent sent when fetching pages (and used in robots.txt checks). */
export const CRAWLER_USER_AGENT = 'ScholiaCrawler/1.0';
/** Fallback page title when no title or h1 is found. */
export const DEFAULT_PAGE_TITLE = 'Untitled';
/** Max URL length in log messages. */
export const LOG_URL_MAX_LENGTH = 60;
export const MAX_PAGES = {
    shallow: 5,
    medium: 15,
    deep: 35,
    singular: 1,
    dynamic: 1,
};
/** Common site name suffixes in page titles (e.g. "Article - Wikipedia", "Page | MDN"). Used to strip them for display. */
export const PAGE_TITLE_SUFFIXES = [
    'Wikipedia',
    'Wikidata',
    'Wikimedia',
    'MDN',
    'Fandom',
    'Medium',
    'Substack',
    'GitHub',
    'Notion',
    'Reddit',
    'GOV.UK',
    'NHS',
    'BBC',
];
const _suffixAlternation = PAGE_TITLE_SUFFIXES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
/** Matches trailing " - Suffix" or " | Suffix" so it can be stripped from page titles. */
export const PAGE_TITLE_SUFFIX_REGEX = new RegExp(`\\s*[–\\-|]\\s*(${_suffixAlternation})\\s*$`, 'i');
export const WIKI_STYLE_DOMAINS = ['wikipedia.org', 'wikimedia.org'];
export function isWikiStyleDomain(hostname) {
    return WIKI_STYLE_DOMAINS.some((d) => hostname.includes(d));
}
export const MEDIAWIKI_NS_PREFIXES = [
    'Wikipedia:', 'Wikipedia_talk:', 'Special:', 'Portal:', 'Help:', 'Template:',
    'Category:', 'File:', 'Media:', 'Talk:', 'User:', 'User_talk:',
];
export const CONTEXT_SNIPPET_LENGTH = 200;
/** Max links to process per page in dynamic crawl mode (for edges + queue). Non-dynamic mode uses all links. */
export const MAX_LINKS_PER_PAGE_DYNAMIC = 200;
/** Section headings to skip when extracting links (references, citations, etc.). Used by any site with this structure. */
export const SKIP_SECTION_HEADINGS = [
    'references',
    'citations',
    'external links',
    'further reading',
    'bibliography',
    'notes',
    'sources',
];
export function isSkipSectionHeading(text) {
    const t = text.trim().toLowerCase();
    return SKIP_SECTION_HEADINGS.some((h) => t === h || t.startsWith(h + ' ') || t.startsWith(h + '('));
}
//# sourceMappingURL=constants.js.map