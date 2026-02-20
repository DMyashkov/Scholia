import type { CrawlJob } from '../types';
export declare function updateJobStatus(jobId: string, status: CrawlJob['status'], errorMessage?: string | null, startedAt?: string | null, completedAt?: string | null): Promise<void>;
/**
 * Atomically claim a queued job.
 * Returns null if no job available or if claim failed.
 */
export declare function claimJob(): Promise<CrawlJob | null>;
//# sourceMappingURL=job.d.ts.map