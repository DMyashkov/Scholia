import { Quote, Source } from './source';

export interface SuggestedPage {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  /** When present: "can't answer" flow - add page then re-ask this question */
  promptedByQuestion?: string;
  /** Title of the page this link was discovered from (for "branching out from X") */
  fromPageTitle?: string;
}

/** Thought process from Evidence-First RAG (collapsible UI). Streamed in real time. */
export interface ThoughtProcess {
  slots?: { name: string; type: string; description?: string; dependsOn?: string }[];
  /** Why we chose this plan (from plan step). */
  planReason?: string;
  steps?: {
    iter: number;
    action: string;
    why?: string;
    subqueries?: { slot: string; query: string }[];
    chunksPerSubquery?: number[];
    quotesFound?: number;
    claims?: unknown[];
    completeness?: number;
    fillStatusBySlot?: Record<string, string>;
    /** One-after-the-other narrative statements (retrieve, extract, fill). */
    statements?: string[];
    /** After this step: answer | retrieve | expand_corpus | clarify */
    nextAction?: string;
  }[];
  iterationCount?: number;
  completeness?: number;
  hardStopReason?: string;
  clarifyQuestions?: string[];
  expandCorpusReason?: string;
  extractionGaps?: string[];
  partialAnswerNote?: string;
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
  /** Points to the previous message this is a follow-up of (add page + re-answer) */
  followsMessageId?: string;
  /** Display text for divider: "Indexed American Horses - Wikipedia" */
  scrapedPageDisplay?: string;
  /** Evidence-First RAG: slots, steps, iteration count, completeness */
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
