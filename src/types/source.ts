export type SourceStatus = 'ready' | 'crawling' | 'error' | 'outdated';
export type CrawlDepth = 'shallow' | 'medium' | 'deep' | 'singular' | 'dynamic';

export interface DiscoveredPage {
  id: string;
  title: string;
  path: string;
  status: 'indexed' | 'crawling' | 'pending' | 'error';
  content?: string;
}

export interface Source {
  id: string;
  initial_url: string;
  domain: string;
  source_label?: string | null; // Human-readable label (e.g. "Joe Biden"). domain = hostname.
  status: SourceStatus;
  crawlDepth: CrawlDepth;
  sameDomainOnly: boolean;
  pagesIndexed: number;
  totalPages: number;
  lastUpdated: Date;
  discoveredPages: DiscoveredPage[];
}

export interface Quote {
  id: string;
  sourceId: string;
  pageId: string;
  snippet: string;
  pageTitle: string;
  pagePath: string;
  domain: string;
  pageUrl?: string; // Full canonical URL - prefer over constructing from domain+path
  contextBefore?: string;
  contextAfter?: string;
}

export interface SourcedMessage {
  quotes: Quote[];
  sourcesUsed: string[]; // source IDs
}
