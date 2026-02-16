import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CrawlStatsProps {
  pagesDiscovered: number;
  pagesIndexed: number;
  targetPages: number;
  connectionsFound: number;
  isCrawling: boolean;
  isIndexing?: boolean;
}

export const CrawlStats = ({ 
  pagesDiscovered, 
  pagesIndexed, 
  targetPages,
  connectionsFound,
  isCrawling,
  isIndexing = false,
}: CrawlStatsProps) => {
  const progressPercent = targetPages > 0 ? Math.min(100, (pagesIndexed / targetPages) * 100) : 0;
  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <TooltipProvider delayDuration={300}>
        <div className="grid grid-cols-3 gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <StatItem 
                  label="Discovered" 
                  value={pagesDiscovered}
                  highlight={isCrawling}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <p className="text-xs">Links found during crawl; for dynamic sources, grows when you add suggested pages (e.g. 27→34).</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <StatItem 
                  label="Indexed" 
                  value={pagesIndexed}
                  highlight={isCrawling}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <p className="text-xs">Pages in the graph with searchable content</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <StatItem 
                  label="Connections" 
                  value={connectionsFound}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <p className="text-xs">Links between indexed pages in the graph</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
      
      {/* Crawling activity indicator - same formula as SidebarCrawlPanel: indexed/target */}
      {(isCrawling || isIndexing) && targetPages > 0 && (
        <div className="space-y-1.5">
          <div className="relative h-0.5 bg-border/30 rounded-full overflow-hidden">
            <div 
              className="absolute inset-y-0 left-0 bg-primary/60 rounded-full animate-crawl-progress"
              style={{ width: `${isIndexing ? 100 : progressPercent}%` }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shimmer" />
          </div>
          {/* Indexing bar - shown when crawl done but RAG indexing in progress */}
          {isIndexing && (
            <div className="relative h-0.5 bg-border/30 rounded-full overflow-hidden">
              <div className="absolute inset-y-0 left-0 right-0 bg-amber-500/50 rounded-full animate-pulse" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/40 to-transparent animate-shimmer" />
            </div>
          )}
        </div>
      )}
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
    <div className="text-center p-2 rounded-md bg-background/30 border border-border/30">
      <div className={cn(
        'text-sm font-mono font-semibold transition-colors duration-300',
        highlight ? 'text-primary' : 'text-foreground'
      )}>
        {value}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
};
