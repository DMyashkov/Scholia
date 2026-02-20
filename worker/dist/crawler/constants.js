export const MAX_PAGES = {
    shallow: 5,
    medium: 15,
    deep: 35,
    singular: 1, // Seed page only, non-dynamic
    dynamic: 1, // Only the seed page; discovered links stored for RAG suggestion
};
/** Strip common site-name suffixes from page titles (e.g. "Article - Site Name" → "Article") */
export const PAGE_TITLE_SUFFIX_REGEX = /\s*[–-]\s*(Wikipedia|Wikidata|Wikimedia)\s*$/i;
/** Domains that use MediaWiki-style paths and namespaces (e.g. /wiki/Page_Name) */
export const WIKI_STYLE_DOMAINS = ['wikipedia.org', 'wikimedia.org'];
export function isWikiStyleDomain(hostname) {
    return WIKI_STYLE_DOMAINS.some((d) => hostname.includes(d));
}
/** MediaWiki namespace prefixes to skip when following links (meta, talk, templates, etc.) */
export const MEDIAWIKI_NS_PREFIXES = [
    'Wikipedia:', 'Wikipedia_talk:', 'Special:', 'Portal:', 'Help:', 'Template:',
    'Category:', 'File:', 'Media:', 'Talk:', 'User:', 'User_talk:',
];
export const CONTEXT_SNIPPET_LENGTH = 200;
//# sourceMappingURL=constants.js.map