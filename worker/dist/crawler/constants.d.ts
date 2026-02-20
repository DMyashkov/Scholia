import type { Source } from '../types';
/** Selector for main page content (body text and links). Generic (main, article, .content, #content) plus MediaWiki (#bodyContent, .mw-parser-output). Callers fall back to body when none match. */
export declare const MAIN_CONTENT_SELECTOR = "main, article, .content, #content, #bodyContent, .mw-parser-output";
/** Max characters of page body text to store. */
export declare const MAX_PAGE_CONTENT_LENGTH = 50000;
/** User-Agent sent when fetching pages (and used in robots.txt checks). */
export declare const CRAWLER_USER_AGENT = "ScholiaCrawler/1.0";
/** Fallback page title when no title or h1 is found. */
export declare const DEFAULT_PAGE_TITLE = "Untitled";
/** Max URL length in log messages. */
export declare const LOG_URL_MAX_LENGTH = 60;
export declare const MAX_PAGES: Record<Source['crawl_depth'], number>;
/** Common site name suffixes in page titles (e.g. "Article - Wikipedia", "Page | MDN"). Used to strip them for display. */
export declare const PAGE_TITLE_SUFFIXES: readonly ["Wikipedia", "Wikidata", "Wikimedia", "MDN", "Fandom", "Medium", "Substack", "GitHub", "Notion", "Reddit", "GOV.UK", "NHS", "BBC"];
/** Matches trailing " - Suffix" or " | Suffix" so it can be stripped from page titles. */
export declare const PAGE_TITLE_SUFFIX_REGEX: RegExp;
export declare const WIKI_STYLE_DOMAINS: string[];
export declare function isWikiStyleDomain(hostname: string): boolean;
export declare const MEDIAWIKI_NS_PREFIXES: string[];
export declare const CONTEXT_SNIPPET_LENGTH = 200;
/** Max links to process per page in dynamic crawl mode (for edges + queue). Non-dynamic mode uses all links. */
export declare const MAX_LINKS_PER_PAGE_DYNAMIC = 200;
/** Section headings to skip when extracting links (references, citations, etc.). Used by any site with this structure. */
export declare const SKIP_SECTION_HEADINGS: readonly ["references", "citations", "external links", "further reading", "bibliography", "notes", "sources"];
export declare function isSkipSectionHeading(text: string): boolean;
//# sourceMappingURL=constants.d.ts.map