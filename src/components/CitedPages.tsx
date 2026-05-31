import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { cleanPageTitleForDisplay } from '@/lib/sourceDisplay';
import { Quote as QuoteIcon } from 'lucide-react';

interface CitedPagesProps {
  quotes: Quote[];
  onQuoteClick: (quote: Quote) => void;
}


function getUniquePages(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    const key = q.pageId ?? q.pageUrl ?? q.snippet;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const CitedPages = ({ quotes, onQuoteClick }: CitedPagesProps) => {
  const pages = getUniquePages(quotes);
  if (pages.length === 0) return null;

  return (
    <div className="flex flex-wrap items-start gap-2 mt-3 mb-10 pt-3 border-t border-border/30 min-w-0">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium shrink-0">
        Pages cited
      </span>
      <div className="flex flex-wrap gap-1.5 min-w-0 flex-1">
        {pages.map((quote) => (
          <button
            key={quote.pageId ?? quote.pageUrl ?? quote.snippet}
            onClick={() => onQuoteClick(quote)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md max-w-full',
              'bg-secondary/60 border border-border/30',
              'hover:bg-secondary hover:border-primary/30',
              'transition-all duration-200',
              'text-[11px] font-medium text-muted-foreground hover:text-foreground text-left',
              'max-w-[min(100%,20rem)] sm:max-w-[min(100%,28rem)]'
            )}
            title={`${quote.pageTitle || quote.pagePath} – ${quote.domain}${quote.pagePath}`}
          >
            <QuoteIcon className="h-3 w-3 shrink-0 text-primary/70" />
            <span className="break-words leading-snug">
              {cleanPageTitleForDisplay(quote.pageTitle) || quote.pagePath || quote.domain}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};