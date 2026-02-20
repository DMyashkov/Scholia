import type { Source } from '../types';
export declare const MAX_PAGES: Record<Source['crawl_depth'], number>;
/** Strip common site-name suffixes from page titles (e.g. "Article - Site Name" → "Article") */
export declare const PAGE_TITLE_SUFFIX_REGEX: RegExp;
/** Domains that use MediaWiki-style paths and namespaces (e.g. /wiki/Page_Name) */
export declare const WIKI_STYLE_DOMAINS: string[];
export declare function isWikiStyleDomain(hostname: string): boolean;
/** MediaWiki namespace prefixes to skip when following links (meta, talk, templates, etc.) */
export declare const MEDIAWIKI_NS_PREFIXES: string[];
export declare const CONTEXT_SNIPPET_LENGTH = 200;
//# sourceMappingURL=constants.d.ts.map