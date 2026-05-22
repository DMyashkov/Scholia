export const MAIN_CONTENT_SELECTOR = 'main, article, .content, #content, #bodyContent, .mw-parser-output';
export const MAX_PAGE_CONTENT_LENGTH = 50000;
export const CRAWLER_USER_AGENT = 'ScholiaCrawler/1.0';
export const DEFAULT_PAGE_TITLE = 'Untitled';
export const LOG_URL_MAX_LENGTH = 60;
export const MAX_PAGES = {
    shallow: 5,
    medium: 15,
    deep: 35,
    singular: 1,
    dynamic: 1,
};
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
export const MAX_LINKS_PER_PAGE_DYNAMIC = 200;
export const SKIP_SECTION_HEADINGS = [
    'references',
    'citations',
    'external links',
    'further reading',
    'bibliography',
    'notes',
    'sources',
];
export const LINK_SKIP_CONTAINER_SELECTORS = '[role="note"], .hatnote';
export const DISAMBIGUATION_PATH_MARKER = '(disambiguation)';
export function isSkipSectionHeading(text) {
    const t = text.trim().toLowerCase();
    return SKIP_SECTION_HEADINGS.some((h) => t === h || t.startsWith(h + ' ') || t.startsWith(h + '('));
}
//# sourceMappingURL=constants.js.map