export type SourceStatus = 'ready' | 'crawling' | 'error' | 'outdated';
export type CrawlDepth = 'shallow' | 'medium' | 'deep' | 'singular' | 'dynamic';
export type SuggestionMode = 'surface' | 'dive';

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
  source_label?: string | null; 
  status: SourceStatus;
  crawlDepth: CrawlDepth;
  suggestionMode: SuggestionMode; 
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
  pageUrl?: string; 
  contextBefore?: string;
  contextAfter?: string;
}

export interface SourcedMessage {
  quotes: Quote[];
  sourcesUsed: string[]; 
}