import React, { useState } from 'react';
import { toast } from 'sonner';
import { User, Sparkles, Layers, Plus, Loader2 } from 'lucide-react';
import { Message, SuggestedPage } from '@/types/chat';
import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { QuoteCardsList } from './QuoteCard';
import { CitedPages } from './CitedPages';
import { CopyMessageButton } from './CopyMessageButton';
import { ThoughtProcessView } from './ThoughtProcessView';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ChatMessageProps {
  message: Message;
  /** Follow-up assistant message (add page + re-answer flow) - rendered below divider */
  followUp?: Message;
  isStreaming?: boolean;
  sources?: { id: string; domain: string }[];
  onQuoteClick?: (quote: Quote) => void;
  onSourceClick?: (sourceId: string) => void;
  onAddSuggestedPage?: (url: string, sourceId: string, questionToReask?: string, messageId?: string, scrapedPageDisplay?: string) => Promise<void>;
  conversationId?: string | null;
}

export const ChatMessage = ({
  message,
  followUp,
  isStreaming,
  onQuoteClick,
  onAddSuggestedPage,
  conversationId,
}: ChatMessageProps) => {
  const isUser = message.role === 'user';
  const quotes = message.quotes || [];
  const tp = message.thoughtProcess;
  const isComplex = (tp?.iterationCount ?? 0) > 2 || message.wasMultiStep;
  const completionPct = tp?.completeness != null ? Math.round(tp.completeness * 100) : null;

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
              {!isUser && isComplex && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 cursor-help"
                      tabIndex={0}
                    >
                      <Layers className="h-3 w-3" />
                      Complex
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[240px]">
                    <p className="font-medium">Complex</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      {tp?.iterationCount != null ? `Completed in ${tp.iterationCount} iteration(s).` : 'Took multiple steps to answer.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              )}
              {!isUser && completionPct != null && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border cursor-help"
                      tabIndex={0}
                    >
                      {completionPct}%
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="font-medium">Evidence completeness</p>
                    <p className="text-muted-foreground text-xs mt-0.5">
                      Slot coverage for this answer.
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

          {/* Thought process: when there's a follow-up, show combined panel in follow-up block (B4); otherwise show for this message */}
          {!isUser && !isStreaming && !followUp && tp && (tp.slots?.length || tp.steps?.length) ? (
            <ThoughtProcessView thoughtProcess={tp} suggestedPage={message.suggestedPage} isLive={false} defaultOpen={false} />
          ) : null}

          {/* Follow-up: separate assistant message after user added suggested page */}
          {!isUser && !isStreaming && followUp && (
            <>
              <div className="my-4 h-px bg-border" />
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm text-muted-foreground">
                    Scraped {followUp.scrapedPageDisplay || 'new page'}
                  </p>
                  {followUp.thoughtProcess?.completeness != null && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border cursor-help"
                          tabIndex={0}
                        >
                          {Math.round(followUp.thoughtProcess.completeness * 100)}%
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[200px]">
                        <p className="font-medium">Evidence: {Math.round(followUp.thoughtProcess.completeness * 100)}%</p>
                        <p className="text-muted-foreground text-xs mt-0.5">Slot coverage for this answer.</p>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <CopyMessageButton message={followUp} className="h-8 w-8 shrink-0 opacity-70 hover:opacity-100" />
              </div>
              <div className="space-y-2">
                <div className="prose prose-invert prose-sm max-w-none">
                  <MessageContent 
                    content={followUp.content} 
                    quotes={followUp.quotes ?? []}
                    onQuoteClick={onQuoteClick}
                  />
                </div>
                {(followUp.quotes?.length ?? 0) > 0 && onQuoteClick && (
                  <QuoteCardsList quotes={followUp.quotes ?? []} onQuoteClick={onQuoteClick} />
                )}
                {(followUp.quotes?.length ?? 0) > 0 && onQuoteClick && (
                  <CitedPages quotes={followUp.quotes ?? []} onQuoteClick={onQuoteClick} />
                )}
                {followUp.thoughtProcess && (followUp.thoughtProcess.slots?.length || followUp.thoughtProcess.steps?.length) ? (
                  <ThoughtProcessView
                    thoughtProcess={followUp.thoughtProcess}
                    thoughtProcessBefore={tp && (tp.slots?.length || tp.steps?.length) ? tp : undefined}
                    suggestedPage={message.suggestedPage}
                    isLive={false}
                    defaultOpen={false}
                  />
                ) : null}
              </div>
            </>
          )}

          {/* "Would you like to index X?" when context can't answer (hidden when follow-up exists) */}
          {!isUser && !isStreaming && !followUp && message.suggestedPage && onAddSuggestedPage && conversationId && (
            <IndexSuggestionCard
              suggestedPage={message.suggestedPage}
              messageId={message.id}
              onAddAndReask={onAddSuggestedPage}
            />
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
  const remaining = text;
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
        const trimmed = line.trimStart();
        if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
          return (
            <p key={i} className="font-semibold text-foreground">
              {renderInlineMarkdown(trimmed.slice(2, -2))}
            </p>
          );
        }
        if (trimmed.startsWith('- **')) {
          const match = trimmed.match(/- \*\*(.+?)\*\*: (.+)/);
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
        if (trimmed.startsWith('- ')) {
          const contentStart = line.length - trimmed.length + 2;
          return (
            <div key={i} className="flex gap-2 pl-4">
              <span className="text-primary shrink-0 -ml-2">•</span>
              <span className="text-secondary-foreground">{renderLine(line.slice(contentStart), i)}</span>
            </div>
          );
        }
        if (trimmed.match(/^\d+\. \*\*/)) {
          const match = trimmed.match(/^(\d+)\. \*\*(.+?)\*\*: (.+)/);
          if (match) {
            return (
              <p key={i} className="text-secondary-foreground">
                <span className="font-medium text-foreground">{match[1]}. {match[2]}:</span> {renderLine(match[3], i)}
              </p>
            );
          }
        }
        if (trimmed === '') {
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

function getDomainDisplay(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host === 'en.wikipedia.org' || host.endsWith('.wikipedia.org')) return 'Wikipedia';
    return host;
  } catch {
    return '';
  }
}

function IndexSuggestionCard({
  suggestedPage,
  messageId,
  onAddAndReask,
}: {
  suggestedPage: SuggestedPage;
  messageId: string;
  onAddAndReask: (url: string, sourceId: string, questionToReask?: string, messageId?: string, scrapedPageDisplay?: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const sp = suggestedPage;

  const key = `${sp.sourceId}:${sp.url}`;
  const isAdding = adding === key;
  const hasReask = !!sp.promptedByQuestion;
  const scrapedPageDisplay = `${sp.title} - ${getDomainDisplay(sp.url)}`.replace(/ - $/, '');

  const handleYes = async () => {
    setAdding(key);
    console.log('[IndexSuggestion] Yes clicked', { url: sp.url, sourceId: sp.sourceId, question: sp.promptedByQuestion });
    try {
      await onAddAndReask(sp.url, sp.sourceId, sp.promptedByQuestion, messageId, scrapedPageDisplay);
      console.log('[IndexSuggestion] onAddAndReask completed successfully');
      setAdded(true);
    } catch (err) {
      console.error('[IndexSuggestion] onAddAndReask failed:', err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Failed to add page', { description: msg });
    } finally {
      setAdding(null);
    }
  };

  if (added) return null;

  const branchingText = sp.fromPageTitle ? ` (branching out from "${sp.fromPageTitle}")` : '';

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-4">
      <p className="text-sm text-foreground mb-3">
        Would you like to index <strong>{sp.title}</strong>{branchingText}? {hasReask && 'I\'ll add it to the graph and answer your question with the new context.'}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleYes}
          disabled={isAdding}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isAdding ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {hasReask ? 'Adding & answering...' : 'Adding...'}
            </>
          ) : (
            'Yes'
          )}
        </button>
        <button
          type="button"
          onClick={() => setAdded(true)}
          disabled={isAdding}
          className="px-4 py-2 rounded-md text-sm font-medium border border-border hover:bg-secondary disabled:opacity-50"
        >
          No
        </button>
      </div>
    </div>
  );
}

interface TypingIndicatorProps {
  /** When true, show only three dots (no icon/name). Used when adding suggested page + waiting for answer. */
  minimal?: boolean;
  /** RAG step progress labels (e.g. "Gathering context", "Extracting...") */
  stepLabels?: Array<{ current: number; total: number; label: string }>;
}

export const TypingIndicator = ({ minimal = false, stepLabels = [] }: TypingIndicatorProps) => {
  const currentStep = stepLabels.length > 0 ? stepLabels[stepLabels.length - 1] : null;

  // Shared layout: same as ChatMessage assistant row (py-6, max-w-3xl, avatar + content)
  const containerClass = 'flex gap-4 px-4 py-6 bg-chat-assistant animate-fade-in';
  const innerClass = 'max-w-3xl mx-auto w-full flex gap-4';
  const avatarClass = 'shrink-0 w-8 h-8 rounded-lg flex items-center justify-center bg-primary/20';
  const contentClass = 'flex-1 space-y-2 min-w-0';

  if (minimal) {
    // Adding suggested page: show as a proper assistant row (avatar + "Indexing…" + dots)
    return (
      <div className={containerClass}>
        <div className={innerClass}>
          <div className={avatarClass} aria-hidden>
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div className={contentClass}>
            <p className="text-sm font-medium text-muted-foreground">Scholia</p>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Indexing…</span>
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
              </span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        <div className={avatarClass}>
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className={contentClass}>
          <p className="text-sm font-medium text-muted-foreground">Scholia</p>
          {currentStep ? (
            <p className="text-xs text-muted-foreground">{currentStep.label}</p>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Thinking…</span>
              <span className="flex gap-1">
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
                <span className="w-2 h-2 rounded-full bg-muted-foreground typing-dot" />
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
