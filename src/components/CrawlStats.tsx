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
  encodingChunksDone?: number;
  encodingChunksTotal?: number;
  encodingDiscoveredDone?: number;
  encodingDiscoveredTotal?: number;
}

export const CrawlStats = ({
  pagesDiscovered,
  pagesIndexed,
  targetPages,
  connectionsFound,
  isCrawling,
  isIndexing = false,
  encodingChunksDone = 0,
  encodingChunksTotal = 0,
  encodingDiscoveredDone = 0,
  encodingDiscoveredTotal = 0,
}: CrawlStatsProps) => {
  const crawlProgressPercent = targetPages > 0 ? Math.min(100, (pagesIndexed / targetPages) * 100) : 0;
  const combinedEncDone = encodingChunksDone + encodingDiscoveredDone;
  const combinedEncTotal = encodingChunksTotal + encodingDiscoveredTotal;
  const encodingPercent = combinedEncTotal > 0 ? Math.min(100, (combinedEncDone / combinedEncTotal) * 100) : 0;

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

      {/* Single layered progress bar: crawl fill (primary) → encoding fill (darker) on top */}
      {(isCrawling || isIndexing) && targetPages > 0 && (
        <div className="space-y-1">
          <div className="relative h-1.5 bg-border/30 rounded-full overflow-hidden">
            {/* Crawl fill - primary, becomes baseline when encoding starts */}
            <div
              className="absolute inset-y-0 left-0 bg-primary/50 rounded-full transition-all duration-300"
              style={{ width: `${isIndexing ? 100 : crawlProgressPercent}%` }}
            />
            {/* Encoding fill - page chunks + discovered links (combined). Indeterminate when no data. */}
            {isIndexing && (
              <div
                className={cn(
                  'absolute inset-y-0 left-0 bg-primary rounded-full transition-all duration-500',
                  combinedEncTotal === 0 && 'animate-pulse opacity-80'
                )}
                style={{ width: `${combinedEncTotal > 0 ? encodingPercent : 100}%` }}
              />
            )}
            {/* Shimmer only during crawl */}
            {isCrawling && !isIndexing && (
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shimmer" />
            )}
          </div>
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
