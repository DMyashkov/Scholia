import { useState, useMemo } from 'react';
import { Source } from '@/types/source';
import { ForceGraph } from './graph';
import { cn } from '@/lib/utils';
import { getSourceDisplayLabel } from '@/lib/sourceDisplay';
import { useConversationPages, useConversationPageEdges } from '@/hooks/usePages';
import { useConversationSources } from '@/hooks/useConversationSources';
import { crawlJobsApi, discoveredLinksApi } from '@/lib/db';
import { useQuery } from '@tanstack/react-query';

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
    queryKey: ['crawl-jobs-for-sources', sourceIds],
    queryFn: async () => {
      const jobs = await Promise.all(
        sourceIds.map(sourceId => crawlJobsApi.listBySource(sourceId))
      );
      return jobs.flat();
    },
    enabled: sourceIds.length > 0,
  });

  const { data: conversationSources = [] } = useConversationSources(conversationId);

  const { data: pages = [], isLoading: pagesLoading, error: pagesError } = useConversationPages(conversationId);
  const { data: edges = [], isLoading: edgesLoading, error: edgesError } = useConversationPageEdges(conversationId);
  const { data: discoveredCountsMap = {} } = useQuery({
    queryKey: ['discovered-links-counts', conversationId],
    queryFn: () => (conversationId ? discoveredLinksApi.countsByConversation(conversationId) : {}),
    enabled: !!conversationId,
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
        } else if (crawlJob.status === 'queued' || crawlJob.status === 'running') {
          status = 'crawling';
        } else if (crawlJob.status === 'failed') {
          status = 'error';
        } else if (crawlJob.status === 'completed') {
          status = 'ready';
        }
        
        // Use indexed_count if available, fallback to pages_indexed; prefer actual DB count when we have pages
        const jobIndexed = (crawlJob as any).indexed_count ?? crawlJob.pages_indexed ?? 0;
        pagesIndexed = Math.max(jobIndexed, sourcePages.length);
        // For dynamic: use actual page count (can grow when user adds pages via "Yes")
        const maxPagesForDepth = source.crawlDepth === 'dynamic' ? 1 : source.crawlDepth === 'shallow' ? 5 : source.crawlDepth === 'medium' ? 15 : 35;
        if (source.crawlDepth === 'dynamic') {
          totalPages = sourcePages.length;
        } else {
          totalPages = maxPagesForDepth;
        }
      } else {
        // No crawl job yet - assume it's being created, show as crawling
        status = 'crawling';
        pagesIndexed = 0;
        totalPages = 0;
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
  }, [sources, crawlJobMap, pages, addingPageSourceId]);
  
  const crawlingSources = sourcesWithStatus.filter(s => s.status === 'crawling');
  
  // Get active source or show all
  const activeSource = activeSourceId ? sourcesWithStatus.find(s => s.id === activeSourceId) : null;
  const displaySources = activeSource ? [activeSource] : sourcesWithStatus;
  
  // Aggregate stats - for dynamic use discovered_links count (includes add-page); else crawl job
  const totalDiscovered = displaySources.reduce((sum, s) => {
    const dlCount = discoveredCountsMap[s.id] ?? 0;
    const crawlJob = crawlJobMap.get(s.id);
    const jobDiscovered = crawlJob ? ((crawlJob as any).discovered_count ?? 0) : 0;
    if (s.crawlDepth === 'dynamic') {
      return sum + Math.max(jobDiscovered, dlCount);
    }
    return sum + jobDiscovered;
  }, 0);
  const totalIndexed = displaySources.reduce((sum, s) => sum + s.pagesIndexed, 0);
  const totalConnections = edges.length;
  
  const isCrawling = crawlingSources.length > 0 || !!addingPageSourceId;
  const isIndexing = crawlingSources.some(s => s.totalPages > 0 && s.pagesIndexed >= s.totalPages);
  const hasAnySources = sources.length > 0;

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
      const jobIndexedCount = crawlJob ? ((crawlJob as any).indexed_count ?? crawlJob.pages_indexed ?? 0) : 0;
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
              {isIndexing ? 'Indexing…' : 'Crawling'}
            </span>
          )}
        </div>
        
        {/* Source tabs - only show if multiple sources */}
        {sources.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveSourceId(null)}
              className={cn(
                'px-2 py-1 text-[10px] rounded-full box-border h-6',
                !activeSourceId 
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-inset' 
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary/70'
              )}
            >
              All
            </button>
            {sources.map(source => (
              <button
                key={source.id}
                onClick={() => setActiveSourceId(source.id)}
                className={cn(
                  'px-2 py-1 text-[10px] rounded-full truncate max-w-[80px] box-border h-6',
                  activeSourceId === source.id 
                    ? 'bg-primary text-primary-foreground ring-2 ring-primary ring-inset' 
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                )}
              >
                {getSourceDisplayLabel(source)}
              </button>
            ))}
          </div>
        )}
        
        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-2">
          <StatItem 
            label="Discovered" 
            value={totalDiscovered}
            highlight={isCrawling && !activeSource}
          />
          <StatItem 
            label="Indexed" 
            value={totalIndexed}
            highlight={isCrawling && !activeSource}
          />
          <StatItem 
            label="Links" 
            value={totalConnections}
          />
        </div>
        
        {/* Progress bar - use totalPages (target) instead of totalDiscovered */}
        {isCrawling && !activeSource && (
          <div className="relative h-0.5 bg-border/30 rounded-full overflow-hidden">
            <div 
              className="absolute inset-y-0 left-0 bg-primary/60 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (totalIndexed / (displaySources.reduce((sum, s) => sum + s.totalPages, 0) || 1)) * 100)}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shimmer" />
          </div>
        )}
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
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-medium bg-primary/15 text-primary border border-primary/20">
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
}

const StatItem = ({ label, value, highlight }: StatItemProps) => {
  return (
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
};
