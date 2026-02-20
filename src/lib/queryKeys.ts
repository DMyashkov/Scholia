/**
 * React Query key prefixes and strings. Single source of truth for cache keys
 * used by crawl jobs, pages, graph, and discovered-links queries/invalidations.
 */

/** Crawl job: key [sourceId, conversationId]. useCrawlJobs. */
export const CRAWL_JOB_SINGLE = 'crawl-job';

/** Crawl jobs list: key [sourceId]. useCrawlJobs. */
export const CRAWL_JOBS_LIST = 'crawl-jobs';

/** Crawl jobs for multiple sources: key [sourceIdsKey, conversationId]. SidebarCrawlPanel, SourcesBar, SourceDrawer, ChatArea. */
export const CRAWL_JOBS_MAIN_FOR_SOURCES = 'crawl-jobs-main-for-sources';

export const CRAWL_JOBS_FOR_SOURCES = 'crawl-jobs-for-sources';
export const CRAWL_JOBS_FOR_SOURCES_BAR = 'crawl-jobs-for-sources-bar';

/** All prefixes we invalidate on crawl_jobs table change (realtime). */
export const CRAWL_JOB_INVALIDATION_PREFIXES = [
  CRAWL_JOB_SINGLE,
  CRAWL_JOBS_LIST,
  CRAWL_JOBS_FOR_SOURCES,
  CRAWL_JOBS_FOR_SOURCES_BAR,
  CRAWL_JOBS_MAIN_FOR_SOURCES,
] as const;

/** Add-page job: key [conversationId, sourceId]. useAddPageJob. */
export const ADD_PAGE_JOB = 'add-page-job';

/** Sources for a conversation: key [conversationId]. useConversationSources. */
export const CONVERSATION_SOURCES = 'conversation-sources';

/** Pages for a conversation: key [conversationId]. usePages. */
export const CONVERSATION_PAGES = 'conversation-pages';

/** Page edges (graph links) for a conversation: key [conversationId]. usePages. */
export const CONVERSATION_PAGE_EDGES = 'conversation-page-edges';

/** Pages for a single source: key [sourceId]. usePages. */
export const PAGES = 'pages';

/** Discovered links: key [conversationId] → counts for all sources. SidebarCrawlPanel. */
export const DISCOVERED_LINKS_COUNTS_BY_CONVERSATION = 'discovered-links-counts';

/** Discovered links: key [conversationId, sourceId] → count for one source. SourceDrawer. */
export const DISCOVERED_LINKS_COUNT_PER_SOURCE = 'discovered-links-count';

/** Encoded discovered: key [conversationId] → encoded counts for all sources. */
export const DISCOVERED_LINKS_ENCODED_COUNTS_BY_CONVERSATION = 'discovered-links-encoded-counts';

/** Encoded discovered: key [conversationId, sourceId] → encoded count for one source. */
export const DISCOVERED_LINKS_ENCODED_COUNT_PER_SOURCE = 'discovered-links-encoded-count';
