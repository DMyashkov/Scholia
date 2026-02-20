import { supabase } from '../db';
import type { CrawlJob } from '../types';

let _noQueuedLogCounter = 0;

export async function updateJobStatus(
  jobId: string,
  status: CrawlJob['status'],
  errorMessage: string | null = null,
  startedAt: string | null = null,
  completedAt: string | null = null
): Promise<void> {
  const updates: Record<string, string | null> = {
    status,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  };

  if (errorMessage !== null) {
    updates.error_message = errorMessage;
  }
  if (startedAt !== null) {
    updates.started_at = startedAt;
  }
  if (completedAt !== null) {
    updates.completed_at = completedAt;
  }

  await supabase
    .from('crawl_jobs')
    .update(updates)
    .eq('id', jobId);
}

/** Single-worker job claim: reset stale running jobs (e.g. after restart), then take the next queued job. */
export async function claimJob(): Promise<CrawlJob | null> {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stuckJobs } = await supabase
    .from('crawl_jobs')
    .select('id')
    .eq('status', 'running')
    .lt('last_activity_at', staleThreshold)
    .limit(10);

  if (stuckJobs?.length) {
    await supabase
      .from('crawl_jobs')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .in('id', stuckJobs.map((j) => j.id));
  }

  const { data: jobs, error: fetchError } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (fetchError) {
    console.error('crawl: failed to fetch queued jobs', fetchError);
    return null;
  }

  if (!jobs?.length) {
    _noQueuedLogCounter++;
    if (_noQueuedLogCounter <= 2 || _noQueuedLogCounter % 12 === 0) {
      console.log('crawl: no jobs queued');
    }
    return null;
  }
  _noQueuedLogCounter = 0;

  const job = jobs[0];
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('crawl_jobs')
    .update({ status: 'running', last_activity_at: now, updated_at: now })
    .eq('id', job.id)
    .select()
    .single();

  if (updateError || !updated) {
    console.error('crawl: claim failed', job.id?.slice(0, 8), updateError);
    return null;
  }

  return updated as CrawlJob;
}
