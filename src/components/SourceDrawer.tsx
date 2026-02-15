import { Source } from '@/types/source';
import { getSourceDisplayLabel } from '@/lib/sourceDisplay';
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
import { useConversationPages, useConversationPageEdges } from '@/hooks/usePages';
import { crawlJobsApi } from '@/lib/db/crawl-jobs';
import { useQuery } from '@tanstack/react-query';
// MAX_PAGES defined inline

interface SourceDrawerProps {
  source: Source | null;
  conversationId: string | null;
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
  conversationId,
  open,
  onOpenChange,
  onRecrawl,
  onRemove,
}: SourceDrawerProps) => {
  const displayName = source ? getSourceDisplayLabel(source) : '';
  const initial = displayName.charAt(0).toUpperCase() || '';

  // Crawl job and status first so we can pass refetchInterval when crawling
  const { data: crawlJobsData = [] } = useQuery({
    queryKey: ['crawl-jobs-for-source-drawer', source?.id],
    queryFn: async () => {
      if (!source?.id) return [];
      return crawlJobsApi.listBySource(source.id);
    },
    enabled: !!source?.id,
  });

  const crawlJob = useMemo(() => {
    if (!crawlJobsData.length) return null;
    return crawlJobsData.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  }, [crawlJobsData]);

  const realStatus: Source['status'] = useMemo(() => {
    if (!source) return 'crawling';
    if (crawlJob) {
      if (crawlJob.status === 'queued' || crawlJob.status === 'running') return 'crawling';
      if (crawlJob.status === 'failed') return 'error';
      if (crawlJob.status === 'completed') return 'ready';
    }
    return source.status || 'crawling';
  }, [source, crawlJob]);

  // Use the conversation that ran the crawl so we get the right pages/edges (can differ from active conversation)
  const graphConversationId = crawlJob?.conversation_id ?? conversationId;

  // Poll pages and edges while crawling so the graph updates even if realtime doesn't deliver
  const pollInterval = realStatus === 'crawling' ? 2000 : false;
  const { data: allPages = [], isLoading: pagesLoading } = useConversationPages(graphConversationId, {
    refetchInterval: pollInterval,
  });
  const { data: allEdges = [], isLoading: edgesLoading } = useConversationPageEdges(graphConversationId, {
    refetchInterval: pollInterval,
  });

  // Filter pages and edges for the selected source only (no inference fallback)
  const sourcePages = useMemo(() => {
    if (!source) return [];
    return allPages.filter(p => p.source_id === source.id && p.status === 'indexed');
  }, [allPages, source?.id]);

  const sourceEdges = useMemo(() => {
    if (!source) return [];
    return allEdges.filter(e => e.source_id === source.id);
  }, [allEdges, source?.id]);

  const pagesIndexed = useMemo(() => {
    if (crawlJob) {
      const fromJob = (crawlJob as any).indexed_count ?? crawlJob.pages_indexed ?? sourcePages.length;
      // Job can report 0 before first update; never show fewer nodes than pages we have
      return Math.max(fromJob, sourcePages.length);
    }
    return sourcePages.length;
  }, [crawlJob, sourcePages.length]);
  
  const pagesDiscovered = useMemo(() => {
    if (crawlJob) {
      return (crawlJob as any).discovered_count ?? 0;
    }
    return sourcePages.length;
  }, [crawlJob, sourcePages.length]);
  
  const maxPagesForDepth = useMemo(() => {
    if (!source) return 0;
    return source.crawlDepth === 'shallow' ? 5 : source.crawlDepth === 'medium' ? 15 : 35;
  }, [source?.crawlDepth]);

  const connectionsFound = sourceEdges.length;

  // Diagnostic: why edges might be 0 at graph (DEV only)
  if (import.meta.env.DEV && source && sourcePages.length > 0) {
    console.log('[SourceDrawer] edges pipeline', {
      allEdgesCount: allEdges.length,
      sourceEdgesCount: sourceEdges.length,
      sourceId: source.id.slice(0, 8),
      firstEdgeSourceId: allEdges[0]?.source_id?.slice(0, 8),
    });
  }

  // Diagnostic: what we pass to the graph (DEV only, when drawer has source and we have edges)
  if (import.meta.env.DEV && source && sourcePages.length > 0 && sourceEdges.length > 0) {
    const firstPage = sourcePages[0];
    const firstEdge = sourceEdges[0];
    console.log('[SourceDrawer] graph inputs', {
      sourceId: source.id.slice(0, 8),
      displayPagesCount: sourcePages.length,
      pagesIndexed,
      sourceEdgesCount: sourceEdges.length,
      firstPageUrl: firstPage?.url?.slice(0, 60),
      firstEdgeFromUrl: firstEdge?.from_url?.slice(0, 60),
      firstEdgeToUrl: firstEdge?.to_url?.slice(0, 60),
      firstEdgeFromPageId: firstEdge?.from_page_id?.slice(0, 8),
      firstEdgeToPageId: firstEdge?.to_page_id?.slice(0, 8),
    });
  }

  // Convert pages to DiscoveredPage format for ForceGraph
  const displayPages = useMemo(() => {
    return sourcePages.map(p => ({
      id: p.id,
      title: p.title || 'Untitled',
      path: p.path,
      status: (p.status || 'indexed') as 'indexed' | 'crawling' | 'pending' | 'error',
      url: p.url,
    }));
  }, [sourcePages]);

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
                    {getSourceDisplayLabel(source)}
                  </SheetTitle>
                  <SheetDescription className="text-xs truncate">
                    {source.url}
                  </SheetDescription>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4">
                {getStatusBadge(realStatus)}
                <span className="text-xs text-muted-foreground">
                  {pagesIndexed}/{maxPagesForDepth} pages
                </span>
              </div>
            </SheetHeader>

            <div className="p-6 space-y-6 shrink-0">
              <CrawlStats
                pagesDiscovered={pagesDiscovered}
                pagesIndexed={pagesIndexed}
                connectionsFound={connectionsFound}
                isCrawling={realStatus === 'crawling'}
              />

              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Page Graph</h4>
                {pagesLoading || edgesLoading ? (
                  <div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Loading graph...
                  </div>
                ) : (
                  <ForceGraph
                    pages={displayPages}
                    pagesIndexed={pagesIndexed}
                    domain={source.domain}
                    edges={sourceEdges}
                    className="h-[200px]"
                  />
                )}
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
                  disabled={realStatus === 'crawling'}
                  className="flex-1 gap-2"
                >
                  <RefreshCw className={cn(
                    "h-4 w-4",
                    realStatus === 'crawling' && 'animate-spin'
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
                Discovered Pages ({displayPages.length})
              </h4>
              <div className="flex-1 min-h-0 rounded-lg border border-border/50 bg-background/30 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-2 space-y-1">
                    {pagesLoading ? (
                      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Loading pages...
                      </div>
                    ) : displayPages.length === 0 ? (
                      <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                        No pages discovered yet
                      </div>
                    ) : (
                      displayPages.map((page) => (
                        <div
                          key={page.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-secondary/50 transition-colors cursor-pointer"
                          onClick={() => {
                            const url = page.url || `https://${source.domain}${page.path}`;
                            window.open(url, '_blank', 'noopener,noreferrer');
                          }}
                        >
                          {getPageStatusIcon(page.status)}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-foreground truncate">{page.title}</p>
                            <p className="text-[11px] text-muted-foreground truncate">{page.path}</p>
                          </div>
                          <ExternalLink className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                        </div>
                      ))
                    )}
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
