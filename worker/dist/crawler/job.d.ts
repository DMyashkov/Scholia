import type { CrawlJob } from '../types';
export declare function updateJobStatus(jobId: string, status: CrawlJob['status'], errorMessage?: string | null, startedAt?: string | null, completedAt?: string | null): Promise<void>;
/** Generic crawl_jobs update (add-page and crawlSource use this). Always sets updated_at. */
export declare function updateCrawlJob(jobId: string, updates: Record<string, unknown>): Promise<void>;
/** Single-worker job claim: reset stale running jobs (e.g. after restart), then take the next queued job. */
export declare function claimJob(): Promise<CrawlJob | null>;
//# sourceMappingURL=job.d.ts.map