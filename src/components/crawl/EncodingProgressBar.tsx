import { cn } from '@/lib/utils';

export type EncodingPhase = 'crawl' | 'indexing-chunks' | 'encoding-discovered' | 'idle';


export function getEncodingPhase(
  isCrawling: boolean,
  isIndexing: boolean,
  encChunksTotal: number,
  encChunksDone: number,
  encDiscoveredTotal: number
): EncodingPhase {
  if (isCrawling && !isIndexing) return 'crawl';
  if (!isIndexing) return 'idle';
  if (encChunksTotal > 0 && encChunksDone < encChunksTotal) return 'indexing-chunks';
  if (encDiscoveredTotal > 0) return 'encoding-discovered';
  return 'indexing-chunks'; 
}


export function getEncodingStatusLabel(
  phase: EncodingPhase,
  isAddPageResponding: boolean,
  isAddPageIndexing: boolean,
  isAddPageEncoding: boolean,
  isIndexingFromJob: boolean,
  isDynamic: boolean
): string {
  if (isAddPageResponding) return 'Responding…';
  if (isAddPageIndexing) return 'Scraping Page';
  if (isAddPageEncoding || isIndexingFromJob) {
    if (phase === 'indexing-chunks') return 'Indexing Crawled Pages';
    if (phase === 'encoding-discovered') return 'Encoding Discovered Pages';
    return 'Indexing Crawled Pages';
  }
  return isDynamic ? 'Scraping Page' : 'Crawling';
}


export interface EncodingProgressBarProps {
  
  crawlDone: number;
  crawlTotal: number;
  
  chunksDone: number;
  chunksTotal: number;
  
  discoveredDone: number;
  discoveredTotal: number;
  
  phase: EncodingPhase;
  
  isDynamic?: boolean;
  
  isCrawling?: boolean;
  
  isResponding?: boolean;
  className?: string;
}

export function EncodingProgressBar({
  crawlDone,
  crawlTotal,
  chunksDone,
  chunksTotal,
  discoveredDone,
  discoveredTotal,
  phase,
  isDynamic = false,
  isCrawling = false,
  isResponding = false,
  className,
}: EncodingProgressBarProps) {
  const crawlPct = crawlTotal > 0 ? Math.min(1, crawlDone / crawlTotal) : 0;
  const chunksPct = chunksTotal > 0 ? Math.min(1, chunksDone / chunksTotal) : 0;
  const discoveredPct = discoveredTotal > 0 ? Math.min(1, discoveredDone / discoveredTotal) : 0;

  const showChunksIndeterminate = phase === 'indexing-chunks' && chunksTotal === 0;
  const showDiscoveredIndeterminate = phase === 'encoding-discovered' && discoveredTotal === 0;

  
  const showFullBar = isResponding;
  const crawlWidth = showFullBar ? 1 : phase === 'crawl' ? crawlPct : phase !== 'idle' ? 1 : 0;
  
  const chunksWidth = showFullBar
    ? 1
    : phase === 'indexing-chunks'
      ? (showChunksIndeterminate ? 0.12 : chunksPct) 
      : phase === 'encoding-discovered'
        ? 1
        : 0;
  const discoveredWidth = showFullBar ? 1 : phase === 'encoding-discovered' ? (showDiscoveredIndeterminate ? 0.12 : discoveredPct) : 0;

  
  const chunksIsFinalPhase = !isDynamic;

  return (
    <div className={cn('space-y-1', className)}>
      <div
        className={cn(
          'relative h-1.5 bg-muted/50 rounded-full overflow-hidden',
          isResponding && 'animate-pulse'
        )}
      >
        {}
        <div
          className="absolute inset-y-0 left-0 bg-primary/40 rounded-full transition-all duration-300"
          style={{ width: `${crawlWidth * 100}%` }}
        />
        {}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
            chunksIsFinalPhase ? 'bg-amber-600' : 'bg-primary/60',
            showChunksIndeterminate && 'animate-pulse opacity-80'
          )}
          style={{ width: `${chunksWidth * 100}%` }}
        />
        {}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
            'bg-orange-700',
            showDiscoveredIndeterminate && 'animate-pulse opacity-90'
          )}
          style={{ width: `${discoveredWidth * 100}%` }}
        />
        {isCrawling && phase === 'crawl' && (
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shimmer" />
        )}
      </div>
    </div>
  );
}