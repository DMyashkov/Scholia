import { GraphNode, GraphLink, GraphData } from './types';
import { DiscoveredPage } from '@/types/source';
import type { PageEdge } from '@/lib/db/types';

/**
 * Normalize URL for matching (remove fragment, query params, trailing slash)
 */
function normalizeUrlForMatching(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.hash = '';
    urlObj.search = '';
    // Remove trailing slash except for root
    if (urlObj.pathname !== '/' && urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    return urlObj.toString();
  } catch {
    return url;
  }
}

// Use real edges from database only; when edges are empty we show nodes with no links (no fake topology)

/**
 * Convert pages and edges to graph data structure
 * Uses real edges from database if available, otherwise generates stable links
 */
export const createGraphData = (
  pages: DiscoveredPage[], 
  pagesIndexed: number,
  dimensions: { width: number; height: number },
  domain?: string,
  edges?: PageEdge[]
): GraphData => {
  const visiblePages = pages.slice(0, pagesIndexed);
  
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
  
  // Debug: Log URL mapping for troubleshooting (after edgesArray is declared)
  if (import.meta.env.DEV && visiblePages.length > 0 && edgesArray.length > 0) {
    console.log(`🔗 URL Mapping: ${urlToPageId.size} URL variations mapped to ${visiblePages.length} pages`, {
      sampleMappings: Array.from(urlToPageId.entries()).slice(0, 5).map(([url, id]) => ({
        url: url.substring(0, 60),
        pageId: id.substring(0, 8),
      })),
    });
  }
  
  if (edgesArray.length > 0) {
    // Debug: Log edge status when edges are available
    if (import.meta.env.DEV) {
      console.log(`🔗 createGraphData: edges provided=${!!edges}, edgesArray.length=${edgesArray.length}, visiblePages.length=${visiblePages.length}`);
    }
    // Filter edges to only include those between visible pages
    const visiblePageIds = new Set(visiblePages.map(p => p.id));
    const linkSet = new Set<string>(); // Dedupe links
    
    // Debug: Log all pages and their URLs for matching
    if (import.meta.env.DEV && visiblePages.length > 0) {
      console.log('🔗 Graph Edge Matching Debug:', {
        totalEdges: edgesArray.length,
        visiblePages: visiblePages.length,
        pageUrls: visiblePages.map(p => ({
          id: p.id.substring(0, 8),
          url: (p as any).url,
          title: p.title?.substring(0, 30),
        })),
        sampleEdges: edgesArray.slice(0, 5).map(e => ({
          from_url: e.from_url,
          to_url: e.to_url,
          from_page_id: e.from_page_id,
          to_page_id: e.to_page_id,
        })),
      });
    }
    
    edgesArray.forEach(edge => {
      // Try to match by URL first, then by page ID
      let fromPageId: string | undefined = undefined;
      let toPageId: string | undefined = undefined;
      
      if (edge.from_url) {
        // Normalize the edge URL for matching
        const normalizedFromUrl = normalizeUrlForMatching(edge.from_url);
        // Try multiple matching strategies
        fromPageId = urlToPageId.get(normalizedFromUrl) 
          || urlToPageId.get(normalizedFromUrl.toLowerCase())
          || urlToPageId.get(edge.from_url)
          || urlToPageId.get(edge.from_url.toLowerCase());
        
        // Also try without protocol
        if (!fromPageId) {
          try {
            const urlObj = new URL(normalizedFromUrl);
            const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
            fromPageId = urlToPageId.get(withoutProtocol) || urlToPageId.get(withoutProtocol.toLowerCase());
          } catch (e) {
            // Ignore URL parsing errors
          }
        }
      }
      if (!fromPageId && edge.from_page_id) {
        fromPageId = edge.from_page_id;
      }
      
      if (edge.to_url) {
        // Normalize the edge URL for matching
        const normalizedToUrl = normalizeUrlForMatching(edge.to_url);
        // Try multiple matching strategies
        toPageId = urlToPageId.get(normalizedToUrl)
          || urlToPageId.get(normalizedToUrl.toLowerCase())
          || urlToPageId.get(edge.to_url)
          || urlToPageId.get(edge.to_url.toLowerCase());
        
        // Also try without protocol
        if (!toPageId) {
          try {
            const urlObj = new URL(normalizedToUrl);
            const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
            toPageId = urlToPageId.get(withoutProtocol) || urlToPageId.get(withoutProtocol.toLowerCase());
          } catch (e) {
            // Ignore URL parsing errors
          }
        }
      }
      if (!toPageId && edge.to_page_id) {
        toPageId = edge.to_page_id;
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
          
          // Debug: Log successful matches
          if (import.meta.env.DEV) {
            const fromPage = visiblePages.find(p => p.id === fromPageId);
            const toPage = visiblePages.find(p => p.id === toPageId);
            console.log(`✅ Matched edge: "${fromPage?.title?.substring(0, 30)}" -> "${toPage?.title?.substring(0, 30)}"`, {
              fromUrl: edge.from_url?.substring(0, 50),
              toUrl: edge.to_url?.substring(0, 50),
              fromPageId: fromPageId.substring(0, 8),
              toPageId: toPageId.substring(0, 8),
            });
          }
        }
      } else {
        // Debug: log why edge wasn't matched (only for first few to avoid spam)
        if (import.meta.env.DEV && edge.from_url && edge.to_url && links.length < 10) {
          const fromFound = !!fromPageId;
          const toFound = !!toPageId;
          const fromVisible = fromPageId ? visiblePageIds.has(fromPageId) : false;
          const toVisible = toPageId ? visiblePageIds.has(toPageId) : false;
          
          // Only log if it's a real issue (not just because pages aren't visible yet)
          if (fromFound && toFound && (!fromVisible || !toVisible)) {
            console.warn(`⚠️ Edge pages not visible yet: ${edge.from_url?.substring(0, 50)} -> ${edge.to_url?.substring(0, 50)}`, {
              fromVisible,
              toVisible,
              visiblePageCount: visiblePages.length,
            });
          } else if (!fromFound || !toFound) {
            console.warn(`⚠️ Edge not matched - pages not found: ${edge.from_url?.substring(0, 50)} -> ${edge.to_url?.substring(0, 50)}`, {
              fromFound,
              toFound,
              fromUrl: edge.from_url,
              toUrl: edge.to_url,
              normalizedFrom: normalizeUrlForMatching(edge.from_url),
              normalizedTo: normalizeUrlForMatching(edge.to_url),
              availableUrls: Array.from(urlToPageId.keys()).slice(0, 5),
            });
          }
        }
      }
    });
    
    // Debug: Log edge matching summary
    if (import.meta.env.DEV) {
      console.log(`🔗 Edge matching summary: ${links.length} links created from ${edgesArray.length} edges`, {
        matched: links.length,
        totalEdges: edgesArray.length,
        visiblePages: visiblePages.length,
      });
    }
  } else {
    // No edges from API: show nodes only, no links. Do NOT use generateStableLinks here:
    // during a crawl, pages often refetch before edges; fake links would show wrong topology
    // until edges load. When edges arrive, we regenerate with real links.
    if (import.meta.env.DEV && nodes.length > 0) {
      console.log('🔗 No edges yet; showing nodes only (links will appear when edges load)', {
        nodesCount: nodes.length,
      });
    }
    links = [];
  }

  if (import.meta.env.DEV && nodes.length > 0) {
    console.log(`🔗 Graph created: ${nodes.length} nodes, ${links.length} links`, {
      nodes: nodes.map(n => ({ id: n.id.substring(0, 8), title: n.title?.substring(0, 30) })),
      links: links.slice(0, 10).map(l => ({
        from: typeof l.source === 'string' ? l.source.substring(0, 8) : l.source.id?.substring(0, 8),
        to: typeof l.target === 'string' ? l.target.substring(0, 8) : l.target.id?.substring(0, 8),
      })),
    });
  }

  return { nodes, links };
};

/**
 * Generate stable links that don't change on re-render
 */
const generateStableLinks = (nodes: GraphNode[]): GraphLink[] => {
  const links: GraphLink[] = [];
  
  nodes.forEach((node, i) => {
    if (i === 0) return;
    
    // Use node ID hash for deterministic random
    const hash = simpleHash(node.id);
    const targetIndex = hash % i;
    
    links.push({
      source: node.id,
      target: nodes[targetIndex].id,
    });
    
    // Add occasional cross-links based on hash
    if ((hash % 10) > 7 && i > 2) {
      const crossTarget = (hash % (i - 1));
      if (crossTarget !== targetIndex) {
        links.push({
          source: node.id,
          target: nodes[crossTarget].id,
        });
      }
    }
  });
  
  return links;
};

/**
 * Simple hash function for stable randomization
 */
const simpleHash = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
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
