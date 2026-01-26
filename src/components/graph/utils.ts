import { GraphNode, GraphLink, GraphData } from './types';
import { DiscoveredPage } from '@/types/source';
import type { PageEdge } from '@/lib/db/types';

/**
 * Generate links between nodes to create an organic graph structure
 */
export const generateLinks = (nodes: GraphNode[]): GraphLink[] => {
  const links: GraphLink[] = [];
  
  nodes.forEach((node, i) => {
    if (i === 0) return;
    
    // Connect to a previous node (creates tree-like structure)
    const targetIndex = Math.floor(Math.random() * i);
    links.push({
      source: node.id,
      target: nodes[targetIndex].id,
    });
    
    // Occasionally add cross-links for more organic feel
    if (Math.random() > 0.7 && i > 2) {
      const crossTarget = Math.floor(Math.random() * (i - 1));
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
    urlToPageId.set(pageUrl.toLowerCase(), page.id);
    urlToPageId.set(pageUrl, page.id); // Also add original case
    pageIdMap.set(page.id, page);
  });
  
  const nodes: GraphNode[] = visiblePages.map((page, i) => {
    const pageUrl = (page as any).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    return {
      id: page.id,
      title: page.title,
      status: page.status,
      url: pageUrl,
      // Initial positions spread around center
      x: dimensions.width / 2 + (Math.random() - 0.5) * 100,
      y: dimensions.height / 2 + (Math.random() - 0.5) * 100,
    };
  });

  // Use real edges if available
  let links: GraphLink[] = [];
  if (edges && edges.length > 0) {
    // Filter edges to only include those between visible pages
    const visiblePageIds = new Set(visiblePages.map(p => p.id));
    const linkSet = new Set<string>(); // Dedupe links
    
    edges.forEach(edge => {
      // Try to match by URL first, then by page ID
      let fromPageId: string | undefined = undefined;
      let toPageId: string | undefined = undefined;
      
      if (edge.from_url) {
        fromPageId = urlToPageId.get(edge.from_url) || urlToPageId.get(edge.from_url.toLowerCase());
      }
      if (!fromPageId && edge.from_page_id) {
        fromPageId = edge.from_page_id;
      }
      
      if (edge.to_url) {
        toPageId = urlToPageId.get(edge.to_url) || urlToPageId.get(edge.to_url.toLowerCase());
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
        }
      }
    });
  } else {
    // Fallback to generated links if no edges available
    links = generateStableLinks(nodes);
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
