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

// Unfold v2: Plan phase
export type SlotType = 'scalar' | 'list' | 'mapping';

export interface PlanSlot {
  name: string;
  type: SlotType;
  description?: string;
  required?: boolean;
  dependsOn?: string;
}

export interface PlanSubquery {
  slot: string;
  query: string;
}

export interface PlanResult {
  action: 'retrieve' | 'expand_corpus' | 'clarify' | 'answer';
  why?: string;
  slots: PlanSlot[];
  subqueries: PlanSubquery[];
}

// Unfold v2: Extract + Decide (loop)
export interface ExtractClaim {
  slot: string;
  value: string | number | unknown;
  key?: string;
  confidence?: number;
  quoteIds: string[];
}

export interface ExtractResult {
  claims: ExtractClaim[];
  next_action: 'retrieve' | 'expand_corpus' | 'clarify' | 'answer';
  why?: string;
  final_answer?: string;
  /** When next_action is retrieve, optional follow-up subqueries for the next iteration */
  subqueries?: { slot: string; query: string }[];
  /** When next_action is clarify, optional list of questions for the user */
  questions?: string[];
  /** e.g. "Could not parse claim for slot X" when parse fails or slot missing */
  extractionGaps?: string[];
  /** When next_action is answer: verbatim passage per quote id (model-cited snippet, like pre–Unfold v2). */
  cited_snippets?: Record<string, string>;
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

// RAG context (index.ts split)
export type SlotDb = { id: string; name: string; type: string; description?: string | null; required: boolean; depends_on_slot_id?: string | null };
export type StepDb = { id: string; iteration_number: number; action: string; why?: string | null; completeness_score?: number | null };

export interface RagContextReady {
  kind: 'ready';
  conversationId: string;
  ownerId: string;
  userMessage: string;
  dynamicMode: boolean;
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
