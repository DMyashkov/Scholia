import type { Source } from '../types';
export declare const MAIN_CONTENT_SELECTOR = "main, article, .content, #content, #bodyContent, .mw-parser-output";
export declare const MAX_PAGE_CONTENT_LENGTH = 50000;
export declare const CRAWLER_USER_AGENT = "ScholiaCrawler/1.0";
export declare const DEFAULT_PAGE_TITLE = "Untitled";
export declare const LOG_URL_MAX_LENGTH = 60;
export declare const MAX_PAGES: Record<Source['crawl_depth'], number>;
export declare const PAGE_TITLE_SUFFIXES: readonly ["Wikipedia", "Wikidata", "Wikimedia", "MDN", "Fandom", "Medium", "Substack", "GitHub", "Notion", "Reddit", "GOV.UK", "NHS", "BBC"];
export declare const PAGE_TITLE_SUFFIX_REGEX: RegExp;
export declare const WIKI_STYLE_DOMAINS: string[];
export declare function isWikiStyleDomain(hostname: string): boolean;
export declare const MEDIAWIKI_NS_PREFIXES: string[];
export declare const CONTEXT_SNIPPET_LENGTH = 200;
export declare const MAX_LINKS_PER_PAGE_DYNAMIC = 200;
export declare const SKIP_SECTION_HEADINGS: readonly ["references", "citations", "external links", "further reading", "bibliography", "notes", "sources"];
export declare const LINK_SKIP_CONTAINER_SELECTORS = "[role=\"note\"], .hatnote";
export declare const DISAMBIGUATION_PATH_MARKER = "(disambiguation)";
export declare function isSkipSectionHeading(text: string): boolean;
//# sourceMappingURL=constants.d.ts.map