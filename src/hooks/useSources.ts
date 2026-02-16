import { useState, useCallback, useEffect, useRef } from 'react';
import { Source, CrawlDepth, DiscoveredPage } from '@/types/source';
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
    case 'singular':
    case 'dynamic': return 1;
  }
};

export const useSources = () => {
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const crawlIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const selectedSource = sources.find(s => s.id === selectedSourceId) || null;

  // Cleanup intervals on unmount
  useEffect(() => {
    const intervals = crawlIntervals.current;
    return () => {
      intervals.forEach(interval => clearInterval(interval));
    };
  }, []);

  const startCrawlSimulation = useCallback((sourceId: string) => {
    const interval = setInterval(() => {
      setSources(prev => {
        const source = prev.find(s => s.id === sourceId);
        if (!source || source.status !== 'crawling') {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
          return prev;
        }

        const newPagesIndexed = Math.min(source.pagesIndexed + 1, source.totalPages);
        const isComplete = newPagesIndexed >= source.totalPages;

        // Update discovered pages status
        const updatedPages = source.discoveredPages.map((page, index) => ({
          ...page,
          status: index < newPagesIndexed ? 'indexed' as const : page.status,
        }));

        if (isComplete) {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
        }

        return prev.map(s =>
          s.id === sourceId
            ? {
                ...s,
                status: isComplete ? 'ready' : 'crawling',
                pagesIndexed: newPagesIndexed,
                discoveredPages: updatedPages,
                lastUpdated: isComplete ? new Date() : s.lastUpdated,
              }
            : s
        );
      });
    }, 300 + Math.random() * 500);

    crawlIntervals.current.set(sourceId, interval);
  }, []);

  const addSource = useCallback((
    url: string,
    depth: CrawlDepth,
    options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }
  ) => {
    const domain = extractDomain(url);
    const totalPages = getTotalPagesForDepth(depth);
    const id = generateId();

    // Generate mock pages for this source
    const discoveredPages = generateMockPages(domain, 'crawling');
    
    // Add more mock pages based on depth
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

    setSources(prev => [...prev, newSource]);
    
    // Start the crawl simulation
    startCrawlSimulation(id);

    return id;
  }, [startCrawlSimulation]);

  const removeSource = useCallback((sourceId: string) => {
    // Clear any running interval
    const interval = crawlIntervals.current.get(sourceId);
    if (interval) {
      clearInterval(interval);
      crawlIntervals.current.delete(sourceId);
    }
    
    setSources(prev => prev.filter(s => s.id !== sourceId));
    if (selectedSourceId === sourceId) {
      setSelectedSourceId(null);
    }
  }, [selectedSourceId]);

  const recrawlSource = useCallback((sourceId: string) => {
    // Clear any existing interval
    const existingInterval = crawlIntervals.current.get(sourceId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    setSources(prev => prev.map(s =>
      s.id === sourceId
        ? {
            ...s,
            status: 'crawling',
            pagesIndexed: 0,
            discoveredPages: s.discoveredPages.map(p => ({ ...p, status: 'pending' as const })),
          }
        : s
    ));

    startCrawlSimulation(sourceId);
  }, [startCrawlSimulation]);

  const getReadySources = useCallback(() => {
    return sources.filter(s => s.status === 'ready');
  }, [sources]);

  const getCrawlingSources = useCallback(() => {
    return sources.filter(s => s.status === 'crawling');
  }, [sources]);

  return {
    sources,
    selectedSource,
    selectedSourceId,
    setSelectedSourceId,
    addSource,
    removeSource,
    recrawlSource,
    getReadySources,
    getCrawlingSources,
  };
};
