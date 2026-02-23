import { Quote, Source } from './source';

export interface SuggestedPage {
  url: string;
  title: string;
  snippet: string;
  sourceId: string;
  
  promptedByQuestion?: string;
  
  fromPageTitle?: string;
}


export interface ThoughtProcess {
  slots?: { name: string; type: string; description?: string; dependsOn?: string }[];
  
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
    
    statements?: string[];
    
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