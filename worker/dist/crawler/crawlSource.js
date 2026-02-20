import fetch from 'node-fetch';
import RobotsParser from 'robots-parser';
import { supabase } from '../db';
import { indexSourceForRag } from '../indexer';
import { MAX_LINKS_PER_PAGE_DYNAMIC, MAX_PAGES } from './constants';
import { crawlPage } from './crawlPage';
import { extractLinks, extractLinksWithContext } from './links';
import { normalizeUrlForCrawl } from './urlUtils';
export async function crawlSource(job, source) {
    let conversationId = source.conversation_id;
    if (!conversationId) {
        const { data: sourceRow, error: srcError } = await supabase
            .from('sources')
            .select('conversation_id')
            .eq('id', source.id)
            .single();
        if (srcError || !sourceRow?.conversation_id) {
            throw new Error(`No conversation found for source ${source.id}`);
        }
        conversationId = sourceRow.conversation_id;
    }
    const { data: conversation, error: convCheckError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .single();
    if (convCheckError || !conversation) {
        throw new Error(`Conversation ${conversationId} does not exist for source ${source.id}`);
    }
    return crawlSourceWithConversationId(job, source, conversationId);
}
async function crawlSourceWithConversationId(job, source, conversationId) {
    const rawDepth = source.crawl_depth;
    let maxPages = (rawDepth ? MAX_PAGES[rawDepth] : undefined) ??
        (rawDepth === 'dynamic' ? 1 : 15);
    const explicitKey = job.explicit_crawl_urls;
    const seedUrls = explicitKey && explicitKey.length > 0
        ? explicitKey.map((u) => normalizeUrlForCrawl(u))
        : [normalizeUrlForCrawl(source.initial_url)];
    if (seedUrls.length > maxPages) {
        maxPages = seedUrls.length;
    }
    const visited = new Set();
    const discovered = new Set();
    const queue = [...seedUrls];
    seedUrls.forEach((u) => discovered.add(u));
    let sourceTitleUpdated = false;
    const firstSeedUrl = seedUrls[0];
    let robotsParser = null;
    try {
        const robotsUrl = new URL('/robots.txt', firstSeedUrl).toString();
        const robotsResponse = await fetch(robotsUrl);
        if (robotsResponse.ok) {
            const robotsText = await robotsResponse.text();
            robotsParser = RobotsParser(robotsUrl, robotsText);
        }
    }
    catch (err) {
        console.warn('crawl: robots.txt unavailable', firstSeedUrl.slice(0, 50), err instanceof Error
            ? err.message : err);
    }
    if (queue.length === 0) {
        return;
    }
    const sourceShort = new URL(firstSeedUrl).pathname?.replace(/^\/wiki\//, '') || firstSeedUrl.slice(0, 40);
    console.log('crawl: started', sourceShort, 'max', maxPages);
    while (queue.length > 0 && visited.size < maxPages) {
        const url = queue.shift();
        const urlObj = new URL(url);
        urlObj.hash = '';
        urlObj.search = '';
        if (urlObj.pathname === '/' || urlObj.pathname === '') {
            urlObj.pathname = '/';
        }
        else if (urlObj.pathname.endsWith('/')) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        const normalizedUrl = urlObj.toString();
        if (robotsParser && !robotsParser.isAllowed(normalizedUrl, 'ScholiaCrawler')) {
            continue;
        }
        try {
            if (!conversationId)
                throw new Error(`conversationId is null before calling crawlPage!`);
            const result = await crawlPage(normalizedUrl, source, conversationId);
            if (!result) {
                visited.add(normalizedUrl);
                continue;
            }
            const { page, html } = result;
            visited.add(normalizedUrl);
            if (!sourceTitleUpdated && page.title) {
                const label = page.title.trim().substring(0, 100);
                if (label) {
                    try {
                        const { error } = await supabase
                            .from('sources')
                            .update({ source_label: label })
                            .eq('id', source.id);
                        if (!error) {
                            source.source_label = label;
                        }
                        sourceTitleUpdated = true;
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
            const isDynamic = source.crawl_depth === 'dynamic';
            const links = extractLinks(html, normalizedUrl, source);
            const linksWithContext = isDynamic ? extractLinksWithContext(html, normalizedUrl, source) : [];
            const edgesToInsert = [];
            const linksToProcess = isDynamic ? links.slice(0, MAX_LINKS_PER_PAGE_DYNAMIC) : links;
            for (const link of linksToProcess) {
                edgesToInsert.push({
                    from_page_id: page.id,
                    to_url: link,
                    owner_id: source.owner_id,
                });
                if (!discovered.has(link) && !visited.has(link)) {
                    discovered.add(link);
                    queue.push(link);
                }
            }
            if (edgesToInsert.length > 0) {
                const batchSize = 50;
                for (let i = 0; i < edgesToInsert.length; i += batchSize) {
                    const chunk = edgesToInsert.slice(i, i + batchSize);
                    const { error: edgeErr } = await supabase
                        .from('page_edges')
                        .upsert(chunk, { onConflict: 'from_page_id,to_url', ignoreDuplicates: true });
                    if (edgeErr) {
                        console.error('crawl: edge insert failed', edgeErr.message);
                    }
                    if (i + batchSize < edgesToInsert.length) {
                        await new Promise((resolve) => setTimeout(resolve, 10));
                    }
                }
            }
            if (isDynamic && linksWithContext.length > 0 && edgesToInsert.length > 0) {
                const toEncode = linksWithContext.filter((l) => l.snippet.length > 0).slice(0, 500);
                if (toEncode.length > 0) {
                    const urls = toEncode.map((l) => l.url);
                    const { data: edgeRows } = await supabase
                        .from('page_edges')
                        .select('id, to_url')
                        .eq('from_page_id', page.id)
                        .in('to_url', urls);
                    const urlToEdgeId = new Map((edgeRows ?? []).map((r) => [r.to_url, r.id]));
                    const encodedToInsert = toEncode
                        .filter((l) => urlToEdgeId.has(l.url))
                        .map((l) => ({
                        page_edge_id: urlToEdgeId.get(l.url),
                        anchor_text: l.anchorText || null,
                        snippet: l.snippet.substring(0, 500),
                        owner_id: source.owner_id,
                    }));
                    if (encodedToInsert.length > 0) {
                        const { error: encError } = await supabase.from('encoded_discovered').upsert(encodedToInsert, {
                            onConflict: 'page_edge_id',
                            ignoreDuplicates: true,
                        });
                        if (encError) {
                            console.warn('crawl: encoded_discovered insert failed', encError.message);
                        }
                    }
                }
            }
            await supabase
                .from('crawl_jobs')
                .update({
                discovered_count: discovered.size,
                indexed_count: visited.size,
                last_activity_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
                .eq('id', job.id);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('was deleted'))
                throw error;
            console.error('crawl: error on page', url.slice(0, 50), error);
            visited.add(normalizedUrl);
        }
    }
    console.log('crawl: indexing', discovered.size, 'discovered,', visited.size, 'pages');
    const indexingUpdate = { status: 'indexing', updated_at: new Date().toISOString() };
    if (source.crawl_depth === 'dynamic') {
        const { data: pages } = await supabase.from('pages').select('id').eq('source_id', source.id);
        const pageIds = (pages ?? []).map((p) => p.id);
        if (pageIds.length > 0) {
            const { data: edges } = await supabase.from('page_edges').select('id').in('from_page_id', pageIds);
            const edgeIds = (edges ?? []).map((e) => e.id);
            if (edgeIds.length > 0) {
                const { count } = await supabase
                    .from('encoded_discovered')
                    .select('*', { count: 'exact', head: true })
                    .in('page_edge_id', edgeIds)
                    .is('embedding', null);
                if (count != null && count > 0) {
                    indexingUpdate.encoding_discovered_total = count;
                    indexingUpdate.encoding_discovered_done = 0;
                }
            }
        }
    }
    await supabase.from('crawl_jobs').update(indexingUpdate).eq('id', job.id);
    try {
        await indexSourceForRag(source.id, job.id, conversationId);
    }
    catch (err) {
        console.warn('crawl: RAG indexing failed', err);
    }
    await supabase
        .from('crawl_jobs')
        .update({
        total_pages: visited.size,
        discovered_count: discovered.size,
        indexed_count: visited.size,
        status: 'completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    })
        .eq('id', job.id);
    console.log('crawl: done', sourceShort, visited.size, 'pages', queue.length === 0 ? '(queue empty)' : '(hit max)');
    const { data: insertedPages, error: verifyError } = await supabase
        .from('pages')
        .select('id, url')
        .eq('source_id', source.id)
        .limit(5);
    if (verifyError) {
        console.error('crawl: verify failed', verifyError);
    }
    else if (visited.size > 0 && (!insertedPages || insertedPages.length === 0)) {
        console.error('crawl: no pages in DB after crawl');
    }
}
//# sourceMappingURL=crawlSource.js.map