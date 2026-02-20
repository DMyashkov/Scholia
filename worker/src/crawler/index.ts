import { supabase } from '../db';
import type { CrawlJob, Source } from '../types';
import { crawlSource } from './crawlSource';
import { updateJobStatus } from './job';

export { claimJob } from './job';
export { extractLinks, extractLinksWithContext } from './links';

export async function processCrawlJob(jobId: string): Promise<void> {
  try {
    const { data: job, error: jobError } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error('crawl: job not found', jobId.slice(0, 8), jobError);
      return;
    }

    if (job.status !== 'queued' && job.status !== 'running') {
      return;
    }

    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('*')
      .eq('id', job.source_id)
      .single();

    if (sourceError || !source) {
      console.error('crawl: source not found', job.source_id?.slice(0, 8));
      await updateJobStatus(jobId, 'failed', `Source not found: ${sourceError?.message}`);
      return;
    }

    if (job.status !== 'running') {
      await updateJobStatus(jobId, 'running', null, new Date().toISOString());
    }

    await crawlSource(job as CrawlJob, source as Source);

    await updateJobStatus(jobId, 'completed', null, null, new Date().toISOString());
  } catch (error) {
    console.error('crawl: job failed', jobId.slice(0, 8), error);
    await updateJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}
