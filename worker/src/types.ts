export interface CrawlJob {
  id: string;
  source_id: string;
  status: 'queued' | 'running' | 'indexing' | 'completed' | 'failed' | 'cancelled';
  indexed_count?: number;
  discovered_count?: number;
  total_pages: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at?: string | null;
  explicit_crawl_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
}

export interface Source {
  id: string;
  owner_id: string;
  conversation_id: string;
  initial_url: string;
  domain: string;
  crawl_depth: 'shallow' | 'medium' | 'deep' | 'singular' | 'dynamic';
  same_domain_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  source_id: string;
  url: string;
  title: string | null;
  path: string;
  content: string | null;
  status: 'pending' | 'crawling' | 'indexed' | 'error';
  created_at: string;
  updated_at: string;
  owner_id: string;
}

export interface PageEdge {
  id: string;
  from_page_id: string;
  to_url?: string | null;
  to_page_id?: string | null;
  created_at: string;
  owner_id: string;
}
