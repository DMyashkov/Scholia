import { supabase } from '../db';
let _noQueuedLogCounter = 0;
export async function updateJobStatus(jobId, status, errorMessage = null, startedAt = null, completedAt = null) {
    const updates = {
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
/**
 * Atomically claim a queued job.
 * Returns null if no job available or if claim failed.
 */
export async function claimJob() {
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
        console.error(`❌ Error fetching queued jobs:`, fetchError);
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
                console.log(`[worker] no queued jobs, fetch error (check DB connection):`, allError.message);
            }
            else if (!allJobs || allJobs.length === 0) {
                console.log(`[worker] no queued jobs, DB has 0 crawl_jobs (add a source to create one)`);
            }
            else {
                const summary = allJobs.map((j) => ({ id: j.id?.slice(0, 8), status: j.status, created: j.created_at?.slice(11, 19) }));
                console.log(`[worker] no queued jobs but ${allJobs.length} recent:`, summary);
                const queued = allJobs.filter((j) => j.status === 'queued');
                if (queued.length > 0) {
                    console.log(`[worker] BUG: ${queued.length} queued in recent but claimJob missed them!`, queued.map((j) => j.id));
                }
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
        console.log('[worker] claim failed (race or no longer queued)', {
            jobId: jobToClaim.id?.slice(0, 8),
            updateError: updateError?.message,
        });
        return null;
    }
    return updated;
}
//# sourceMappingURL=job.js.map