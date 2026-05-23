import type { CrawlJob } from '@/lib/db/types';

export function isAddPagePipelineComplete(job: CrawlJob | null | undefined): boolean {
  if (!job) return false;
  if (job.status === 'failed' || job.status === 'cancelled') return true;
  if (job.status !== 'completed') return false;
  const total = job.encoding_discovered_total ?? 0;
  const done = job.encoding_discovered_done ?? 0;
  return total <= done;
}
