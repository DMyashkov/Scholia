import { supabase } from './db';
import { claimJob, processCrawlJob } from './crawler';
import { claimAddPageJob, processAddPageJob } from './addPageProcessor';
const FALLBACK_POLL_MS = parseInt(process.env.CRAWL_FALLBACK_POLL_MS || '60000', 10); // 60s – catch missed Realtime, stuck jobs
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);
const activeJobs = new Set();
let wakeResolver = null;
const wakePromise = () => new Promise(resolve => { wakeResolver = resolve; });
const wake = () => {
    if (wakeResolver) {
        wakeResolver();
        wakeResolver = null;
    }
};
async function main() {
    console.log('[worker] Started, using Realtime for job discovery (fallback poll every', FALLBACK_POLL_MS / 1000, 's)');
    // Subscribe to new crawl jobs – wake immediately when a queued job appears
    supabase
        .channel('worker-crawl-jobs')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crawl_jobs' }, (payload) => {
        if (payload.new?.status === 'queued')
            wake();
    })
        .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log('[worker] Realtime subscribed to crawl_jobs');
        }
        else if (status === 'CHANNEL_ERROR') {
            console.warn('[worker] Realtime channel error – relying on fallback poll');
        }
    });
    // Subscribe to add_page_jobs
    supabase
        .channel('worker-add-page-jobs')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'add_page_jobs' }, (payload) => {
        if (payload.new?.status === 'queued')
            wake();
    })
        .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
            console.log('[worker] Realtime subscribed to add_page_jobs');
        }
        else if (status === 'CHANNEL_ERROR') {
            console.warn('[worker] add_page_jobs channel error – relying on fallback poll');
        }
    });
    let fallbackTimer = null;
    const scheduleFallback = () => {
        if (fallbackTimer)
            clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(() => {
            fallbackTimer = null;
            wake();
        }, FALLBACK_POLL_MS);
    };
    let hasLoggedIdle = false;
    while (true) {
        try {
            while (activeJobs.size < MAX_CONCURRENT_JOBS) {
                const crawlJob = await claimJob();
                const addPageJob = !crawlJob ? await claimAddPageJob() : null;
                const job = crawlJob ?? addPageJob;
                if (!job) {
                    if (!hasLoggedIdle) {
                        console.log('[worker] Idle (Add a source or page to create a job)');
                        hasLoggedIdle = true;
                    }
                    scheduleFallback();
                    await wakePromise();
                    continue;
                }
                hasLoggedIdle = false;
                if (fallbackTimer) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                const sourceShort = job.source_id?.slice(0, 8) || '?';
                const convShort = job.conversation_id?.slice(0, 8) || '?';
                if (addPageJob) {
                    console.log('[worker] Claimed add_page_job', job.id.slice(0, 8), 'source', sourceShort, 'conv', convShort);
                }
                else {
                    console.log('[worker] Claimed job', job.id.slice(0, 8), 'source', sourceShort, 'conv', convShort, '(discovered/indexed logs will follow with [D/I] prefix)');
                }
                activeJobs.add(job.id);
                const processor = addPageJob
                    ? processAddPageJob(addPageJob)
                    : processCrawlJob(job.id);
                processor
                    .then(() => {
                    activeJobs.delete(job.id);
                    wake(); // Free slot – try to claim next job
                })
                    .catch((error) => {
                    activeJobs.delete(job.id);
                    wake();
                    console.error(`❌ Job ${job.id.substring(0, 8)}... failed:`, error);
                });
            }
            // At capacity – wait for a slot before checking again
            scheduleFallback();
            await wakePromise();
        }
        catch (error) {
            console.error('❌ Error in main loop:', error);
            scheduleFallback();
            await wakePromise();
        }
    }
}
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=index.js.map