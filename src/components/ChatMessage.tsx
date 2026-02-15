import React from 'react';
import { User, Sparkles, Layers } from 'lucide-react';
import { Message } from '@/types/chat';
import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { QuoteCardsList } from './QuoteCard';
import { CitedPages } from './CitedPages';
import { CopyMessageButton } from './CopyMessageButton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  onQuoteClick,
}: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const quotes = message.quotes || [];

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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">
                {isUser ? 'You' : 'Scholia'}
              </p>
              {!isUser && message.wasMultiStep && (
                <Tooltip>
                  <TooltipTrigger asChild>
                      <span
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 cursor-help"
                        tabIndex={0}
                      >
                        <Layers className="h-3 w-3" />
                        2-step
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-[240px]">
                      <p className="font-medium">2-step query</p>
                      <p className="text-muted-foreground text-xs mt-0.5">
                        Complex questions use a second retrieval round to gather more context before answering. This produces better answers but uses more credits.
                      </p>
                    </TooltipContent>
                  </Tooltip>
              )}
            </div>
            <CopyMessageButton message={message} className="h-8 w-8 shrink-0 opacity-70 hover:opacity-100" />
          </div>
          <div className="prose prose-invert prose-sm max-w-none">
            <MessageContent 
              content={message.content} 
              quotes={quotes}
              onQuoteClick={onQuoteClick}
            />
            {isStreaming && (
              <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse-glow" />
            )}
          </div>

          {/* Quote Cards for assistant messages */}
          {!isUser && !isStreaming && quotes.length > 0 && onQuoteClick && (
            <QuoteCardsList quotes={quotes} onQuoteClick={onQuoteClick} />
          )}

          {/* Cited pages - specific pages from quotes, not just source name */}
          {!isUser && !isStreaming && quotes.length > 0 && onQuoteClick && (
            <CitedPages quotes={quotes} onQuoteClick={onQuoteClick} />
          )}
        </div>
      </div>
    </div>
  );
};

/** Renders inline markdown (bold, italic, code) in a string. Returns React nodes. */
function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const parts: React.ReactNode[] = [];
  let remaining = text;
  const regex = /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`(.+?)`)/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      parts.push(remaining.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      parts.push(<strong key={`b-${match.index}`} className="font-semibold">{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      parts.push(<em key={`i-${match.index}`} className="italic">{match[4]}</em>);
    } else if (match[5] !== undefined) {
      parts.push(<code key={`c-${match.index}`} className="rounded bg-muted px-1 py-0.5 text-xs font-mono">{match[6]}</code>);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < remaining.length) {
    parts.push(remaining.slice(lastIndex));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

const MessageContent = ({ 
  content, 
  quotes = [], 
  onQuoteClick 
}: { 
  content: string; 
  quotes?: Quote[]; 
  onQuoteClick?: (quote: Quote) => void;
}) => {
  const renderLine = (line: string, lineKey: number) => {
    const parts: React.ReactNode[] = [];
    const citationRegex = /\[(\d+)\]/g;
    let lastIndex = 0;
    let match;
    while ((match = citationRegex.exec(line)) !== null) {
      const before = line.slice(lastIndex, match.index);
      if (before) parts.push(renderInlineMarkdown(before));
      const num = parseInt(match[1], 10);
      const quoteIndex = num - 1;
      const quote = quotes[quoteIndex];
      if (quote && onQuoteClick) {
        parts.push(
          <button
            key={`${lineKey}-${match.index}`}
            type="button"
            onClick={() => onQuoteClick(quote)}
            className="inline-flex align-baseline text-primary hover:underline font-medium cursor-pointer mx-0.5"
            title={quote.pageTitle}
          >
            [{num}]
          </button>
        );
      } else {
        // Orphaned citation - no matching quote (model used [n] but quote missing/filtered)
        parts.push(
          <span
            key={`${lineKey}-${match.index}`}
            className="inline-flex align-baseline text-muted-foreground/50 line-through mx-0.5"
            title="Citation not available"
          >
            [{num}]
          </span>
        );
      }
      lastIndex = citationRegex.lastIndex;
    }
    if (lastIndex < line.length) parts.push(renderInlineMarkdown(line.slice(lastIndex)));
    return parts.length > 1 ? <>{parts}</> : (parts[0] ?? line);
  };

  const lines = content.split('\n');
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        if (line.startsWith('**') && line.endsWith('**')) {
          return (
            <p key={i} className="font-semibold text-foreground">
              {renderInlineMarkdown(line.slice(2, -2))}
            </p>
          );
        }
        if (line.startsWith('- **')) {
          const match = line.match(/- \*\*(.+?)\*\*: (.+)/);
          if (match) {
            return (
              <div key={i} className="flex gap-2 pl-4">
                <span className="text-primary shrink-0 -ml-2">•</span>
                <span className="text-secondary-foreground">
                  <span className="font-medium text-foreground">{match[1]}:</span> {renderLine(match[2], i)}
                </span>
              </div>
            );
          }
        }
        if (line.startsWith('- ')) {
          return (
            <div key={i} className="flex gap-2 pl-4">
              <span className="text-primary shrink-0 -ml-2">•</span>
              <span className="text-secondary-foreground">{renderLine(line.slice(2), i)}</span>
            </div>
          );
        }
        if (line.match(/^\d+\. \*\*/)) {
          const match = line.match(/^(\d+)\. \*\*(.+?)\*\*: (.+)/);
          if (match) {
            return (
              <p key={i} className="text-secondary-foreground">
                <span className="font-medium text-foreground">{match[1]}. {match[2]}:</span> {renderLine(match[3], i)}
              </p>
            );
          }
        }
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }
        return (
          <p key={i} className="text-secondary-foreground leading-relaxed">
            {renderLine(line, i)}
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
