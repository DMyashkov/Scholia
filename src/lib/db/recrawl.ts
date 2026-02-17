import { supabase } from '@/lib/supabase';
import { crawlJobsApi } from './crawl-jobs';

const RECRAWL_DEBUG = true; // Set to false to disable recrawl logs

function recrawlLog(...args: unknown[]) {
  if (RECRAWL_DEBUG) {
    console.log('[recrawl]', new Date().toISOString(), ...args);
  }
}

/**
 * Recrawl a source: clear graph data and create a new crawl job.
 * - Static: delete pages/edges/chunks/discovered, create job (crawls from seed)
 * - Dynamic: collect all page URLs before delete, pass as explicit_crawl_urls so worker re-crawls seed + all added pages
 */
export async function recrawlSource(conversationId: string, sourceId: string): Promise<void> {
  recrawlLog('START', { conversationId: conversationId.slice(0, 8), sourceId: sourceId.slice(0, 8) });

  // 0. Fetch source and page URLs before deleting (for dynamic full recrawl)
  const { data: source } = await supabase
    .from('sources')
    .select('id, crawl_depth, url')
    .eq('id', sourceId)
    .single();

  let seedUrls: string[] | undefined;
  if (source?.crawl_depth === 'dynamic') {
    const { data: pages } = await supabase
      .from('pages')
      .select('url')
      .eq('source_id', sourceId);
    if (pages && pages.length > 0) {
      seedUrls = pages.map((p) => p.url);
    }
    recrawlLog('dynamic source, seedUrls count:', seedUrls?.length ?? 0);
  }

  // 1. Cancel any queued/running crawl jobs for this source
  const { data: jobs } = await supabase
    .from('crawl_jobs')
    .select('id, status')
    .eq('source_id', sourceId)
    .in('status', ['queued', 'running', 'indexing']);

  recrawlLog('cancelled jobs:', jobs?.length ?? 0, jobs?.map((j) => ({ id: j.id.slice(0, 8), status: j.status })));
  for (const job of jobs ?? []) {
    await supabase
      .from('crawl_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', job.id);
  }

  // 2. Get page IDs for this source (for chunk deletion - chunks ref pages)
  const { data: pages } = await supabase
    .from('pages')
    .select('id')
    .eq('source_id', sourceId);

  const pageIds = (pages ?? []).map((p) => p.id);

  // 3. Delete chunks for these pages (chunks have FK to pages)
  recrawlLog('pageIds to delete:', pageIds.length);
  if (pageIds.length > 0) {
    const { error: chunksErr } = await supabase.from('chunks').delete().in('page_id', pageIds);
    if (chunksErr) recrawlLog('chunks delete error:', chunksErr);
  }

  // 4. Delete discovered_links for this source (via from_page_id -> pages)
  const { data: sourcePages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
  const sourcePageIds = (sourcePages ?? []).map((p) => p.id);
  const { error: dlErr } =
    sourcePageIds.length > 0
      ? await supabase.from('discovered_links').delete().in('from_page_id', sourcePageIds)
      : { error: null };
  recrawlLog('discovered_links delete', dlErr ? { error: dlErr } : 'ok');

  // 5. Delete page_edges (via from_page_id - edges reference pages)
  if (pageIds.length > 0) {
    const { error: edgesErr } = await supabase
      .from('page_edges')
      .delete()
      .in('from_page_id', pageIds);
    if (edgesErr) recrawlLog('page_edges delete error:', edgesErr);
  }

  // 6. Delete pages
  const { error: pagesErr } = await supabase
    .from('pages')
    .delete()
    .eq('source_id', sourceId);
  if (pagesErr) recrawlLog('pages delete error:', pagesErr);

  // 7. Create new crawl job (with explicit_crawl_urls for dynamic full recrawl) - explicit 0 for all progress fields
  const newJobPayload = {
    source_id: sourceId,
    status: 'queued',
    indexed_count: 0,
    discovered_count: 0,
    total_pages: null,
    error_message: null,
    started_at: null,
    completed_at: null,
    last_activity_at: null,
    explicit_crawl_urls: seedUrls ?? null,
    encoding_chunks_done: 0,
    encoding_chunks_total: 0,
    encoding_discovered_done: 0,
    encoding_discovered_total: 0,
  };
  recrawlLog('creating new job with zeroed counts:', newJobPayload);
  const newJob = await crawlJobsApi.create(newJobPayload);
  recrawlLog('DONE new job id:', newJob.id?.slice(0, 8), 'status:', newJob.status, 'discovered_count:', newJob.discovered_count, 'indexed_count:', newJob.indexed_count);
}
