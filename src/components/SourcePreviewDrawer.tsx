import { useState } from 'react';
import { Quote } from '@/types/source';
import { mockPageContents } from '@/data/mockSourceContent';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExternalLink, Copy, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SourcePreviewDrawerProps {
  quote: Quote | null;
  allQuotes: Quote[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigateQuote: (quote: Quote) => void;
}

export const SourcePreviewDrawer = ({
  quote,
  allQuotes,
  open,
  onOpenChange,
  onNavigateQuote,
}: SourcePreviewDrawerProps) => {
  const [copied, setCopied] = useState(false);

  // Compute values even when quote is null to avoid conditional hooks
  const currentIndex = quote ? allQuotes.findIndex(q => q.id === quote.id) : -1;
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < allQuotes.length - 1;

  // Get mock content for this page
  const getPageContent = () => {
    if (!quote) return '';
    const contentKey = Object.keys(mockPageContents).find(key => 
      key.includes(quote.domain.split('.')[0]) || 
      quote.pagePath.toLowerCase().includes(key.split('-')[1] || '')
    );
    return contentKey ? mockPageContents[contentKey] : `
Page content for ${quote.pageTitle}

This is a mock preview of the source page. In a production environment, this would show the actual crawled content from the website.

The quoted snippet would be highlighted within the full context of the page, allowing you to understand the surrounding information.

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
    `;
  };

  const content = getPageContent();
  
  // Highlight the quoted snippet in the content
  const highlightedContent = quote ? content.replace(
    quote.snippet,
    `<mark class="bg-primary/30 text-foreground px-1 py-0.5 rounded">${quote.snippet}</mark>`
  ) : '';

  const handleCopy = async () => {
    if (!quote) return;
    await navigator.clipboard.writeText(`"${quote.snippet}" — ${quote.domain}${quote.pagePath}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenPage = () => {
    if (!quote) return;
    // In production, this would open the actual URL
    window.open(`https://${quote.domain}${quote.pagePath}`, '_blank', 'noopener,noreferrer');
  };

  // Always render Sheet for smooth animations
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {quote && (
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg bg-card border-l border-border p-0"
      >
        <SheetHeader className="p-6 pb-4 border-b border-border/50">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-serif truncate">
                {quote.pageTitle}
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-1 truncate">
                {quote.domain}{quote.pagePath}
              </p>
            </div>
          </div>

          {/* Navigation between quotes */}
          {allQuotes.length > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/30">
              <span className="text-xs text-muted-foreground">
                Quote {currentIndex + 1} of {allQuotes.length}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => hasPrevious && onNavigateQuote(allQuotes[currentIndex - 1])}
                  disabled={!hasPrevious}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => hasNext && onNavigateQuote(allQuotes[currentIndex + 1])}
                  disabled={!hasNext}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-200px)]">
          <div className="p-6 space-y-4">
            {/* Quoted snippet highlight */}
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
              <p className="text-sm font-serif italic text-foreground leading-relaxed">
                "{quote.snippet}"
              </p>
            </div>

            {/* Page content */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Page Context
              </h4>
              <div 
                className="prose prose-sm prose-invert max-w-none text-secondary-foreground"
                dangerouslySetInnerHTML={{ __html: highlightedContent }}
              />
            </div>
          </div>
        </ScrollArea>

        {/* Actions footer */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-border/50 bg-card/95 backdrop-blur-sm flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="flex-1 gap-2"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 text-emerald-400" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Copy quote
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenPage}
            className="flex-1 gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Open page
          </Button>
        </div>
      </SheetContent>
      )}
    </Sheet>
  );
};
