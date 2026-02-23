import { useState, useMemo, useRef, useEffect } from 'react';
import { Source } from '@/types/source';
import { ForceGraph } from './graph';
import { cn } from '@/lib/utils';
import { getSourceDisplayLabel } from '@/lib/sourceDisplay';
import { useConversationPages, useConversationGraphEdges } from '@/hooks/usePages';
import { useConversationSources } from '@/hooks/useConversationSources';
import { useAddPageJob } from '@/hooks/useAddPageJob';
import { crawlJobsApi, discoveredLinksApi } from '@/lib/db';
import type { CrawlJob } from '@/lib/db/types';
import {
  LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
  COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
  ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
} from '@/lib/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { Zap, Waves, Anchor } from 'lucide-react';
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
  const sourceIdsKey = useMemo(() => sourceIds.slice().sort().join(','), [sourceIds]);
  const { data: crawlJobsData = [] } = useQuery({
    queryKey: [LATEST_MAIN_CRAWL_JOB_BY_SOURCES, sourceIdsKey],
    queryFn: async () => {
      if (!conversationId || sourceIds.length === 0) return [];
      return crawlJobsApi.listLatestMainBySources(sourceIds, conversationId);
    },
    enabled: sourceIds.length > 0 && !!conversationId,
  });

  const { data: conversationSources = [] } = useConversationSources(conversationId);
  const { data: addPageJob } = useAddPageJob(conversationId ?? null, addingPageSourceId ?? null);

  const { data: pages = [], isLoading: pagesLoading, error: pagesError } = useConversationPages(conversationId);

  
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
  const normalizeUrlForSeedMatch = (url: string) => {
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      u.hash = '';
      u.search = '';
      if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
      return u.toString();
    } catch {
      return url;
    }
  };

  const activeSourceForSeed = activeSourceId ? sources.find((s) => s.id === activeSourceId) : null;
  const sourcePagesForActive = useMemo(
    () => (activeSourceId ? pages.filter((p) => p.source_id === activeSourceId) : []),
    [pages, activeSourceId]
  );
  const seedPageFromConversation = useMemo(() => {
    if (!activeSourceForSeed?.initial_url || pages.length === 0) return null;
    const norm = normalizeUrlForSeedMatch(activeSourceForSeed.initial_url);
    let found = pages.find((p) => p.url && normalizeUrlForSeedMatch(p.url) === norm);
    if (!found && norm) {
      try {
        const seedPath = new URL(norm).pathname;
        found = pages.find((p) => {
          if (!p.url) return false;
          try {
            return new URL(normalizeUrlForSeedMatch(p.url)).pathname === seedPath;
          } catch {
            return false;
          }
        }) ?? undefined;
      } catch {
        /* ignore */
      }
    }
    if (!found || sourcePagesForActive.some((p) => p.id === found!.id)) return null;
    return found;
  }, [activeSourceForSeed?.initial_url, pages, sourcePagesForActive]);

  const graphPageIds = useMemo(() => {
    const baseIds = (activeSourceId ? sourcePagesForActive : pages).map((p) => p.id);
    if (seedPageFromConversation && !baseIds.includes(seedPageFromConversation.id)) {
      return [...baseIds, seedPageFromConversation.id];
    }
    return baseIds;
  }, [activeSourceId, sourcePagesForActive, pages, seedPageFromConversation]);
  const { data: graphEdges = [], isLoading: edgesLoading, error: edgesError, refetch: refetchGraphEdges } = useConversationGraphEdges(
    conversationId ?? null,
    graphPageIds
  );
  const prevPagesLengthRef = useRef(0);
  useEffect(() => {
    if (pages.length <= prevPagesLengthRef.current) {
      prevPagesLengthRef.current = pages.length;
      return;
    }
    prevPagesLengthRef.current = pages.length;
    const t = setTimeout(() => {
      refetchGraphEdges();
    }, 450);
    return () => clearTimeout(t);
  }, [pages.length, refetchGraphEdges]);

  const { data: discoveredCountsMap = {} } = useQuery({
    queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId],
    queryFn: () => (conversationId ? discoveredLinksApi.countsByConversation(conversationId) : {}),
    enabled: !!conversationId,
  });
  const { data: encodedDiscoveredCountsMap = {} } = useQuery({
    queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId],
    queryFn: () => (conversationId ? discoveredLinksApi.countsEncodedByConversation(conversationId) : {}),
    enabled: !!conversationId && sources.some(s => s.crawlDepth === 'dynamic'),
  });

  
  const crawlJobMap = useMemo(() => {
    const map = new Map<string, typeof crawlJobsData[0]>();
    crawlJobsData.forEach(job => map.set(job.source_id, job));
    return map;
  }, [crawlJobsData]);
  
  
  const sourcesWithStatus = useMemo(() => {
    return sources.map(source => {
      const sourcePages = pages.filter(p => p.source_id === source.id);
      const crawlJob = crawlJobMap.get(source.id);
      
      
      
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
        
        
        const jobIndexed = (crawlJob as CrawlJob).indexed_count ?? 0;
        pagesIndexed = Math.max(jobIndexed, sourcePages.length);
        
        
        const maxPagesForDepth = source.crawlDepth === 'dynamic' || source.crawlDepth === 'singular' ? 1 : source.crawlDepth === 'shallow' ? 5 : source.crawlDepth === 'medium' ? 15 : 35;
        if (source.crawlDepth === 'dynamic') {
          if (addingPageSourceId === source.id) {
            const jobDone = addPageJob?.status === 'encoding' || addPageJob?.status === 'completed';
            
            const frozenInitial = addPageInitialCountRef.current || sourcePages.length;
            totalPages = jobDone ? sourcePages.length : frozenInitial + 1;
          } else {
            totalPages = Math.max(sourcePages.length, 1);
          }
        } else {
          totalPages = maxPagesForDepth;
        }
      } else {
        
        status = 'crawling';
        pagesIndexed = sourcePages.length;
        if (source.crawlDepth === 'dynamic') {
          if (addingPageSourceId === source.id) {
            const jobDone = addPageJob?.status === 'encoding' || addPageJob?.status === 'completed';
            
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
  
  
  const activeSource = activeSourceId ? sourcesWithStatus.find(s => s.id === activeSourceId) : null;
  const displaySources = activeSource ? [activeSource] : sourcesWithStatus;
  
  
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

  
  const indexingJob = displaySources.find(s => crawlJobMap.get(s.id)?.status === 'indexing');
  const crawlJob = indexingJob ? crawlJobMap.get(indexingJob.id) : null;
  const isDynamic = displaySources.some(s => s.crawlDepth === 'dynamic');
  const useAddPageProgress = (isAddPageEncoding || isAddPageResponding) && addPageJob;
  const encChunksDone = useAddPageProgress ? (addPageJob.encoding_chunks_done ?? 0) : (crawlJob as CrawlJob | null)?.encoding_chunks_done ?? 0;
  const encChunksTotal = useAddPageProgress ? (addPageJob.encoding_chunks_total ?? 0) : (crawlJob as CrawlJob | null)?.encoding_chunks_total ?? 0;
  const encDiscoveredDone = useAddPageProgress ? (addPageJob.encoding_discovered_done ?? 0) : (crawlJob as CrawlJob | null)?.encoding_discovered_done ?? 0;
  const encDiscoveredTotal = useAddPageProgress ? (addPageJob.encoding_discovered_total ?? 0) : (crawlJob as CrawlJob | null)?.encoding_discovered_total ?? 0;

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
  
  const progressSources = isAddingPageFlow && addingPageSourceId
    ? sourcesWithStatus.filter(s => s.id === addingPageSourceId)
    : displaySources;

  
  
  
  let displayPages = (activeSourceId
    ? pages.filter(p => p.source_id === activeSourceId)
    : pages
  ).map(p => ({
    id: p.id,
    title: p.title || 'Untitled',
    path: p.path,
    status: (p.status || 'indexed') as 'indexed' | 'crawling' | 'pending' | 'error',
    url: p.url, 
  }));
  if (activeSourceId && seedPageFromConversation && !displayPages.some((p) => p.id === seedPageFromConversation.id)) {
    displayPages = [
      ...displayPages,
      {
        id: seedPageFromConversation.id,
        title: seedPageFromConversation.title || 'Untitled',
        path: seedPageFromConversation.path,
        status: 'indexed' as const,
        url: seedPageFromConversation.url ?? undefined,
      },
    ];
  }

  
  if (displaySources.length > 0) {
    const startingSource = activeSource ?? displaySources[0];
    const startingUrl = startingSource.initial_url;
    
    const normalizeForSort = (url: string) => {
      if (!url) return '';
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
    const startingSource = activeSource ?? displaySources[0];
    const sourceUrl = startingSource.initial_url;
    const urlObj = new URL(sourceUrl);
    const path = urlObj.pathname || '/';
    displayPages = [{
      id: `placeholder-${startingSource.id}`,
      title: getSourceDisplayLabel(startingSource) || urlObj.hostname,
      path: path,
      status: 'crawling' as const,
      url: sourceUrl,
    }];
  }
  
  
  
  const displayPagesIndexed = Math.max(
    displayPages.length,
    displaySources.reduce((sum, s) => {
      const crawlJob = crawlJobMap.get(s.id);
      const jobIndexedCount = crawlJob ? ((crawlJob as CrawlJob).indexed_count ?? 0) : 0;
      return sum + jobIndexedCount;
    }, 0)
  );
  const activeDisplayName = activeSource ? getSourceDisplayLabel(activeSource) : null;
  const activeDomain = activeSource?.domain; 

  if (!hasAnySources) return null;

  return (
    <div className={cn('border-t border-border bg-card/50', className)}>
      {}
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
        
        {}
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
        
        {}
        <TooltipProvider>
          <div className={cn('grid gap-2', isDynamic ? 'grid-cols-3' : 'grid-cols-2')}>
            <StatItem
              label="Discovered"
              value={totalDiscovered}
              highlight={isCrawling && !activeSource}
              tooltip="Links found during crawl; for dynamic sources, grows when you add suggested pages (e.g. 27→34)."
            />
            <StatItem
              label="Scraped"
              value={isAddingPageFlow ? progressSources.reduce((s, x) => s + x.pagesIndexed, 0) : totalIndexed}
              highlight={isCrawling && !activeSource}
              tooltip="Pages scraped and in the graph with searchable content."
            />
            {isDynamic && (
              <StatItem
                label="Encoded Discovered"
                value={encDiscoveredTotal > 0 ? Math.max(encDiscoveredDone, totalEncodedDiscovered) : totalEncodedDiscovered}
                highlight={isAddPageResponding || encodingPhase === 'encoding-discovered' || ((isIndexingFromJob || isAddPageEncoding) && encDiscoveredTotal > 0)}
                tooltip="Links with embedded context; used for AI suggestions when adding pages."
              />
            )}
          </div>
        </TooltipProvider>
        
        {}
        {((isCrawling && !activeSource) || isAddingPageFlow) && (progressSources.reduce((sum, s) => sum + s.totalPages, 0) || 1) > 0 ? (
          <EncodingProgressBar
            crawlDone={isAddingPageFlow ? progressSources.reduce((s, x) => s + x.pagesIndexed, 0) : totalIndexed}
            crawlTotal={progressSources.reduce((sum, s) => sum + s.totalPages, 0) || 1}
            chunksDone={encChunksDone}
            chunksTotal={encChunksTotal}
            discoveredDone={encDiscoveredTotal > 0 ? encDiscoveredDone : encDiscoveredDone}
            discoveredTotal={encDiscoveredTotal}
            phase={encodingPhase}
            isDynamic={isDynamic}
            isCrawling={(isCrawling || isAddingPageFlow) && !isIndexingFromJob && !isAddPageEncoding}
            isResponding={isAddPageResponding}
          />
        ) : null}
      </div>
      
      {}
      <div className="px-3 pb-3">
        <ForceGraph 
          pages={displayPages}
          pagesIndexed={displayPagesIndexed}
          domain={activeDomain}
          edges={graphEdges}
        />
      </div>
      
      {}
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
              <span className="shrink-0 inline-flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-primary/15 text-primary border border-primary/20">
                  <Zap className="h-2.5 w-2.5" />
                  Dynamic
                </span>
                {source.suggestionMode === 'dive' ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20" title="Dive - checks each linked page">
                    <Anchor className="h-2.5 w-2.5" />
                    Dive
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-teal-500/15 text-teal-600 dark:text-teal-400 border border-teal-500/20" title="Surface - uses link context">
                    <Waves className="h-2.5 w-2.5" />
                    Surface
                  </span>
                )}
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