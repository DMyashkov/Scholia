import { usePages } from './usePages';
import { useCrawlJob } from './useCrawlJobs';
import type { Source as DBSource, CrawlJob } from '@/lib/db/types';
import type { Source, DiscoveredPage } from '@/types/source';

export const useSourceWithData = (dbSource: DBSource | null): Source | null => {
  const { data: pages = [] } = usePages(dbSource?.id || null);
  const { data: crawlJob } = useCrawlJob(dbSource?.id || null, (dbSource as { conversation_id?: string })?.conversation_id);

  if (!dbSource) return null;

  // Determine status from crawl job
  let status: Source['status'] = 'ready';
  let pagesIndexed = 0;
  let totalPages = 0;

  if (crawlJob) {
    if (crawlJob.status === 'queued' || crawlJob.status === 'running') {
      status = 'crawling';
    } else if (crawlJob.status === 'failed') {
      status = 'error';
    } else if (crawlJob.status === 'completed') {
      status = 'ready';
    }
    pagesIndexed = (crawlJob as CrawlJob).indexed_count ?? 0;
    totalPages = crawlJob.total_pages || pages.length || 0;
  } else {
    totalPages = pages.length;
  }

  return {
    id: dbSource.id,
    initial_url: dbSource.initial_url,
    domain: dbSource.domain,
    source_label: (dbSource as { source_label?: string | null }).source_label ?? undefined,
    status,
    crawlDepth: dbSource.crawl_depth,
    suggestionMode: (dbSource as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface',
    sameDomainOnly: dbSource.same_domain_only,
    pagesIndexed,
    totalPages: totalPages || 0,
    lastUpdated: new Date(dbSource.updated_at),
    discoveredPages: pages.map(p => ({
      id: p.id,
      title: p.title || 'Untitled',
      path: p.path,
      status: p.status as DiscoveredPage['status'],
      content: p.content || undefined,
      url: p.url, // Include URL for edge matching
    } as DiscoveredPage & { url?: string })),
  };
};
