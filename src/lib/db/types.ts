export interface Conversation {
  id: string;
  owner_id: string;
  title: string;
  dynamic_mode: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageQuote {
  id: string;
  sourceId: string;
  pageId: string;
  snippet: string;
  pageTitle: string;
  pagePath: string;
  domain: string;
  contextBefore?: string;
  contextAfter?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  owner_id: string;
  quotes?: MessageQuote[] | null;
  was_multi_step: boolean;
  follows_message_id?: string | null;
  scraped_page_display?: string | null;
  thought_process?: Record<string, unknown> | null;
  suggested_page?: Record<string, unknown> | null;
}

export type SuggestionMode = 'surface' | 'dive';

export interface Source {
  id: string;
  owner_id: string;
  conversation_id: string;
  initial_url: string;
  domain: string;
  source_label?: string | null; // Human-readable label from first page (e.g. "Joe Biden"). domain = hostname.
  crawl_depth: 'shallow' | 'medium' | 'deep' | 'singular' | 'dynamic';
  suggestion_mode: SuggestionMode; // surface = link context (faster), dive = fetch target page lead (slower)
  same_domain_only: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConversationSource {
  id: string;
  conversation_id: string;
  source_id: string;
  created_at: string;
}

export interface CrawlJob {
  id: string;
  source_id: string;
  status: 'queued' | 'running' | 'indexing' | 'encoding' | 'completed' | 'failed' | 'cancelled';
  indexed_count?: number;
  discovered_count?: number;
  total_pages: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at?: string | null;
  encoding_chunks_done: number;
  encoding_chunks_total?: number | null;
  encoding_discovered_done: number;
  encoding_discovered_total?: number | null;
  explicit_crawl_urls?: string[] | null;
  created_at: string;
  updated_at: string;
  owner_id: string;
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
  to_page_id?: string | null;
  to_url?: string | null;
  created_at: string;
  owner_id: string;
  /** Derived from from_page_id via pages; present in API response for convenience */
  source_id?: string;
  /** Derived from from_page_id via pages; present in API response for convenience */
  conversation_id?: string;
}

export interface Chunk {
  id: string;
  page_id: string;
  content: string;
  start_index: number | null;
  end_index: number | null;
  embedding: number[] | null;
  created_at: string;
  owner_id: string;
}

export interface Quote {
  id: string;
  message_id: string;
  page_id: string;
  snippet: string;
  page_title: string;
  page_path: string;
  domain: string;
  page_url: string | null;
  context_before: string | null;
  context_after: string | null;
  owner_id: string;
  created_at: string;
}

// Insert types (omitting auto-generated fields)
export type ConversationInsert = Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};

export type MessageInsert = Omit<Message, 'id' | 'created_at' | 'owner_id' | 'quotes'> & {
  owner_id?: string | null;
};

export type SourceInsert = Omit<Source, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};

export type CrawlJobInsert = Omit<CrawlJob, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};

