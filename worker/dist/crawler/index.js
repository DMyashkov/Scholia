/**
 * Crawler entry point: process jobs, claim jobs, and export link extraction for add-page flow.
 */
import { supabase } from '../db';
import { crawlSource } from './crawlSource';
import { updateJobStatus } from './job';
export { claimJob } from './job';
export { extractLinksWithContext } from './links';
export async function processCrawlJob(jobId) {
    console.log('[crawl] processCrawlJob start', { jobId: jobId.slice(0, 8) });
    try {
        const { data: job, error: jobError } = await supabase
            .from('crawl_jobs')
            .select('*')
            .eq('id', jobId)
            .single();
        if (jobError || !job) {
            console.error(`❌ Failed to fetch job ${jobId}:`, jobError);
            return;
        }
        console.log('[crawl] job loaded', {
            jobId: job.id?.slice(0, 8),
            status: job.status,
            sourceId: job.source_id?.slice(0, 8),
        });
        if (job.status !== 'queued' && job.status !== 'running') {
            console.log('[crawl] job no longer runnable', { jobId: job.id?.slice(0, 8), status: job.status });
            return;
        }
        const { data: source, error: sourceError } = await supabase
            .from('sources')
            .select('*')
            .eq('id', job.source_id)
            .single();
        if (sourceError || !source) {
            console.error(`❌ Failed to fetch source ${job.source_id}:`, sourceError);
            await updateJobStatus(jobId, 'failed', `Source not found: ${sourceError?.message}`);
            return;
        }
        if (job.status !== 'running') {
            await updateJobStatus(jobId, 'running', null, new Date().toISOString());
        }
        await crawlSource(job, source);
        await updateJobStatus(jobId, 'completed', null, null, new Date().toISOString());
    }
    catch (error) {
        console.error(`\n❌ ========== FATAL ERROR PROCESSING JOB ${jobId.substring(0, 8)}... ==========`);
        console.error(`❌ Error:`, error);
        console.error(`❌ Stack:`, error instanceof Error ? error.stack : 'No stack trace');
        console.error(`❌ ========== END ERROR ==========\n`);
        await updateJobStatus(jobId, 'failed', error instanceof Error ? error.message : String(error));
        throw error;
    }
}
//# sourceMappingURL=index.js.map