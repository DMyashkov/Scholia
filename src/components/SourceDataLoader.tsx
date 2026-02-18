/**
 * Component to load pages and crawl jobs for sources
 * This is needed because we can't use hooks conditionally in useChatDatabase
 */

import { usePages } from '@/hooks/usePages';
import { useCrawlJob } from '@/hooks/useCrawlJobs';
import type { Source as DBSource, Page } from '@/lib/db/types';
import type { Source, DiscoveredPage } from '@/types/source';

interface SourceDataLoaderProps {
  source: DBSource;
  onDataLoaded: (source: Source) => void;
}

export const SourceDataLoader = ({ source, onDataLoaded }: SourceDataLoaderProps) => {
  const { data: pages = [] } = usePages(source.id);
  const { data: crawlJob } = useCrawlJob(source.id, source.conversation_id);

  // Convert to UI format
  const uiSource: Source = {
    id: source.id,
    initial_url: source.initial_url,
    domain: source.domain,
    status: crawlJob?.status === 'queued' || crawlJob?.status === 'running' ? 'crawling' 
      : crawlJob?.status === 'failed' ? 'error' 
      : 'ready',
    crawlDepth: source.crawl_depth,
    suggestionMode: (source as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface',
    sameDomainOnly: source.same_domain_only,
    pagesIndexed: crawlJob?.indexed_count ?? 0,
    totalPages: crawlJob?.total_pages || pages.length || 0,
    lastUpdated: new Date(source.updated_at),
    discoveredPages: pages.map((p: Page) => ({
      id: p.id,
      title: p.title || 'Untitled',
      path: p.path,
      status: p.status as DiscoveredPage['status'],
      content: p.content || undefined,
    })),
  };

  // Call callback when data is ready
  // This is a bit of a workaround - ideally we'd use this data directly
  // But for now this allows us to load source data properly
  return null;
};
