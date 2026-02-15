import { Quote, Source } from './source';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  quotes?: Quote[];
  sourcesUsed?: string[];
  wasMultiStep?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  sources: Source[];
  createdAt: Date;
  updatedAt: Date;
}
