import { Source } from '@/types/source';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RefreshCw, Trash2, Check, Loader2, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ForceGraph } from './graph';
import { CrawlStats } from './CrawlStats';
import { useMemo } from 'react';

interface SourceDrawerProps {
  source: Source | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecrawl: (sourceId: string) => void;
  onRemove: (sourceId: string) => void;
}

const getStatusBadge = (status: Source['status']) => {
  switch (status) {
    case 'ready':
      return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Ready</Badge>;
    case 'crawling':
      return <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Crawling</Badge>;
    case 'error':
      return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Error</Badge>;
    case 'outdated':
      return <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">Outdated</Badge>;
  }
};

const getPageStatusIcon = (status: string) => {
  switch (status) {
    case 'indexed':
      return <Check className="h-3 w-3 text-emerald-400" />;
    case 'crawling':
      return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
    case 'pending':
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case 'error':
      return <AlertTriangle className="h-3 w-3 text-destructive" />;
    default:
      return null;
  }
};

const getDepthLabel = (depth: string) => {
  switch (depth) {
    case 'shallow': return 'Shallow';
    case 'medium': return 'Medium';
    case 'deep': return 'Deep';
    default: return depth;
  }
};

export const SourceDrawer = ({
  source,
  open,
  onOpenChange,
  onRecrawl,
  onRemove,
}: SourceDrawerProps) => {
  const initial = source?.domain.charAt(0).toUpperCase() || '';
  
  // Calculate connection count (mock based on indexed pages)
  const connectionsFound = useMemo(() => {
    if (!source) return 0;
    return Math.floor(source.pagesIndexed * 1.5);
  }, [source?.pagesIndexed]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-md bg-card border-l border-border p-0 flex flex-col h-[100dvh] max-h-[100dvh] overflow-hidden"
      >
        {source ? (
          <>
            <SheetHeader className="p-6 pb-4 border-b border-border/50 shrink-0">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-semibold bg-primary/20 text-primary">
                  {initial}
                </div>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-lg font-serif truncate">
                    {source.domain}
                  </SheetTitle>
                  <SheetDescription className="text-xs truncate">
                    {source.url}
                  </SheetDescription>
                </div>
              </div>
              
              <div className="flex items-center gap-2 mt-4">
                {getStatusBadge(source.status)}
                <span className="text-xs text-muted-foreground">
                  {source.pagesIndexed}/{source.totalPages} pages
                </span>
              </div>
            </SheetHeader>

            {/* Fixed content section */}
            <div className="p-6 space-y-6 shrink-0">
              {/* Crawl Stats */}
              <CrawlStats
                pagesDiscovered={source.totalPages}
                pagesIndexed={source.pagesIndexed}
                connectionsFound={connectionsFound}
                isCrawling={source.status === 'crawling'}
              />
              
              {/* Knowledge Graph */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Page Graph</h4>
                <ForceGraph
                  pages={source.discoveredPages}
                  pagesIndexed={source.pagesIndexed}
                  domain={source.domain}
                  className="h-[200px]"
                />
              </div>

              {/* Settings summary */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Settings</h4>
                <div className="text-xs text-muted-foreground space-y-1 bg-background/50 rounded-lg p-3 border border-border/50">
                  <div className="flex justify-between">
                    <span>Depth:</span>
                    <span className="text-foreground">{getDepthLabel(source.crawlDepth)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Include subpages:</span>
                    <span className="text-foreground">{source.includeSubpages ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Include PDFs:</span>
                    <span className="text-foreground">{source.includePdfs ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Same domain only:</span>
                    <span className="text-foreground">{source.sameDomainOnly ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last updated:</span>
                    <span className="text-foreground">{source.lastUpdated.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRecrawl(source.id)}
                  disabled={source.status === 'crawling'}
                  className="flex-1 gap-2"
                >
                  <RefreshCw className={cn(
                    "h-4 w-4",
                    source.status === 'crawling' && 'animate-spin'
                  )} />
                  Recrawl
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onRemove(source.id);
                    onOpenChange(false);
                  }}
                  className="flex-1 gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Remove
                </Button>
              </div>
            </div>

            {/* Discovered pages - scrollable section that fills remaining height */}
            <div className="flex-1 min-h-0 flex flex-col px-6 pb-6">
              <h4 className="text-sm font-medium text-foreground mb-2 shrink-0">
                Discovered Pages ({source.discoveredPages.length})
              </h4>
              <div className="flex-1 min-h-0 rounded-lg border border-border/50 bg-background/30 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-2 space-y-1">
                    {source.discoveredPages.map((page) => (
                      <div
                        key={page.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-secondary/50 transition-colors cursor-pointer"
                        onClick={() => window.open(`https://${source.domain}${page.path}`, '_blank', 'noopener,noreferrer')}
                      >
                        {getPageStatusIcon(page.status)}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground truncate">{page.title}</p>
                          <p className="text-[11px] text-muted-foreground truncate">{page.path}</p>
                        </div>
                        <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </>
        ) : (
          <div className="p-6 text-center text-muted-foreground">
            Select a source to view details
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
