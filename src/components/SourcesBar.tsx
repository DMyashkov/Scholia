import { Source } from '@/types/source';
import { cn } from '@/lib/utils';
import { getSourceDisplayLabel } from '@/lib/sourceDisplay';
import { Plus, Check, AlertTriangle, Clock, LogIn, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useQuery } from '@tanstack/react-query';
import { crawlJobsApi } from '@/lib/db/crawl-jobs';
import { useConversationPages } from '@/hooks/usePages';
import { useMemo } from 'react';

interface SourcesBarProps {
  sources: Source[];
  onAddSource: () => void;
  onSourceClick: (sourceId: string) => void;
  recentlyUsedSourceIds?: string[];
  showSignIn?: boolean;
  onSignIn?: () => void;
  className?: string;
  dynamicMode?: boolean;
  onDynamicModeChange?: (enabled: boolean) => void;
  conversationId?: string | null;
  addingPageSourceId?: string | null;
}

const getDepthLabel = (depth: string) => {
  switch (depth) {
    case 'dynamic': return 'Dynamic (1 page)';
    case 'shallow': return 'Shallow (5 pages)';
    case 'medium': return 'Medium (15 pages)';
    case 'deep': return 'Deep (35 pages)';
    default: return depth;
  }
};

const StatusIcon = ({ status }: { status: Source['status'] }) => {
  switch (status) {
    case 'ready':
      return <Check className="h-3 w-3 text-emerald-400" />;
    case 'crawling':
      return null; // Progress shown in favicon area
    case 'error':
      return <AlertTriangle className="h-3 w-3 text-destructive" />;
    case 'outdated':
      return <Clock className="h-3 w-3 text-amber-400" />;
  }
};

