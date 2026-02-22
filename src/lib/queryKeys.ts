/**
 * React Query key prefixes. Single source of truth for cache keys used by
 * crawl jobs, pages, graph, and discovered-links. Constant names read like
 * sentences; string value = constant name with underscores → hyphens.
 * Key shape is [PREFIX, ...args] as documented below.
 */

// ─── Crawl jobs ─────────────────────────────────────────────────────────────
/** Key [sourceId]. Current job (in-progress or latest main) for one source. useCrawlJob. */
export const CURRENT_CRAWL_JOB_BY_SOURCE = 'current-crawl-job-by-source';

/** Key [sourceId]. Full list of jobs for one source. useCrawlJobs (list). */
export const LIST_OF_CRAWL_JOBS_BY_SOURCE = 'list-of-crawl-jobs-by-source';

/** Key [sourceIdsKey]. Latest “main” crawl job per source (explicit_crawl_urls is null; excludes add-page jobs). */
export const LATEST_MAIN_CRAWL_JOB_BY_SOURCES = 'latest-main-crawl-job-by-sources';

/** Prefixes invalidated on crawl_jobs or encoded_discovered change (realtime). */
export const CRAWL_JOB_INVALIDATION_PREFIXES = [
  CURRENT_CRAWL_JOB_BY_SOURCE,
  LIST_OF_CRAWL_JOBS_BY_SOURCE,
  LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
] as const;

/** Key [conversationId, sourceId]. Latest add-page job for a source. useAddPageJob. */
export const LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE = 'latest-add-page-job-by-conversation-and-source';

// ─── Conversation-scoped (key [conversationId]) ─────────────────────────────
/** Sources attached to a conversation. useConversationSources. */
export const SOURCES_FOR_CONVERSATION = 'sources-for-conversation';

/** Pages belonging to the conversation’s sources. useConversationPages. */
export const PAGES_FOR_CONVERSATION = 'pages-for-conversation';

/** Page edges (graph links) for the conversation. useConversationPageEdges. */
export const PAGE_EDGES_FOR_CONVERSATION = 'page-edges-for-conversation';

// ─── By source ──────────────────────────────────────────────────────────────
/** Key [sourceId]. All pages for one source. usePages. */
export const PAGES_BY_SOURCE = 'pages-by-source';

// ─── Discovered links (conversation-scoped) ──────────────────────────────────
/** Key [conversationId]. Counts per source (map). SidebarCrawlPanel. */
export const COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION = 'counts-of-discovered-links-by-conversation';

/** Key [conversationId, sourceId]. Count for one source. SourceDrawer. */
export const COUNT_OF_DISCOVERED_LINKS_BY_SOURCE = 'count-of-discovered-links-by-source';

/** Key [conversationId]. Encoded counts per source (map). */
export const ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION = 'encoded-counts-of-discovered-links-by-conversation';

/** Key [conversationId, sourceId]. Encoded count for one source. */
export const ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE = 'encoded-count-of-discovered-links-by-source';
