export type SourceStatus = 'ready' | 'crawling' | 'error' | 'outdated';
export type CrawlDepth = 'shallow' | 'medium' | 'deep' | 'dynamic';

export interface DiscoveredPage {
  id: string;
  title: string;
  path: string;
  status: 'indexed' | 'crawling' | 'pending' | 'error';
  content?: string;
}

export interface Source {
  id: string;
  url: string;
  domain: string;
  source_label?: string | null; // Human-readable label (e.g. "Joe Biden"). domain = hostname.
  favicon?: string;
  status: SourceStatus;
  crawlDepth: CrawlDepth;
  includeSubpages: boolean;
  includePdfs: boolean;
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
