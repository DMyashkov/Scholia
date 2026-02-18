import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EncodingProgressBar, getEncodingPhase } from './EncodingProgressBar';

interface CrawlStatsProps {
  pagesDiscovered: number;
  pagesIndexed: number;
  targetPages: number;
  isCrawling: boolean;
  isIndexing?: boolean;
  isDynamic?: boolean;
  isResponding?: boolean;
  encodedDiscoveredCount?: number;
  encodingChunksDone?: number;
  encodingChunksTotal?: number;
  encodingDiscoveredDone?: number;
  encodingDiscoveredTotal?: number;
}

export const CrawlStats = ({
  pagesDiscovered,
  pagesIndexed,
  targetPages,
  isCrawling,
  isIndexing = false,
  isDynamic = false,
  isResponding = false,
  encodedDiscoveredCount = 0,
  encodingChunksDone = 0,
  encodingChunksTotal = 0,
  encodingDiscoveredDone = 0,
  encodingDiscoveredTotal = 0,
}: CrawlStatsProps) => {
  const phase = getEncodingPhase(isCrawling, isIndexing, encodingChunksTotal, encodingChunksDone, encodingDiscoveredTotal);
  const isEncodingDiscoveredPhase = phase === 'encoding-discovered';

  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <TooltipProvider delayDuration={300}>
        <div className={cn('grid gap-2', isDynamic ? 'grid-cols-3' : 'grid-cols-2')}>
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
            <TooltipContent side="top" className="max-w-[240px]">
              <p className="text-xs">Links found during crawl; for dynamic sources, grows when you add suggested pages (e.g. 27→34).</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <StatItem
                  label="Scraped"
                  value={pagesIndexed}
                  highlight={isCrawling}
                />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[200px]">
              <p className="text-xs">Pages scraped and in the graph with searchable content</p>
            </TooltipContent>
          </Tooltip>
          {isDynamic && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatItem
                    label="Encoded Discovered"
                    value={Math.max(encodedDiscoveredCount, encodingDiscoveredDone)}
                    highlight={isResponding || isEncodingDiscoveredPhase || (isIndexing && encodingDiscoveredTotal > 0)}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[200px]">
                <p className="text-xs">Links with embedded context; used for AI suggestions when adding pages.</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      {/* Three-phase progress bar: crawl | indexing chunks | encoding discovered */}
      {(isCrawling || isIndexing || isResponding) && targetPages > 0 && (
        <EncodingProgressBar
          crawlDone={pagesIndexed}
          crawlTotal={targetPages}
          chunksDone={encodingChunksDone}
          chunksTotal={encodingChunksTotal}
          discoveredDone={encodingDiscoveredDone}
          discoveredTotal={encodingDiscoveredTotal}
          phase={phase}
          isDynamic={isDynamic}
          isCrawling={isCrawling && !isIndexing}
          isResponding={isResponding}
        />
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
