import { useState, useMemo, useRef } from 'react';
import { Source } from '@/types/source';
import { ForceGraph } from './graph';
import { cn } from '@/lib/utils';
import { getSourceDisplayLabel } from '@/lib/sourceDisplay';
import { useConversationPages, useConversationPageEdges } from '@/hooks/usePages';
import { useConversationSources } from '@/hooks/useConversationSources';
import { useAddPageJob } from '@/hooks/useAddPageJob';
import { crawlJobsApi, discoveredLinksApi } from '@/lib/db';
import type { CrawlJob } from '@/lib/db/types';
import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EncodingProgressBar, getEncodingPhase, getEncodingStatusLabel } from './EncodingProgressBar';

interface SidebarCrawlPanelProps {
  sources: Source[];
  className?: string;
  conversationId?: string | null;
  addingPageSourceId?: string | null;
}

export const SidebarCrawlPanel = ({ sources, className, conversationId, addingPageSourceId }: SidebarCrawlPanelProps) => {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);

  const sourceIds = useMemo(() => sources.map(s => s.id), [sources]);
  const { data: crawlJobsData = [] } = useQuery({
    queryKey: ['crawl-jobs-for-sources', sourceIds, conversationId ?? ''],
    queryFn: async () => {
      if (!conversationId || sourceIds.length === 0) return [];
      return crawlJobsApi.listBySourceAndConversation(sourceIds, conversationId);
    },
    enabled: sourceIds.length > 0 && !!conversationId,
  });

  const { data: conversationSources = [] } = useConversationSources(conversationId);
  const { data: addPageJob } = useAddPageJob(conversationId ?? null, addingPageSourceId ?? null);

  const { data: pages = [], isLoading: pagesLoading, error: pagesError } = useConversationPages(conversationId);

  // Freeze totalPages for add-page flow: capture initial page count when add starts, use initial+1 as max throughout
  const prevAddingRef = useRef<string | null>(null);
  const addPageInitialCountRef = useRef<number>(0);
  if (addingPageSourceId) {
    if (prevAddingRef.current !== addingPageSourceId) {
      addPageInitialCountRef.current = pages.filter((p) => p.source_id === addingPageSourceId).length;
      prevAddingRef.current = addingPageSourceId;
    }
  } else {
    prevAddingRef.current = null;
  }
  const { data: edges = [], isLoading: edgesLoading, error: edgesError } = useConversationPageEdges(conversationId);
  const { data: discoveredCountsMap = {} } = useQuery({
    queryKey: ['discovered-links-counts', conversationId],
    queryFn: () => (conversationId ? discoveredLinksApi.countsByConversation(conversationId) : {}),
    enabled: !!conversationId,
  });
  const { data: encodedDiscoveredCountsMap = {} } = useQuery({
    queryKey: ['discovered-links-encoded-counts', conversationId],
    queryFn: () => (conversationId ? discoveredLinksApi.countsEncodedByConversation(conversationId) : {}),
    enabled: !!conversationId && sources.some(s => s.crawlDepth === 'dynamic'),
  });

  // Create a map of sourceId -> crawlJob
  const crawlJobMap = useMemo(() => {
    const map = new Map<string, typeof crawlJobsData[0]>();
    crawlJobsData.forEach(job => {
      // Get the most recent job for each source
      const existing = map.get(job.source_id);
      if (!existing || new Date(job.created_at) > new Date(existing.created_at)) {
        map.set(job.source_id, job);
      }
    });
    return map;
  }, [crawlJobsData]);
  
  // Determine status and stats from crawl jobs and pages
  const sourcesWithStatus = useMemo(() => {
    return sources.map(source => {
      const sourcePages = pages.filter(p => p.source_id === source.id);
      const crawlJob = crawlJobMap.get(source.id);
      
      // Determine status from crawl job
      // Default to 'crawling' if no crawl job yet (source was just added)
      let status: Source['status'] = 'crawling';
      let pagesIndexed = sourcePages.length;
      let totalPages = sourcePages.length;
      
      if (crawlJob) {
        if (addingPageSourceId === source.id) {
          status = 'crawling';
        } else if (crawlJob.status === 'queued' || crawlJob.status === 'running' || crawlJob.status === 'indexing') {
          status = 'crawling';
        } else if (crawlJob.status === 'failed') {
          status = 'error';
        } else if (crawlJob.status === 'completed') {
          status = 'ready';
        }
        
        // Use indexed_count if available, fallback to pages_indexed; prefer actual DB count when we have pages
        const jobIndexed = (crawlJob as CrawlJob).indexed_count ?? crawlJob.pages_indexed ?? 0;
        pagesIndexed = Math.max(jobIndexed, sourcePages.length);
        // For dynamic + add-page: target = current+1 until page is inserted. Once addPageJob is encoding/completed,
        // the new page is in DB so use sourcePages.length (avoids 2/3 when realtime delivers page before status update).
        const maxPagesForDepth = source.crawlDepth === 'dynamic' || source.crawlDepth === 'singular' ? 1 : source.crawlDepth === 'shallow' ? 5 : source.crawlDepth === 'medium' ? 15 : 35;
        if (source.crawlDepth === 'dynamic') {
          if (addingPageSourceId === source.id) {
            const jobDone = addPageJob?.status === 'encoding' || addPageJob?.status === 'completed';
            // Use frozen initial+1 as max until job done (avoids 2/3 when realtime delivers new page before status update)
            const frozenInitial = addPageInitialCountRef.current || sourcePages.length;
            totalPages = jobDone ? sourcePages.length : frozenInitial + 1;
          } else {
            totalPages = Math.max(sourcePages.length, 1);
          }
        } else {
          totalPages = maxPagesForDepth;
        }
      } else {
        // No crawl job: either being created, or add-page flow (edge function, no job)
        status = 'crawling';
        pagesIndexed = sourcePages.length;
        if (source.crawlDepth === 'dynamic') {
          if (addingPageSourceId === source.id) {
            const jobDone = addPageJob?.status === 'encoding' || addPageJob?.status === 'completed';
            // Use frozen initial+1 as max until job done (avoids 2/3)
            const frozenInitial = addPageInitialCountRef.current || sourcePages.length;
            totalPages = jobDone ? sourcePages.length : frozenInitial + 1;
          } else {
            totalPages = Math.max(sourcePages.length, 1);
          }
        } else {
          totalPages = 1;
        }
      }
      
      return {
        ...source,
        status,
        pagesIndexed,
        totalPages,
        discoveredPages: sourcePages.map(p => ({
          id: p.id,
          title: p.title || 'Untitled',
          path: p.path,
          url: p.url,
          status: (p.status || 'indexed') as 'indexed' | 'discovered' | 'failed',
        })),
      };
    });
  }, [sources, crawlJobMap, pages, addingPageSourceId, addPageJob?.status]);
  
  const crawlingSources = sourcesWithStatus.filter(s => s.status === 'crawling');
  
  // Get active source or show all
  const activeSource = activeSourceId ? sourcesWithStatus.find(s => s.id === activeSourceId) : null;
  const displaySources = activeSource ? [activeSource] : sourcesWithStatus;
  
  // Aggregate stats - for dynamic use discovered_links count (includes add-page); else crawl job
  const totalDiscovered = displaySources.reduce((sum, s) => {
    const dlCount = discoveredCountsMap[s.id] ?? 0;
    const crawlJob = crawlJobMap.get(s.id);
    const jobDiscovered = crawlJob ? ((crawlJob as CrawlJob).discovered_count ?? 0) : 0;
    if (s.crawlDepth === 'dynamic') {
      return sum + Math.max(jobDiscovered, dlCount);
    }
    return sum + jobDiscovered;
  }, 0);
  const totalIndexed = displaySources.reduce((sum, s) => sum + s.pagesIndexed, 0);
  const totalEncodedDiscovered = displaySources.reduce(
    (sum, s) => sum + (encodedDiscoveredCountsMap[s.id] ?? 0),
    0
  );
  
  const isCrawling = crawlingSources.length > 0 || !!addingPageSourceId;
  const isIndexingFromJob = displaySources.some(s => crawlJobMap.get(s.id)?.status === 'indexing');
  const isAddingPageFlow = !!addingPageSourceId && displaySources.some(s => s.id === addingPageSourceId);
  const addPagePhase = addPageJob?.status;
  const isAddPageQueued = addPagePhase === 'queued';
  const isAddPageIndexing = addPagePhase === 'indexing';
  const isAddPageEncoding = addPagePhase === 'encoding';
  const isAddPageResponding = addPagePhase === 'completed' && !!addingPageSourceId;
  const hasAnySources = sources.length > 0;

  // Five states: Crawling (static) | Adding Page (dynamic add) | Scraping Page (dynamic worker) | Indexing Crawled Pages | Encoding Discovered Pages | Responding (add-page done, chat answering)
  const indexingJob = displaySources.find(s => crawlJobMap.get(s.id)?.status === 'indexing');
  const crawlJob = indexingJob ? crawlJobMap.get(indexingJob.id) : null;
  const isDynamic = displaySources.some(s => s.crawlDepth === 'dynamic');
  const encChunksDone = isAddPageEncoding && addPageJob ? (addPageJob.encoding_chunks_done ?? 0) : (crawlJob as CrawlJob | null)?.encoding_chunks_done ?? 0;
  const encChunksTotal = isAddPageEncoding && addPageJob ? (addPageJob.encoding_chunks_total ?? 0) : (crawlJob as CrawlJob | null)?.encoding_chunks_total ?? 0;
  const encDiscoveredDone = isAddPageEncoding && addPageJob ? (addPageJob.encoding_discovered_done ?? 0) : (crawlJob as CrawlJob | null)?.encoding_discovered_done ?? 0;
  const encDiscoveredTotal = isAddPageEncoding && addPageJob ? (addPageJob.encoding_discovered_total ?? 0) : (crawlJob as CrawlJob | null)?.encoding_discovered_total ?? 0;
  const encodingPhase = getEncodingPhase(
    isCrawling && !activeSource,
    isIndexingFromJob || isAddPageEncoding,
    encChunksTotal,
    encChunksDone,
    encDiscoveredTotal
  );
  const statusLabel = getEncodingStatusLabel(
    encodingPhase,
    isAddPageResponding,
    isAddPageQueued || isAddPageIndexing,
    isAddPageEncoding,
    isIndexingFromJob,
    isDynamic
  );
  // When adding a page, show progress for ONLY the adding source (avoid 2/3 from multi-source aggregation)
  const progressSources = isAddingPageFlow && addingPageSourceId
    ? sourcesWithStatus.filter(s => s.id === addingPageSourceId)
    : displaySources;

  // Get pages for current view - use pages directly from database (already filtered by conversation and status='indexed')
  // Filter by active source if one is selected, then convert to DiscoveredPage format
  let displayPages = (activeSourceId 
    ? pages.filter(p => p.source_id === activeSourceId)
    : pages
  ).map(p => ({
    id: p.id,
    title: p.title || 'Untitled',
    path: p.path,
    status: (p.status || 'indexed') as 'indexed' | 'crawling' | 'pending' | 'error',
    url: p.url, // Include url for edge matching
  }));
  
  // Sort pages: starting page (source URL) first, then by created_at
  if (displaySources.length > 0) {
    const startingSource = displaySources[0];
    const startingUrl = startingSource.url;
    // Normalize URLs for comparison
    const normalizeForSort = (url: string) => {
      try {
        const u = new URL(url);
        u.hash = '';
        u.search = '';
        if (u.pathname !== '/' && u.pathname.endsWith('/')) {
          u.pathname = u.pathname.slice(0, -1);
        }
        return u.toString().toLowerCase();
      } catch {
        return url.toLowerCase();
      }
    };
    const normalizedStartingUrl = normalizeForSort(startingUrl);
    
    displayPages.sort((a, b) => {
      const aUrl = normalizeForSort(a.url || '');
      const bUrl = normalizeForSort(b.url || '');
      const aIsStart = aUrl === normalizedStartingUrl;
      const bIsStart = bUrl === normalizedStartingUrl;
      if (aIsStart && !bIsStart) return -1;
      if (!aIsStart && bIsStart) return 1;
      return 0; // Keep original order for others
    });
  }
  
  // If crawling but no pages yet, show the starting page immediately as a placeholder
  if (isCrawling && displayPages.length === 0 && displaySources.length > 0) {
    const startingSource = displaySources[0];
    const sourceUrl = startingSource.url;
    try {
      const urlObj = new URL(sourceUrl);
      const path = urlObj.pathname || '/';
      displayPages = [{
        id: `placeholder-${startingSource.id}`,
        title: getSourceDisplayLabel(startingSource) || urlObj.hostname,
        path: path,
        status: 'crawling' as const,
        url: sourceUrl,
      }];
    } catch (e) {
      // Invalid URL, skip placeholder
    }
  }
  
  // Use actual page count from database, but fallback to crawl job indexed_count if pages haven't loaded yet
  // This prevents showing "discovering pages" forever when crawl is complete but pages query is slow
  const displayPagesIndexed = Math.max(
    displayPages.length,
    displaySources.reduce((sum, s) => {
      const crawlJob = crawlJobMap.get(s.id);
      const jobIndexedCount = crawlJob ? ((crawlJob as CrawlJob).indexed_count ?? crawlJob.pages_indexed ?? 0) : 0;
      return sum + jobIndexedCount;
    }, 0)
  );
  const activeDisplayName = activeSource ? getSourceDisplayLabel(activeSource) : null;
  const activeDomain = activeSource?.domain; // Hostname for URL construction (ForceGraph)

  if (!hasAnySources) return null;

  return (
    <div className={cn('border-t border-border bg-card/50', className)}>
      {/* Stats Header */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {activeDisplayName ?? 'All Sources'}
          </span>
          {isCrawling && (
            <span className="text-[10px] text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {statusLabel}
            </span>
          )}
        </div>
        
        {/* Source tabs - only show if multiple sources */}
        {sources.length > 1 && (
          <div className="flex gap-1 flex-wrap items-center">
            <button
              onClick={() => setActiveSourceId(null)}
              className={cn(
                'px-2 py-1 text-[10px] rounded-full box-border h-6 shrink-0',
                !activeSourceId 
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-inset' 
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary/70'
              )}
            >
              All
            </button>
            {sources.map(source => {
              const label = getSourceDisplayLabel(source);
              const initial = label.charAt(0).toUpperCase() || '?';
              const useCircleMode = sources.length >= 6;
              return (
                <button
                  key={source.id}
                  onClick={() => setActiveSourceId(source.id)}
                  title={label}
                  className={cn(
                    'px-2 py-1 text-[10px] rounded-full box-border h-6 shrink-0 min-w-0 flex items-center justify-center',
                    activeSourceId === source.id 
                      ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-inset' 
                      : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary/70',
                    useCircleMode ? 'w-6 px-0' : 'max-w-[180px] truncate'
                  )}
                >
                  {useCircleMode ? initial : label}
                </button>
              );
            })}
          </div>
        )}
        
        {/* Stats grid */}
        <TooltipProvider>
          <div className={cn('grid gap-2', isDynamic ? 'grid-cols-3' : 'grid-cols-2')}>
            <StatItem
              label="Discovered"
              value={totalDiscovered}
              highlight={isCrawling && !activeSource}
              tooltip="Links found during crawl; for dynamic sources, grows when you add suggested pages (e.g. 27→34)."
            />
            <StatItem
              label="Indexed"
              value={isAddingPageFlow ? progressSources.reduce((s, x) => s + x.pagesIndexed, 0) : totalIndexed}
              highlight={isCrawling && !activeSource}
              tooltip="Pages in the graph with searchable content."
            />
            {isDynamic && (
              <StatItem
                label="Encoded Discovered"
                value={Math.max(totalEncodedDiscovered, encDiscoveredDone)}
                highlight={isAddPageResponding || encodingPhase === 'encoding-discovered' || ((isIndexingFromJob || isAddPageEncoding) && encDiscoveredTotal > 0)}
                tooltip="Links with embedded context; used for AI suggestions when adding pages."
              />
            )}
          </div>
        </TooltipProvider>
        
        {/* Three-phase progress bar: crawl | indexing chunks | encoding discovered */}
        {((isCrawling && !activeSource) || isAddingPageFlow) && (progressSources.reduce((sum, s) => sum + s.totalPages, 0) || 1) > 0 ? (
          <EncodingProgressBar
            crawlDone={isAddingPageFlow ? progressSources.reduce((s, x) => s + x.pagesIndexed, 0) : totalIndexed}
            crawlTotal={progressSources.reduce((sum, s) => sum + s.totalPages, 0) || 1}
            chunksDone={encChunksDone}
            chunksTotal={encChunksTotal}
            discoveredDone={encDiscoveredDone}
            discoveredTotal={encDiscoveredTotal}
            phase={encodingPhase}
            isDynamic={isDynamic}
            isCrawling={(isCrawling || isAddingPageFlow) && !isIndexingFromJob && !isAddPageEncoding}
            isResponding={isAddPageResponding}
          />
        ) : null}
      </div>
      
      {/* Graph */}
      <div className="px-3 pb-3">
        <ForceGraph 
          pages={displayPages}
          pagesIndexed={displayPagesIndexed}
          domain={activeDomain}
          edges={edges || []} // Ensure edges is always an array, never undefined
        />
      </div>
      
      {/* Source list - ALWAYS visible, with highlight for active source */}
      <div className="px-3 pb-3 space-y-1">
        {sourcesWithStatus.map(source => (
          <button 
            key={source.id}
            onClick={() => setActiveSourceId(activeSourceId === source.id ? null : source.id)}
            className={cn(
              "w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded text-left box-border h-8",
              activeSourceId === source.id 
                ? "bg-primary/10 ring-1 ring-inset ring-primary/30" 
                : "bg-background/30 hover:bg-background/50"
            )}
          >
            <span 
              className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                source.status === 'ready' && 'bg-green-500',
                source.status === 'crawling' && 'bg-primary animate-pulse',
                source.status === 'error' && 'bg-destructive',
              )}
            />
            <span className={cn(
              "truncate",
              activeSourceId === source.id ? "text-foreground" : "text-muted-foreground"
            )}>
              {getSourceDisplayLabel(source)}
            </span>
            {source.crawlDepth === 'dynamic' && (
              <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-primary/15 text-primary border border-primary/20">
                <Zap className="h-2.5 w-2.5" />
                dynamic
              </span>
            )}
            <span 
              className="ml-auto text-[10px] tabular-nums"
              title={source.status === 'ready' && source.pagesIndexed < source.totalPages 
                ? 'No more linked pages found at depth ≤2' : undefined}
            >
              {source.pagesIndexed}/{source.totalPages}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

interface StatItemProps {
  label: string;
  value: number;
  highlight?: boolean;
  tooltip?: string;
}

const StatItem = ({ label, value, highlight, tooltip }: StatItemProps) => {
  const content = (
    <div className="text-center p-1.5 rounded bg-background/30 border border-border/30">
      <div className={cn(
        'text-xs font-mono font-semibold transition-colors duration-300',
        highlight ? 'text-primary' : 'text-foreground'
      )}>
        {value}
      </div>
      <div className="text-[8px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    );
  }
  return content;
};
