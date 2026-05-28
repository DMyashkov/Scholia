import { Quote, Source } from './source';

export interface SuggestedPage {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  
  promptedByQuestion?: string;
  
  fromPageTitle?: string;
}


export interface ThoughtProcessSlot {
  name: string;
  type: string;
  description?: string;
  dependsOn?: string;
  targetItemCount?: number;
  itemsPerKey?: number;
}

export interface ThoughtProcessSubquery {
  slot: string;
  query: string;
  strategy?: 'broad' | 'targeted';
}

export interface DroppedClaimInfo {
  slot: string;
  key?: string;
  value?: string;
  chunkIds?: string[];
  reason: string;
}

export interface DroppedSubqueryInfo {
  slot: string;
  query: string;
  reason: string;
}

export interface SlotFillSummaryRow {
  name: string;
  type: string;
  target: number | null;
  filled: number;
}

export interface SlotSnapshotEntry {
  type: string;
  items: { key?: string | null; value: unknown }[];
}

export interface ThoughtProcess {
  slots?: ThoughtProcessSlot[];
  slotFillSummary?: SlotFillSummaryRow[];
  planReason?: string;
  steps?: {
    iter: number;
    action: string;
    why?: string;
    subqueries?: ThoughtProcessSubquery[];
    chunksPerSubquery?: number[];
    quotesFound?: number;
    claims?: unknown[];
    completeness?: number;
    fillStatusBySlot?: Record<string, string>;
    statements?: string[];
    nextAction?: string;
    slotSnapshot?: Record<string, SlotSnapshotEntry>;
    queryGuidance?: string;
    droppedClaims?: DroppedClaimInfo[];
    droppedSubqueries?: DroppedSubqueryInfo[];
  }[];
  iterationCount?: number;
  completeness?: number;
  hardStopReason?: string;
  clarifyQuestions?: string[];
  expandCorpusReason?: string;
  extractionGaps?: string[];
  partialAnswerNote?: string;
  droppedQuotes?: string[];
  quoteDiagnostics?: {
    placeholdersFound?: number;
    placeholdersUnique?: number;
    verifiedQuotes?: number;
    dropped?: { id: string; reason: string }[];
  };
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  quotes?: Quote[];
  sourcesUsed?: string[];
  wasMultiStep?: boolean;
  suggestedPage?: SuggestedPage | null;
  
  followsMessageId?: string;
  
  scrapedPageDisplay?: string;
  
  thoughtProcess?: ThoughtProcess | null;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  sources: Source[];
  dynamicMode?: boolean;
  createdAt: Date;
  updatedAt: Date;
}