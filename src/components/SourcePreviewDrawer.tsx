import { useState } from 'react';
import { Quote } from '@/types/source';
import { cleanPageTitleForDisplay } from '@/lib/sourceDisplay';
import { encodeTextForFragment } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ExternalLink, Copy, ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react';

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

  // Use canonical pageUrl from backend when available (avoids domain+path bugs e.g. wrong domain)
  const baseUrl = quote?.pageUrl ?? (quote ? `https://${quote.domain}${quote.pagePath}` : '');
  const baseNoHash = baseUrl ? baseUrl.split('#')[0] : '';
  // Scroll to Text Fragment: highlight and scroll to the quoted snippet on the source page (supported in Chrome, Edge, Safari 16.4+)
  // Use full snippet; truncate at word boundary only if very long (URL limit ~2k, encoded text expands)
  const textForFragment = (() => {
    if (!quote?.snippet) return '';
    const trimmed = quote.snippet.trim();
    const maxChars = 600; // Leaves room for base URL + encoding overhead
    if (trimmed.length <= maxChars) return trimmed;
    const truncated = trimmed.slice(0, maxChars);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > maxChars * 0.5 ? truncated.slice(0, lastSpace) : truncated;
  })();
  const openPageUrl = quote && textForFragment && baseNoHash
    ? `${baseNoHash}#:~:text=${encodeTextForFragment(textForFragment)}`
    : baseUrl;

  const handleCopy = async () => {
    if (!quote) return;
    await navigator.clipboard.writeText(`"${quote.snippet}" — ${quote.domain}${quote.pagePath}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenPage = () => {
    if (!openPageUrl) return;
    window.open(openPageUrl, '_blank', 'noopener,noreferrer');
  };

  // Always render Sheet for smooth animations
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {quote && (
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg bg-card border-l border-border p-0 flex flex-col gap-0 h-[100dvh] max-h-[100dvh] overflow-hidden"
      >
        {/* Header with prominent page info */}
        <SheetHeader className="p-6 pb-4 border-b border-border/50 shrink-0">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary/10 text-primary shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-lg font-serif leading-tight">
                {cleanPageTitleForDisplay(quote.pageTitle, quote.domain)}
              </SheetTitle>
              <SheetDescription className="sr-only">
                Quote and surrounding context from the cited source page
              </SheetDescription>
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
          <div className="px-6 pb-6 pt-4 space-y-5">
            {/* Snippet with surrounding context from the source */}
            <div className="space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                In context
              </h4>
              <div className="relative pl-4 border-l-4 border-primary bg-primary/10 rounded-r-lg py-3 pr-4 space-y-1">
                {quote.contextBefore && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {quote.contextBefore}
                  </p>
                )}
                <p className="text-base font-serif italic text-foreground leading-relaxed">
                  "{quote.snippet}"
                </p>
                {quote.contextAfter && (
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {quote.contextAfter}
                  </p>
                )}
              </div>
            </div>

            {/* Link to open source page (with Scroll to Text Fragment so the snippet is highlighted) */}
            <div className="pt-2">
              <a
                href={openPageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  handleOpenPage();
                }}
              >
                <ExternalLink className="h-4 w-4" />
                Open source page
              </a>
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
