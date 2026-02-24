import { GraphNode, GraphLink, GraphData } from './types';
import { DiscoveredPage } from '@/types/source';
import type { PageEdge } from '@/lib/db/types';







function normalizeUrlForMatching(url: string): string {
  try {
    const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
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

/** Return canonical form and the other common root form so both match (worker may store either). */
function urlMatchVariants(url: string): string[] {
  const n = normalizeUrlForMatching(url);
  const variants = [n, n.toLowerCase()];
  try {
    const u = new URL(n);
    if (u.pathname === '/' && n.endsWith('/')) variants.push(u.origin);
    else if (u.pathname === '/' && !n.endsWith('/')) variants.push(`${u.origin}/`);
  } catch {
    /* ignore */
  }
  return variants;
}

/** Add protocol and host variants (http/https, www/non-www) so edge.to_url matches even if stored slightly differently. */
function addUrlVariantsToMap(url: string, pageId: string, map: Map<string, string>): void {
  try {
    const u = new URL(url);
    const host = u.hostname;
    const pathPart = u.pathname + u.search;
    const origins = [u.origin, u.origin.toLowerCase()];
    if (host.startsWith('www.')) {
      const bare = host.slice(4);
      origins.push(`${u.protocol}//${bare}`, `${u.protocol}//${bare}`.toLowerCase());
    } else {
      origins.push(`${u.protocol}//www.${host}`, `${u.protocol}//www.${host}`.toLowerCase());
    }
    const protocolSwap = u.protocol === 'https:' ? 'http:' : 'https:';
    origins.push(`${protocolSwap}//${u.host}`, `${protocolSwap}//${u.host}`.toLowerCase());
    origins.forEach((origin) => {
      const full = origin + pathPart;
      map.set(full, pageId);
      map.set(full.toLowerCase(), pageId);
    });
  } catch {
    /* ignore */
  }
}

/**
 * Dedupe pages by normalized URL so the same URL from multiple sources (e.g. second static source
 * that is one of the first source's pages) becomes one node. Returns canonical page list and a map
 * from any page id to its canonical id for that URL.
 */
function dedupePagesByUrl(
  pages: DiscoveredPage[],
  domain?: string
): { canonicalPages: (DiscoveredPage & { url?: string })[]; pageIdToCanonicalId: Map<string, string> } {
  const byUrl = new Map<string, (DiscoveredPage & { url?: string })[]>();
  for (const page of pages) {
    const pageUrl = (page as DiscoveredPage & { url?: string }).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    const key = normalizeUrlForMatching(pageUrl).toLowerCase();
    if (!byUrl.has(key)) byUrl.set(key, []);
    byUrl.get(key)!.push({ ...page, url: pageUrl });
  }
  const canonicalPages: (DiscoveredPage & { url?: string })[] = [];
  const pageIdToCanonicalId = new Map<string, string>();
  byUrl.forEach((group) => {
    const canonical = group[0];
    canonicalPages.push(canonical);
    group.forEach((p) => pageIdToCanonicalId.set(p.id, canonical.id));
  });
  return { canonicalPages, pageIdToCanonicalId };
}






export const createGraphData = (
  pages: DiscoveredPage[], 
  pagesIndexed: number,
  dimensions: { width: number; height: number },
  domain?: string,
  edges?: PageEdge[]
): GraphData => {
  const { canonicalPages, pageIdToCanonicalId } = dedupePagesByUrl(pages, domain);
  const visiblePages = canonicalPages;

  
  const urlToPageId = new Map<string, string>();
  const pageIdMap = new Map<string, DiscoveredPage>();
  
  visiblePages.forEach(page => {
    
    const pageUrl = (page as DiscoveredPage & { url?: string }).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    const normalizedUrl = normalizeUrlForMatching(pageUrl);
    
    urlMatchVariants(pageUrl).forEach((v) => urlToPageId.set(v, page.id));
    urlMatchVariants(normalizedUrl).forEach((v) => urlToPageId.set(v, page.id));
    urlToPageId.set(pageUrl, page.id);
    urlToPageId.set(pageUrl.toLowerCase(), page.id);
    addUrlVariantsToMap(normalizedUrl, page.id, urlToPageId);
    const u = new URL(normalizedUrl);
    const withoutProtocol = `${u.hostname}${u.pathname}`;
    urlToPageId.set(withoutProtocol, page.id);
    urlToPageId.set(withoutProtocol.toLowerCase(), page.id);
    pageIdMap.set(page.id, page);
  });
  
  const nodes: GraphNode[] = visiblePages.map((page, i) => {
    const pageUrl = (page as DiscoveredPage & { url?: string }).url || (domain ? `https://${domain}${page.path}` : `https://example.com${page.path}`);
    
    const isStartingPage = i === 0;
    return {
    id: page.id,
    title: page.title,
    status: page.status,
      url: pageUrl,
      
      x: isStartingPage 
        ? dimensions.width / 2 
        : dimensions.width / 2 + Math.cos((i - 1) * (2 * Math.PI / Math.max(visiblePages.length - 1, 1))) * 80,
      y: isStartingPage 
        ? dimensions.height / 2 
        : dimensions.height / 2 + Math.sin((i - 1) * (2 * Math.PI / Math.max(visiblePages.length - 1, 1))) * 80,
    };
  });

  
  const links: GraphLink[] = [];
  const edgesArray = edges || [];

  const dropReasons: { fromMissing: number; toMissing: number; duplicate: number; self: number } = {
    fromMissing: 0,
    toMissing: 0,
    duplicate: 0,
    self: 0,
  };
  const dropSamples: { reason: string; from_page_id?: string; to_url?: string }[] = [];

  if (edgesArray.length > 0) {
    const visiblePageIds = new Set(visiblePages.map(p => p.id));
    const linkSet = new Set<string>();

    
    const toCanonical = (id: string | null | undefined): string | undefined =>
      id ? pageIdToCanonicalId.get(id) ?? (visiblePageIds.has(id) ? id : undefined) : undefined;

    edgesArray.forEach((edge) => {
      const rawFrom = toCanonical(edge.from_page_id);
      const fromPageId = rawFrom && visiblePageIds.has(rawFrom) ? rawFrom : undefined;
      let toPageId: string | undefined = toCanonical(edge.to_page_id);
      if (toPageId) toPageId = visiblePageIds.has(toPageId) ? toPageId : undefined;

      if (!toPageId && edge.to_url) {
        const normalizedEdgeUrl = normalizeUrlForMatching(edge.to_url);
        let raw = urlToPageId.get(edge.to_url) ?? urlToPageId.get(normalizedEdgeUrl);
        if (!raw) {
          for (const variant of urlMatchVariants(edge.to_url)) {
            raw = urlToPageId.get(variant);
            if (raw) break;
          }
        }
        if (!raw) {
          const urlObj = new URL(normalizedEdgeUrl);
          const withoutProtocol = `${urlObj.hostname}${urlObj.pathname}`;
          raw = urlToPageId.get(withoutProtocol) || urlToPageId.get(withoutProtocol.toLowerCase());
        }
        toPageId = raw && visiblePageIds.has(raw) ? raw : undefined;
      }

      if (!fromPageId) {
        dropReasons.fromMissing++;
        if (dropSamples.length < 5) dropSamples.push({ reason: 'from_page_id missing or not in visiblePages', from_page_id: edge.from_page_id, to_url: edge.to_url ?? undefined });
        return;
      }
      if (!toPageId) {
        dropReasons.toMissing++;
        if (dropSamples.length < 5) dropSamples.push({ reason: 'to_url did not match any page (target not in graph)', from_page_id: edge.from_page_id, to_url: edge.to_url ?? undefined });
        return;
      }
      if (fromPageId === toPageId) {
        dropReasons.self++;
        return;
      }
      const linkKey = `${fromPageId}-${toPageId}`;
      if (linkSet.has(linkKey)) {
        dropReasons.duplicate++;
        return;
      }
      linkSet.add(linkKey);
      links.push({ source: fromPageId, target: toPageId });
    });

    
  }

  return { nodes, links };
};




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