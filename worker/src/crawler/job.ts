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

export async function claimJob(): Promise<CrawlJob | null> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stuckJobs } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('status', 'running')
    .lt('last_activity_at', fiveMinutesAgo)
    .limit(10);

  if (stuckJobs && stuckJobs.length > 0) {
    const stuckIds = stuckJobs.map((j) => j.id);
    await supabase
      .from('crawl_jobs')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .in('id', stuckIds);
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

  if (!jobs || jobs.length === 0) {
    _noQueuedLogCounter++;
    const shouldLog = _noQueuedLogCounter <= 2 || _noQueuedLogCounter % 12 === 0;
    if (shouldLog) {
      const { data: allJobs, error: allError } = await supabase
        .from('crawl_jobs')
        .select('id, status, source_id, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
      if (allError) {
        console.log('crawl: no jobs queued, DB error:', allError.message);
      } else if (!allJobs || allJobs.length === 0) {
        console.log('crawl: no jobs queued');
      } else {
        type JobRow = { id?: string; status?: string; created_at?: string };
        const summary = (allJobs as JobRow[]).map((j) => ({ id: j.id?.slice(0, 8), status: j.status, created: j.created_at?.slice(11, 19) }));
        console.log('crawl: no jobs queued, recent:', summary);
      }
    }
    return null;
  }
  _noQueuedLogCounter = 0;

  const jobToClaim = jobs[0];
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('crawl_jobs')
    .update({
      status: 'running',
      last_activity_at: now,
      updated_at: now,
    })
    .eq('id', jobToClaim.id)
    .eq('status', 'queued')
    .select()
    .single();

  if (updateError || !updated) {
    console.log('crawl: claim failed (someone else took it)', jobToClaim.id?.slice(0, 8));
    return null;
  }

  return updated as CrawlJob;
}
