import { cn } from '@/lib/utils';

export type EncodingPhase = 'crawl' | 'indexing-chunks' | 'encoding-discovered' | 'idle';

/** Derive encoding phase from progress values */
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
  return 'indexing-chunks'; // fallback when chunks total not yet set
}

/** Status label for the current phase */
export function getEncodingStatusLabel(
  phase: EncodingPhase,
  isAddPageResponding: boolean,
  isAddPageIndexing: boolean,
  isAddPageEncoding: boolean,
  isIndexingFromJob: boolean,
  isDynamic: boolean
): string {
  if (isAddPageResponding) return 'Responding…';
  if (isAddPageIndexing) return 'Adding page…';
  if (isAddPageEncoding || isIndexingFromJob) {
    if (phase === 'indexing-chunks') return 'Indexing Crawled Pages';
    if (phase === 'encoding-discovered') return 'Encoding Discovered Pages';
    return 'Indexing Crawled Pages';
  }
  return isDynamic ? 'Scraping Page' : 'Crawling';
}

/** Single bar with layered overlapping fills. Lightest → medium → darkest as phases progress. */
export interface EncodingProgressBarProps {
  /** Phase 1: pages indexed / target (crawl progress) */
  crawlDone: number;
  crawlTotal: number;
  /** Phase 2: page chunks embedded (Indexing Crawled Pages) */
  chunksDone: number;
  chunksTotal: number;
  /** Phase 3: discovered links embedded (Encoding Discovered Pages) - dynamic only */
  discoveredDone: number;
  discoveredTotal: number;
  /** Currently active phase */
  phase: EncodingPhase;
  /** Static = 2 phases (crawl, chunks). Dynamic = 3 phases (crawl, chunks, discovered). Chunks uses "done" color when static. */
  isDynamic?: boolean;
  /** Show shimmer overlay during crawl */
  isCrawling?: boolean;
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
  className,
}: EncodingProgressBarProps) {
  const crawlPct = crawlTotal > 0 ? Math.min(1, crawlDone / crawlTotal) : 0;
  const chunksPct = chunksTotal > 0 ? Math.min(1, chunksDone / chunksTotal) : 0;
  const discoveredPct = discoveredTotal > 0 ? Math.min(1, discoveredDone / discoveredTotal) : 0;

  const showChunksIndeterminate = phase === 'indexing-chunks' && chunksTotal === 0;
  const showDiscoveredIndeterminate = phase === 'encoding-discovered' && discoveredTotal === 0;

  // Layered fills: each phase overlays 0–100% of the bar. Color intensifies per phase.
  // Phase 1 (crawl): light fill
  const crawlWidth = phase === 'crawl' ? crawlPct : phase !== 'idle' ? 1 : 0;
  // Phase 2 (chunks): overlays. Static = done color (same as phase 3). Dynamic = medium (phase 3 will overlay).
  const chunksWidth =
    phase === 'indexing-chunks' ? (showChunksIndeterminate ? 1 : chunksPct) : phase === 'encoding-discovered' ? 1 : 0;
  // Phase 3 (discovered): overlays, darkest. Dynamic only.
  const discoveredWidth =
    phase === 'encoding-discovered' ? (showDiscoveredIndeterminate ? 1 : discoveredPct) : 0;

  // Chunks uses "done" color when static (matches phase 3); medium when dynamic (phase 3 overlays with distinct color).
  const chunksIsFinalPhase = !isDynamic;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="relative h-1.5 bg-muted/50 rounded-full overflow-hidden">
        {/* Layer 1: Crawl – lightest */}
        <div
          className="absolute inset-y-0 left-0 bg-primary/40 rounded-full transition-all duration-300"
          style={{ width: `${crawlWidth * 100}%` }}
        />
        {/* Layer 2: Indexing chunks – medium (dynamic) or done/amber (static, same as phase 3) */}
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full transition-all duration-500',
            chunksIsFinalPhase ? 'bg-amber-600' : 'bg-primary/60',
            showChunksIndeterminate && 'animate-pulse opacity-80'
          )}
          style={{ width: `${chunksWidth * 100}%` }}
        />
        {/* Layer 3: Encoding discovered – distinct darker orange (dynamic only) */}
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
