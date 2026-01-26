import { Quote } from '@/types/source';
import { cn } from '@/lib/utils';
import { Quote as QuoteIcon, ExternalLink } from 'lucide-react';

interface QuoteCardProps {
  quote: Quote;
  onClick: () => void;
}

export const QuoteCard = ({ quote, onClick }: QuoteCardProps) => {
  const initial = quote.domain.charAt(0).toUpperCase();

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left group',
        'bg-secondary/40 hover:bg-secondary/60',
        'border border-border/50 hover:border-primary/30',
        'rounded-lg p-4 transition-all duration-200',
        'hover:shadow-[0_0_20px_hsl(var(--primary)/0.1)]'
      )}
    >
      {/* Quote icon */}
      <div className="flex items-start gap-3">
        <QuoteIcon className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
        
        {/* Quote text */}
        <div className="flex-1 min-w-0 space-y-3">
          <p className="text-base text-foreground/90 leading-relaxed line-clamp-3 font-serif italic">
            "{quote.snippet}"
          </p>
          
          {/* Source footer */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-semibold bg-primary/20 text-primary">
              {initial}
            </div>
            <span className="font-medium text-foreground/70">{quote.domain}</span>
            <span className="text-muted-foreground/50">•</span>
            <span className="truncate">{quote.pageTitle}</span>
            <ExternalLink className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </div>
      </div>
    </button>
  );
};

interface QuoteCardsListProps {
  quotes: Quote[];
  onQuoteClick: (quote: Quote) => void;
}

export const QuoteCardsList = ({ quotes, onQuoteClick }: QuoteCardsListProps) => {
  if (quotes.length === 0) return null;

  return (
    <div className="space-y-2 mt-4">
      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
        Evidence
      </p>
      <div className="space-y-2">
        {quotes.map((quote) => (
          <QuoteCard
            key={quote.id}
            quote={quote}
            onClick={() => onQuoteClick(quote)}
          />
        ))}
      </div>
    </div>
  );
};
