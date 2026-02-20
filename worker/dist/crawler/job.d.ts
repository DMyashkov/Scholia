import type { CrawlJob } from '../types';
export declare function updateJobStatus(jobId: string, status: CrawlJob['status'], errorMessage?: string | null, startedAt?: string | null, completedAt?: string | null): Promise<void>;
/** Single-worker job claim: reset stale running jobs (e.g. after restart), then take the next queued job. */
export declare function claimJob(): Promise<CrawlJob | null>;
//# sourceMappingURL=job.d.ts.map