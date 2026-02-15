export interface Conversation {
  id: string;
  owner_id: string | null;
  title: string;
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
  owner_id: string | null;
  quotes?: MessageQuote[] | null;
  was_multi_step?: boolean;
}

export interface Source {
  id: string;
  owner_id: string | null;
  url: string;
  domain: string;
  source_label?: string | null; // Human-readable label from first page (e.g. "Joe Biden"). domain = hostname.
  favicon: string | null;
  crawl_depth: 'shallow' | 'medium' | 'deep';
  include_subpages: boolean;
  include_pdfs: boolean;
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
  conversation_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  pages_indexed: number;
  indexed_count?: number;
  discovered_count?: number;
  links_count?: number;
  total_pages: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_activity_at?: string | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
}

export interface Page {
  id: string;
  source_id: string;
  conversation_id: string;
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
  conversation_id: string;
  source_id: string;
  from_page_id?: string | null;
  to_page_id?: string | null;
  from_url?: string | null;
  to_url?: string | null;
  created_at: string;
  owner_id: string | null;
}

export interface Chunk {
  id: string;
  page_id: string;
  content: string;
  start_index: number | null;
  end_index: number | null;
  embedding: number[] | null;
  created_at: string;
  owner_id: string | null;
}

export interface Citation {
  id: string;
  message_id: string;
  chunk_id: string | null;
  page_id: string;
  source_id: string;
  snippet: string;
  created_at: string;
  owner_id: string | null;
}

// Insert types (omitting auto-generated fields)
export type ConversationInsert = Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};

export type MessageInsert = Omit<Message, 'id' | 'created_at' | 'owner_id'> & {
  owner_id?: string | null;
};

export type SourceInsert = Omit<Source, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};

export type CrawlJobInsert = Omit<CrawlJob, 'id' | 'created_at' | 'updated_at' | 'owner_id'> & {
  owner_id?: string | null;
};


