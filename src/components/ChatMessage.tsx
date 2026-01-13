import { User, Sparkles } from 'lucide-react';
import { Message } from '@/types/chat';
import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { QuoteCardsList } from './QuoteCard';
import { KnowledgeTrail } from './KnowledgeTrail';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  sources?: { id: string; domain: string }[];
  onQuoteClick?: (quote: Quote) => void;
  onSourceClick?: (sourceId: string) => void;
}

export const ChatMessage = ({ 
  message, 
  isStreaming,
  sources = [],
  onQuoteClick,
  onSourceClick,
}: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const quotes = message.quotes || [];
  const sourcesUsed = message.sourcesUsed || [];

  // Get sources used in this message
  const trailSources = sources.filter(s => sourcesUsed.includes(s.id));

  return (
    <div
      className={cn(
        'flex gap-4 px-4 py-6 animate-fade-in',
        isUser ? 'bg-transparent' : 'bg-chat-assistant'
      )}
    >
      <div className="max-w-3xl mx-auto w-full flex gap-4">
        <div
          className={cn(
            'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center',
            isUser ? 'bg-secondary' : 'bg-primary/20'
          )}
        >
          {isUser ? (
            <User className="h-4 w-4 text-foreground" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-hidden">
          <p className="text-sm font-medium text-muted-foreground">
            {isUser ? 'You' : 'Scholia'}
          </p>
          <div className="prose prose-invert prose-sm max-w-none">
            <MessageContent content={message.content} />
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse-glow" />
            )}
          </div>

          {/* Quote Cards for assistant messages */}
          {!isUser && !isStreaming && quotes.length > 0 && onQuoteClick && (
            <QuoteCardsList quotes={quotes} onQuoteClick={onQuoteClick} />
          )}

          {/* Knowledge Trail */}
          {!isUser && !isStreaming && trailSources.length > 0 && onSourceClick && (
            <KnowledgeTrail sources={trailSources} onSourceClick={onSourceClick} />
          )}
        </div>
      </div>
    </div>
  );
};

const MessageContent = ({ content }: { content: string }) => {
  const lines = content.split('\n');
  
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={i} className="font-semibold text-foreground">
              {line.slice(2, -2)}
            </p>
          );
        }
        if (line.startsWith('- **')) {
          const match = line.match(/- \*\*(.+?)\*\*: (.+)/);
          if (match) {
            return (
              <p key={i} className="text-secondary-foreground">
                <span className="font-medium text-foreground">• {match[1]}:</span> {match[2]}
              </p>
            );
          }
        }
        if (line.startsWith('- ')) {
          return (
            <p key={i} className="text-secondary-foreground pl-2">
              • {line.slice(2)}
            </p>
          );
        }
        if (line.match(/^\d+\. \*\*/)) {
          const match = line.match(/^(\d+)\. \*\*(.+?)\*\*: (.+)/);
          if (match) {
            return (
              <p key={i} className="text-secondary-foreground">
                <span className="font-medium text-foreground">{match[1]}. {match[2]}:</span> {match[3]}
              </p>
            );
          }
        }
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="text-secondary-foreground leading-relaxed">
            {line}
          </p>
        );
      })}
    </div>
  );
};

export const TypingIndicator = () => {
  return (
    <div className="flex gap-4 px-4 py-6 bg-chat-assistant animate-fade-in">
      <div className="max-w-3xl mx-auto w-full flex gap-4">
        <div className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-primary/20">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-muted-foreground">Scholia</p>
          <div className="flex gap-1 py-2">
            <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
            <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
          </div>
        </div>
      </div>
    </div>
  );
};
