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
import { ExternalLink, Copy, ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react';
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

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.
    `;
  };

  const content = getPageContent();
  
  // Split content into paragraphs and highlight the quoted snippet
  const renderHighlightedContent = () => {
    if (!quote) return null;
    
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    
    return paragraphs.map((paragraph, idx) => {
      if (paragraph.includes(quote.snippet)) {
        // This paragraph contains the quote - highlight it
        const parts = paragraph.split(quote.snippet);
        return (
          <div key={idx} className="relative pl-3 border-l-2 border-primary/60 bg-primary/5 py-2 -ml-3 pr-2 rounded-r-md">
            <p className="text-sm text-foreground leading-relaxed">
              {parts[0]}
              <mark className="bg-primary/30 text-foreground px-0.5 rounded font-medium">
                {quote.snippet}
              </mark>
              {parts[1]}
            </p>
          </div>
        );
      }
      return (
        <p key={idx} className="text-sm text-muted-foreground leading-relaxed">
          {paragraph.trim()}
        </p>
      );
    });
  };

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
        className="w-full sm:max-w-lg bg-card border-l border-border p-0 flex flex-col h-full"
      >
        {/* Header with prominent page info */}
        <SheetHeader className="p-6 pb-4 border-b border-border/50 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-serif leading-tight">
                {quote.pageTitle}
              </SheetTitle>
              <p className="text-xs text-muted-foreground mt-1 truncate flex items-center gap-1">
                <span className="text-primary/80">{quote.domain}</span>
                <span className="opacity-50">{quote.pagePath}</span>
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

        {/* Scrollable content area - fills remaining space */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-6 space-y-5">
            {/* Original quoted snippet - prominently highlighted */}
            <div className="space-y-2">
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Quoted Snippet
              </h4>
              <div className="relative pl-4 border-l-3 border-primary bg-primary/10 rounded-r-lg py-3 pr-4">
                <p className="text-sm font-serif italic text-foreground leading-relaxed">
                  "{quote.snippet}"
                </p>
              </div>
            </div>

            {/* Page content with highlighted quote */}
            <div className="space-y-3">
              <h4 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Page Context
              </h4>
              <div className="space-y-3">
                {renderHighlightedContent()}
              </div>
            </div>
          </div>
        </ScrollArea>

        {/* Actions footer - fixed at bottom */}
        <div className="p-4 border-t border-border/50 bg-card shrink-0 flex gap-2">
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
