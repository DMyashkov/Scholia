import { useState } from 'react';
import { Source } from '@/types/source';
import { ForceGraph } from './graph';
import { cn } from '@/lib/utils';

interface SidebarCrawlPanelProps {
  sources: Source[];
  className?: string;
}

export const SidebarCrawlPanel = ({ sources, className }: SidebarCrawlPanelProps) => {
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  
  const crawlingSources = sources.filter(s => s.status === 'crawling');
  
  // Get active source or show all
  const activeSource = activeSourceId ? sources.find(s => s.id === activeSourceId) : null;
  const displaySources = activeSource ? [activeSource] : sources;
  
  // Aggregate stats
  const totalDiscovered = displaySources.reduce((sum, s) => sum + (s.discoveredPages?.length || s.totalPages), 0);
  const totalIndexed = displaySources.reduce((sum, s) => sum + s.pagesIndexed, 0);
  const totalConnections = Math.floor(totalIndexed * 1.3);
  
  const isCrawling = crawlingSources.length > 0;
  const hasAnySources = sources.length > 0;

  // Get pages for current view
  const displayPages = displaySources.flatMap(s => s.discoveredPages || []);
  const displayPagesIndexed = displaySources.reduce((sum, s) => sum + s.pagesIndexed, 0);
  const activeDomain = activeSource?.domain;

  if (!hasAnySources) return null;

  return (
    <div className={cn('border-t border-border bg-card/50', className)}>
      {/* Stats Header */}
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {activeSource ? activeSource.domain : 'All Sources'}
          </span>
          {isCrawling && (
            <span className="text-[10px] text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Crawling
            </span>
          )}
        </div>
        
        {/* Source tabs - only show if multiple sources */}
        {sources.length > 1 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setActiveSourceId(null)}
              className={cn(
                'px-2 py-0.5 text-[9px] rounded-full transition-colors',
                !activeSourceId 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
              )}
            >
              All
            </button>
            {sources.map(source => (
              <button
                key={source.id}
                onClick={() => setActiveSourceId(source.id)}
                className={cn(
                  'px-2 py-0.5 text-[9px] rounded-full transition-colors truncate max-w-[80px]',
                  activeSourceId === source.id 
                    ? 'bg-primary text-primary-foreground' 
                    : 'bg-secondary/50 text-muted-foreground hover:text-foreground'
                )}
              >
                {source.domain}
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
        
        {/* Progress bar */}
        {isCrawling && totalDiscovered > 0 && !activeSource && (
          <div className="relative h-0.5 bg-border/30 rounded-full overflow-hidden">
            <div 
              className="absolute inset-y-0 left-0 bg-primary/60 rounded-full transition-all duration-300"
              style={{ width: `${(totalIndexed / totalDiscovered) * 100}%` }}
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
        />
      </div>
      
      {/* Source list - ALWAYS visible, with highlight for active source */}
      <div className="px-3 pb-3 space-y-1">
        {sources.map(source => (
          <button 
            key={source.id}
            onClick={() => setActiveSourceId(activeSourceId === source.id ? null : source.id)}
            className={cn(
              "w-full flex items-center gap-2 text-[11px] px-2 py-1.5 rounded transition-colors text-left",
              activeSourceId === source.id 
                ? "bg-primary/10 border border-primary/20" 
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
              {source.domain}
            </span>
            <span className="ml-auto text-[10px] tabular-nums">
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
