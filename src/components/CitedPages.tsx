import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { Quote as QuoteIcon } from 'lucide-react';

interface CitedPagesProps {
  quotes: Quote[];
  onQuoteClick: (quote: Quote) => void;
}

/** Dedupe quotes by pageId, keep first quote per page for click action */
function getUniquePages(quotes: Quote[]): Quote[] {
  const seen = new Set<string>();
  return quotes.filter((q) => {
    if (seen.has(q.pageId)) return false;
    seen.add(q.pageId);
    return true;
  });
}

export const CitedPages = ({ quotes, onQuoteClick }: CitedPagesProps) => {
  const pages = getUniquePages(quotes);
  if (pages.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/30">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium shrink-0">
        Pages cited
      </span>
      <div className="flex flex-wrap gap-1.5">
        {pages.map((quote) => (
          <button
            key={quote.pageId}
            onClick={() => onQuoteClick(quote)}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md',
              'bg-secondary/60 border border-border/30',
              'hover:bg-secondary hover:border-primary/30',
              'transition-all duration-200',
              'text-[11px] font-medium text-muted-foreground hover:text-foreground',
              'max-w-[180px] truncate'
            )}
            title={`${quote.pageTitle} – ${quote.domain}${quote.pagePath}`}
          >
            <QuoteIcon className="h-3 w-3 shrink-0 text-primary/70" />
            <span className="truncate">{quote.pageTitle || quote.pagePath || quote.domain}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
