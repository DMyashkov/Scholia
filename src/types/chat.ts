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
  /** Preserved from original request for re-ask flow */
  unfoldMode?: 'unfold' | 'direct' | 'auto';
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
  indexedPageDisplay?: string;
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
