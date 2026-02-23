export interface QuotePayload {
  snippet: string;
  pageId: string;
  ref?: number;
}

export interface ChatResponse {
  content: string;
  quotes: QuotePayload[];
  title?: string;
}

export interface QuoteOut {
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


export type SlotType = 'scalar' | 'list' | 'mapping';

export interface PlanSlot {
  name: string;
  type: SlotType;
  description?: string;
  dependsOn?: string;
  
  target_item_count?: number;
  
  items_per_key?: number;
}

export interface PlanSubquery {
  slot: string;
  query: string;
}


export interface NormalSubquery {
  slot: string;
  query: string;
}


export interface MapSubquery {
  slot: string;
  query: '__map__';
  map_description?: string;
}

export type ExtractSubquery = NormalSubquery | MapSubquery;

export interface PlanResult {
  action: 'retrieve' | 'expand_corpus' | 'clarify' | 'answer';
  why?: string;
  slots: PlanSlot[];
  subqueries: PlanSubquery[];
}


export interface ExtractClaim {
  slot: string;
  value: string | number | unknown;
  key?: string;
  confidence?: number;
  
  chunkIds: string[];
}

export interface ExtractResult {
  claims: ExtractClaim[];
  next_action: 'retrieve' | 'expand_corpus' | 'clarify' | 'answer';
  why?: string;
  final_answer?: string;
  
  subqueries?: ExtractSubquery[];
  
  questions?: string[];
  
  extractionGaps?: string[];
  
  cited_snippets?: Record<string, string>;
  
  suggested_page_index?: number;
  
  broad_query_completed_slot_fully?: string[];
}

export type ChunkRow = {
  id: string;
  page_id: string;
  content: string;
  page_title: string;
  page_path: string;
  source_domain: string;
  distance?: number;
};

export type PageRow = { id: string; source_id: string; title: string | null; path: string; url: string };
export type SourceRow = { id: string; domain: string };


export type SlotDb = {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  depends_on_slot_id?: string | null;
  target_item_count: number;
  
  items_per_key?: number | null;
  current_item_count: number;
  attempt_count: number;
  finished_querying: boolean;
  last_queries: string[] | null;
};
export type StepDb = { id: string; iteration_number: number; action: string; why?: string | null; completeness_score?: number | null };

export interface RagContextReady {
  kind: 'ready';
  conversationId: string;
  ownerId: string;
  userMessage: string;
  dynamicMode: boolean;
  
  suggestedPageCandidates: number;
  sourceIds: string[];
  pages: PageRow[];
  pageIds: string[];
  pageById: Map<string, PageRow>;
  sourceById: Map<string, SourceRow>;
  sourceDomainByPageId: Map<string, string>;
  leadChunks: ChunkRow[];
  rootMessageId: string;
  slots: SlotDb[];
  slotIdByName: Map<string, string>;
  planResult: PlanResult | null;
  expansionCount: number;
  appendToMessageId?: string;
  scrapedPageDisplay?: string;
}

export interface RagContextNoPages {
  kind: 'noPages';
  conversationId: string;
  ownerId: string;
  content: string;
}

export interface RagContextError {
  kind: 'error';
  error: string;
}

export type RagContext = RagContextReady | RagContextNoPages | RagContextError;