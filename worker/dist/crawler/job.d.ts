import type { CrawlJob } from '../types';
export declare function updateJobStatus(jobId: string, status: CrawlJob['status'], errorMessage?: string | null, startedAt?: string | null, completedAt?: string | null): Promise<void>;
export declare function updateCrawlJob(jobId: string, updates: Record<string, unknown>): Promise<void>;
export declare function claimJob(): Promise<CrawlJob | null>;
//# sourceMappingURL=job.d.ts.map