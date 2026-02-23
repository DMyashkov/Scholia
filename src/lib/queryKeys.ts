








export const CURRENT_CRAWL_JOB_BY_SOURCE = 'current-crawl-job-by-source';
export const LIST_OF_CRAWL_JOBS_BY_SOURCE = 'list-of-crawl-jobs-by-source';
export const LATEST_MAIN_CRAWL_JOB_BY_SOURCES = 'latest-main-crawl-job-by-sources';
export const CRAWL_JOB_INVALIDATION_PREFIXES = [
  CURRENT_CRAWL_JOB_BY_SOURCE,
  LIST_OF_CRAWL_JOBS_BY_SOURCE,
  LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
] as const;


export const LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE = 'latest-add-page-job-by-conversation-and-source';



export const SOURCES_FOR_CONVERSATION = 'sources-for-conversation';


export const PAGES_FOR_CONVERSATION = 'pages-for-conversation';


export const PAGE_EDGES_FOR_CONVERSATION = 'page-edges-for-conversation';


export const PAGE_GRAPH_EDGES_FOR_CONVERSATION = 'page-graph-edges-for-conversation';



export const PAGES_BY_SOURCE = 'pages-by-source';



export const COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION = 'counts-of-discovered-links-by-conversation';


export const COUNT_OF_DISCOVERED_LINKS_BY_SOURCE = 'count-of-discovered-links-by-source';


export const ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION = 'encoded-counts-of-discovered-links-by-conversation';


export const ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE = 'encoded-count-of-discovered-links-by-source';