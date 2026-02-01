import { GraphNode, GraphLink, GraphData } from './types';
import { DiscoveredPage } from '@/types/source';
import type { PageEdge } from '@/lib/db/types';

/**
 * Normalize URL for matching. Must match worker normalization exactly so
 * edge from_url/to_url (stored by worker) match page.url (stored by worker).
 * Worker: hash='', search='', pathname '' or '/' -> '/', else strip trailing slash.
 */
function normalizeUrlForMatching(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';
    urlObj.search = '';
    if (urlObj.pathname === '/' || urlObj.pathname === '') {
      urlObj.pathname = '/';
    } else if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

/**
 * Convert pages and edges to graph data structure.
 * Only real edges from the API are used; no synthetic/fallback links.
 */
export const createGraphData = (
  pages: DiscoveredPage[], 
  pagesIndexed: number,
  dimensions: { width: number; height: number },
  domain?: string,
  edges?: PageEdge[]
): GraphData => {
  // Always use all pages we have: graph shows every node and every edge between them.
  // No slice by pagesIndexed — avoids 0 nodes (job count stale) and missing layer-2 edges.
  const visiblePages = pages;

  // Create maps for edge matching: URL -> page ID and page ID -> page
  const urlToPageId = new Map<string, string>();
  const pageIdMap = new Map<string, DiscoveredPage>();
  
  visiblePages.forEach(page => {
    // Try to extract URL from page data
    // If page has a url field, use it; otherwise construct from domain + path
    const pageUrl = (page as any).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    // Normalize URL for matching (remove trailing slash, fragment, query params)
    const normalizedUrl = normalizeUrlForMatching(pageUrl);
    
    // Add multiple variations for matching (case-insensitive, with/without trailing slash, etc.)
    urlToPageId.set(normalizedUrl.toLowerCase(), page.id);
    urlToPageId.set(normalizedUrl, page.id); // Also add original case
    urlToPageId.set(pageUrl.toLowerCase(), page.id); // Also match original URL
    urlToPageId.set(pageUrl, page.id);
    
    // Also try without protocol for matching
    try {
      const urlObj = new URL(normalizedUrl);
      const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
      urlToPageId.set(withoutProtocol.toLowerCase(), page.id);
      urlToPageId.set(withoutProtocol, page.id);
    } catch (e) {
      // Ignore URL parsing errors
    }
    
    pageIdMap.set(page.id, page);
  });
  
  const nodes: GraphNode[] = visiblePages.map((page, i) => {
    const pageUrl = (page as any).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    // First page (starting page) should be at center, others spread around
    const isStartingPage = i === 0;
    return {
    id: page.id,
    title: page.title,
    status: page.status,
      url: pageUrl,
      // Starting page at center, others spread around in a circle
      x: isStartingPage 
        ? dimensions.width / 2 
        : dimensions.width / 2 + Math.cos((i - 1) * (2 * Math.PI / Math.max(visiblePages.length - 1, 1))) * 80,
      y: isStartingPage 
        ? dimensions.height / 2 
        : dimensions.height / 2 + Math.sin((i - 1) * (2 * Math.PI / Math.max(visiblePages.length - 1, 1))) * 80,
    };
  });

  // Use real edges if available
  let links: GraphLink[] = [];
  // Ensure edges is an array (handle undefined/null)
  const edgesArray = edges || [];
  
  if (edgesArray.length > 0) {
    const visiblePageIds = new Set(visiblePages.map(p => p.id));
    const linkSet = new Set<string>();

    const edgeDiagnostics: Array<{ edgeIdx: number; from_page_id: string | null; to_page_id: string | null; from_url: string | null; to_url: string | null; fromPageId: string | null; toPageId: string | null }> = [];

    edgesArray.forEach((edge, edgeIdx) => {
      // Match by page ID when present (worker sends from_page_id), else by URL
      let fromPageId: string | undefined = edge.from_page_id && visiblePageIds.has(edge.from_page_id) ? edge.from_page_id : undefined;
      let toPageId: string | undefined = edge.to_page_id && visiblePageIds.has(edge.to_page_id) ? edge.to_page_id : undefined;

      if (!fromPageId && edge.from_url) {
        const normalizedFromUrl = normalizeUrlForMatching(edge.from_url);
        fromPageId = urlToPageId.get(normalizedFromUrl)
          || urlToPageId.get(normalizedFromUrl.toLowerCase())
          || urlToPageId.get(edge.from_url)
          || urlToPageId.get(edge.from_url.toLowerCase());
        if (!fromPageId) {
          try {
            const urlObj = new URL(normalizedFromUrl);
            const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
            fromPageId = urlToPageId.get(withoutProtocol) || urlToPageId.get(withoutProtocol.toLowerCase());
          } catch {
            // ignore
          }
        }
      }

      if (!toPageId && edge.to_url) {
        const normalizedToUrl = normalizeUrlForMatching(edge.to_url);
        toPageId = urlToPageId.get(normalizedToUrl)
          || urlToPageId.get(normalizedToUrl.toLowerCase())
          || urlToPageId.get(edge.to_url)
          || urlToPageId.get(edge.to_url.toLowerCase());
        if (!toPageId) {
          try {
            const urlObj = new URL(normalizedToUrl);
            const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
            toPageId = urlToPageId.get(withoutProtocol) || urlToPageId.get(withoutProtocol.toLowerCase());
          } catch {
            // ignore
          }
        }
      }

      if (import.meta.env.DEV && edgeIdx < 5) {
        edgeDiagnostics.push({
          edgeIdx,
          from_page_id: edge.from_page_id ?? null,
          to_page_id: edge.to_page_id ?? null,
          from_url: edge.from_url ?? null,
          to_url: edge.to_url ?? null,
          fromPageId: fromPageId ?? null,
          toPageId: toPageId ?? null,
        });
      }

      if (fromPageId && toPageId &&
          visiblePageIds.has(fromPageId) &&
          visiblePageIds.has(toPageId) &&
          fromPageId !== toPageId) {
        const linkKey = `${fromPageId}-${toPageId}`;
        if (!linkSet.has(linkKey)) {
          linkSet.add(linkKey);
          links.push({
            source: fromPageId,
            target: toPageId,
          });
        }
      }
    });

    // Diagnostic: when we have edges + pages but 0 links, log why (DEV only)
    if (import.meta.env.DEV && edgesArray.length > 0 && visiblePages.length > 0 && links.length === 0) {
      const pageUrls = visiblePages.map((p) => {
        const u = (p as any).url || (domain ? `https://${domain}${p.path}` : '');
        return { id: p.id.slice(0, 8), url: u?.slice(0, 70), norm: normalizeUrlForMatching(u || '')?.slice(0, 70) };
      });
      const mapKeys = Array.from(urlToPageId.keys()).slice(0, 10);
      console.log('[graph] 0 links matched — why', {
        visiblePages: visiblePages.length,
        pagesIndexed,
        edgesCount: edgesArray.length,
        pageUrls,
        urlToPageIdKeysSample: mapKeys,
        visiblePageIds: Array.from(visiblePageIds).map((id) => id.slice(0, 8)),
        firstEdgesResolved: edgeDiagnostics,
      });
    }
  } else {
    links = [];
  }

  if (import.meta.env.DEV) {
    console.log('[graph]', { nodes: nodes.length, links: links.length, pages: pages.length, edges: edgesArray.length });
  }
  return { nodes, links };
};

/**
 * Get node color based on status
 */
export const getNodeColor = (status: GraphNode['status']): string => {
  switch (status) {
    case 'indexed':
      return 'hsl(var(--primary))';
    case 'crawling':
      return 'hsl(var(--primary) / 0.6)';
    case 'error':
      return 'hsl(var(--destructive))';
    default:
      return 'hsl(var(--muted-foreground) / 0.4)';
  }
};

/**
 * Get connected node IDs for a given node
 */
export const getConnectedNodeIds = (nodeId: string, links: GraphLink[]): Set<string> => {
  const connectedIds = new Set<string>([nodeId]);
  
  links.forEach(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    
    if (sourceId === nodeId) connectedIds.add(targetId);
    if (targetId === nodeId) connectedIds.add(sourceId);
  });
  
  return connectedIds;
};
