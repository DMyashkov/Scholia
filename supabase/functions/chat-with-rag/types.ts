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

export interface DecomposeResult {
  queries: string[];
  needsSecondRound?: boolean;
  round2?: {
    extractionPrompt: string;
    queryInstructions: string;
  };
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
