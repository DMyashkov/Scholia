import type { CrawlJob, Source } from './types';
export declare function processCrawlJob(jobId: string): Promise<void>;
/** For dynamic mode: extract links with ~200 chars of surrounding context for RAG. Exported for addPageProcessor. */
export declare function extractLinksWithContext(html: string, pageUrl: string, source: Source): Array<{
    url: string;
    snippet: string;
    anchorText: string;
}>;
/**
 * Atomically claim a queued job
 * Returns null if no job available or if claim failed
 */
export declare function claimJob(): Promise<CrawlJob | null>;
//# sourceMappingURL=crawler.d.ts.map