const SourceChip = ({ 
  source, 
  onClick,
  isRecentlyUsed,
}: { 
  source: Source; 
  onClick: () => void;
  isRecentlyUsed: boolean;
}) => {
  const displayName = getSourceDisplayLabel(source);
  const initial = displayName.charAt(0).toUpperCase();
  const progressPercent = (source.pagesIndexed / source.totalPages) * 100;
  
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full relative',
              'bg-secondary/80 hover:bg-secondary border border-border/50',
              'transition-all duration-300 group',
              // Subtle one-time glow when recently used
              isRecentlyUsed && 'shadow-[0_0_12px_hsl(var(--primary)/0.25)] border-primary/40'
            )}
          >
            {/* Favicon placeholder with progress ring for crawling */}
            <div className={cn(
              'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold relative',
              'bg-primary/20 text-primary',
              isRecentlyUsed && 'bg-primary/30'
            )}>
              {initial}
              
              {/* Circular progress ring for crawling state */}
              {source.status === 'crawling' && (
                <svg className="absolute inset-0 -rotate-90" viewBox="0 0 20 20">
                  {/* Background circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="9"
                    fill="none"
                    stroke="hsl(var(--border))"
                    strokeWidth="2"
                  />
                  {/* Progress circle */}
                  <circle
                    cx="10"
                    cy="10"
                    r="9"
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeDasharray={`${progressPercent * 0.565} 100`}
                    className="transition-all duration-300"
                  />
                </svg>
              )}
            </div>
            
            {/* Display name (source_label or domain) */}
            <span className="text-xs text-foreground/80 group-hover:text-foreground max-w-[100px] truncate">
              {displayName}
            </span>
            {/* Dynamic source indicator - lightning bolt */}
            {source.crawlDepth === 'dynamic' && (
              <Zap className="h-3 w-3 text-primary/80 shrink-0" title="Dynamic source" />
            )}
            
            {/* Status icon (only for non-crawling states) */}
            <StatusIcon status={source.status} />
            
            {/* Progress text for crawling */}
            {source.status === 'crawling' && (
              <span className="text-[10px] text-muted-foreground font-mono">
                {source.pagesIndexed}/{source.totalPages}
              </span>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent 
          side="bottom" 
          className="bg-popover border-border p-3 max-w-xs"
        >
            <div className="space-y-1.5 text-xs">
            <p className="font-medium text-foreground">{source.url}</p>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Depth: {getDepthLabel(source.crawlDepth)}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>Pages indexed: {source.pagesIndexed}/{source.totalPages}</span>
              {source.status === 'ready' && source.pagesIndexed < source.totalPages && (
                <span className="italic">— no more linked pages found</span>
              )}
            </div>
            <div className="text-muted-foreground">
              Last updated: {source.lastUpdated.toLocaleTimeString()}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const SourcesBar = ({ 
  sources, 
  onAddSource, 
  onSourceClick,
  recentlyUsedSourceIds = [],
  showSignIn,
  onSignIn,
  className,
  dynamicMode = true,
  onDynamicModeChange,
  conversationId,
  addingPageSourceId,
}: SourcesBarProps) => {
  const hasDynamicSources = sources.some(s => s.crawlDepth === 'dynamic');
  const { data: conversationPages = [] } = useConversationPages(conversationId ?? null);
  // Load crawl jobs for all sources to determine real status
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
  
  // Update sources with real status from crawl jobs (and actual page count for dynamic)
  const sourcesWithStatus = useMemo(() => {
    return sources.map(source => {
      const crawlJob = crawlJobMap.get(source.id);
      const sourcePages = conversationPages.filter(p => p.source_id === source.id);
      
      // Determine status from crawl job
      // Default to 'crawling' if no crawl job yet (source was just added)
      let status: Source['status'] = 'crawling';
      let pagesIndexed = source.pagesIndexed;
      let totalPages = source.totalPages;
      
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
        const maxPagesForDepth = source.crawlDepth === 'dynamic' ? 1 : source.crawlDepth === 'shallow' ? 5 : source.crawlDepth === 'medium' ? 15 : 35;
        if (source.crawlDepth === 'dynamic') {
          totalPages = sourcePages.length;
        } else {
          totalPages = maxPagesForDepth;
        }
      } else {
        // No crawl job yet - assume it's being created, show as crawling
        status = 'crawling';
        pagesIndexed = sourcePages.length || 0;
        totalPages = source.crawlDepth === 'dynamic' ? sourcePages.length : 0;
      }
      
      return {
        ...source,
        status,
        pagesIndexed,
        totalPages,
      };
    });
  }, [sources, crawlJobMap, conversationPages, addingPageSourceId]);
  
  if (sources.length === 0) {
    return (
      <div className={cn("sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30 flex items-center justify-between p-4 flex-1", className)}>
        {/* Sources section - centered content */}
        <div className="flex-1 flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-medium">Sources:</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddSource}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/50 rounded-full gap-1.5"
          >
            <Plus className="h-3 w-3" />
            Add source
          </Button>
          <span className="text-xs text-muted-foreground/60 italic hidden sm:inline">
            Attach sources for evidence-backed answers
          </span>
        </div>
        
        {/* Sign in button - right edge of screen, matching New chat button style */}
        {showSignIn && onSignIn && (
          <Button
            onClick={onSignIn}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          >
            <LogIn className="h-4 w-4" />
            Sign in
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b border-border/30 flex items-center justify-between p-4 flex-1", className)}>
      {/* Sources section */}
      <div className="flex-1 flex items-center gap-3 overflow-x-auto scrollbar-thin">
        <span className="text-xs text-muted-foreground font-medium shrink-0">Sources:</span>
        
        {sourcesWithStatus.map(source => (
          <SourceChip
            key={source.id}
            source={source}
            onClick={() => onSourceClick(source.id)}
            isRecentlyUsed={recentlyUsedSourceIds.includes(source.id)}
          />
        ))}
        
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddSource}
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground border border-dashed border-border hover:border-primary/50 rounded-full shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      
      {/* Dynamic mode toggle - only when we have dynamic sources */}
      {hasDynamicSources && onDynamicModeChange && conversationId && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2 shrink-0 ml-2 pl-2 border-l border-border">
                <Zap className="h-3.5 w-3.5 text-primary" />
                <Label htmlFor="dynamic-mode" className="text-xs text-muted-foreground cursor-pointer">
                  Dynamic Mode (Suggest New Pages)
                </Label>
                <Switch
                  id="dynamic-mode"
                  checked={dynamicMode}
                  onCheckedChange={onDynamicModeChange}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[260px]">
              <p className="text-xs">Guide the crawler step by step; pages are suggested from the graph. Only sources created as dynamic can be branched from.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Sign in button - right edge of screen, matching New chat button style */}
      {showSignIn && onSignIn && (
        <Button
          onClick={onSignIn}
          className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2 shrink-0 ml-4"
        >
          <LogIn className="h-4 w-4" />
          Sign in
        </Button>
      )}
    </div>
  );
};
