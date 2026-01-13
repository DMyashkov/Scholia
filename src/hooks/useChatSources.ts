import { useCallback, useRef } from 'react';
import { Source, CrawlDepth } from '@/types/source';
import { generateMockPages } from '@/data/mockSourceContent';

const generateId = () => Math.random().toString(36).substring(2, 15);

const extractDomain = (url: string): string => {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url;
  }
};

const getTotalPagesForDepth = (depth: CrawlDepth): number => {
  switch (depth) {
    case 'shallow': return 5;
    case 'medium': return 15;
    case 'deep': return 35;
  }
};

interface UseChatSourcesOptions {
  sources: Source[];
  onSourcesChange: (sources: Source[]) => void;
}

export const useChatSources = ({ sources, onSourcesChange }: UseChatSourcesOptions) => {
  const crawlIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const startCrawlSimulation = useCallback((sourceId: string, currentSources: Source[]) => {
    const interval = setInterval(() => {
      const source = currentSources.find(s => s.id === sourceId);
      if (!source || source.status !== 'crawling') {
        clearInterval(interval);
        crawlIntervals.current.delete(sourceId);
        return;
      }

      onSourcesChange(currentSources.map(s => {
        if (s.id !== sourceId) return s;
        
        const newPagesIndexed = Math.min(s.pagesIndexed + 1, s.totalPages);
        const isComplete = newPagesIndexed >= s.totalPages;

        const updatedPages = s.discoveredPages.map((page, index) => ({
          ...page,
          status: index < newPagesIndexed ? 'indexed' as const : page.status,
        }));

        if (isComplete) {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
        }

        return {
          ...s,
          status: isComplete ? 'ready' as const : 'crawling' as const,
          pagesIndexed: newPagesIndexed,
          discoveredPages: updatedPages,
          lastUpdated: isComplete ? new Date() : s.lastUpdated,
        };
      }));
    }, 300 + Math.random() * 500);

    crawlIntervals.current.set(sourceId, interval);
  }, [onSourcesChange]);

  const addSource = useCallback((
    url: string,
    depth: CrawlDepth,
    options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }
  ) => {
    const domain = extractDomain(url);
    const totalPages = getTotalPagesForDepth(depth);
    const id = generateId();

    const discoveredPages = generateMockPages(domain, 'crawling');
    
    while (discoveredPages.length < totalPages) {
      discoveredPages.push({
        id: `${domain}-page-${discoveredPages.length}`,
        title: `Page ${discoveredPages.length + 1}`,
        path: `/page-${discoveredPages.length + 1}`,
        status: 'pending',
      });
    }

    const newSource: Source = {
      id,
      url: url.startsWith('http') ? url : `https://${url}`,
      domain,
      status: 'crawling',
      crawlDepth: depth,
      includeSubpages: options.includeSubpages,
      includePdfs: options.includePdfs,
      sameDomainOnly: options.sameDomainOnly,
      pagesIndexed: 0,
      totalPages,
      lastUpdated: new Date(),
      discoveredPages,
    };

    const newSources = [...sources, newSource];
    onSourcesChange(newSources);
    
    // Start the crawl simulation with the new sources array
    setTimeout(() => startCrawlSimulation(id, newSources), 0);

    return id;
  }, [sources, onSourcesChange, startCrawlSimulation]);

  const removeSource = useCallback((sourceId: string) => {
    const interval = crawlIntervals.current.get(sourceId);
    if (interval) {
      clearInterval(interval);
      crawlIntervals.current.delete(sourceId);
    }
    
    onSourcesChange(sources.filter(s => s.id !== sourceId));
  }, [sources, onSourcesChange]);

  const recrawlSource = useCallback((sourceId: string) => {
    const existingInterval = crawlIntervals.current.get(sourceId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    const newSources = sources.map(s =>
      s.id === sourceId
        ? {
            ...s,
            status: 'crawling' as const,
            pagesIndexed: 0,
            discoveredPages: s.discoveredPages.map(p => ({ ...p, status: 'pending' as const })),
          }
        : s
    );
    
    onSourcesChange(newSources);
    setTimeout(() => startCrawlSimulation(sourceId, newSources), 0);
  }, [sources, onSourcesChange, startCrawlSimulation]);

  const getReadySources = useCallback(() => {
    return sources.filter(s => s.status === 'ready');
  }, [sources]);

  const getCrawlingSources = useCallback(() => {
    return sources.filter(s => s.status === 'crawling');
  }, [sources]);

  const clearAllIntervals = useCallback(() => {
    crawlIntervals.current.forEach(interval => clearInterval(interval));
    crawlIntervals.current.clear();
  }, []);

  return {
    sources,
    addSource,
    removeSource,
    recrawlSource,
    getReadySources,
    getCrawlingSources,
    clearAllIntervals,
  };
};
