export interface CrawlJob {
  id: string;
  source_id: string;
  conversation_id: string;
  status: 'queued' | 'running' | 'indexing' | 'completed' | 'failed' | 'cancelled';
  pages_indexed: number;
  indexed_count?: number;
  discovered_count?: number;
  links_count?: number;
  total_pages: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at?: string | null;
  seed_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
}

export interface Source {
  id: string;
  owner_id: string | null;
  url: string;
  domain: string;
  favicon: string | null;
  crawl_depth: 'shallow' | 'medium' | 'deep' | 'singular' | 'dynamic';
  include_subpages: boolean;
  include_pdfs: boolean;
  same_domain_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  source_id: string;
  conversation_id: string; // Added - required for isolated graphs
  url: string;
  title: string | null;
  path: string;
  content: string | null;
  status: 'pending' | 'crawling' | 'indexed' | 'error';
  created_at: string;
  updated_at: string;
  owner_id: string | null;
}

export interface PageEdge {
  id: string;
  source_id: string;
  conversation_id: string; // Added - required for isolated graphs
  from_url: string; // Changed from from_page_id
  to_url: string; // Changed from to_page_id
  from_page_id?: string | null; // Optional now
  to_page_id?: string | null; // Optional now
  created_at: string;
  owner_id: string | null;
}
