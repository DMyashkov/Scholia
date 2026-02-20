import fetch from 'node-fetch';
import RobotsParser from 'robots-parser';
import { supabase } from '../db';
import { indexConversationForRag } from '../indexer';
import { MAX_PAGES, PAGE_TITLE_SUFFIX_REGEX } from './constants';
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
            console.error(`❌ Failed to find conversation for source ${source.id}:`, srcError);
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
        console.error(`❌ Conversation ${conversationId} does not exist! Error:`, convCheckError);
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
    const queue = seedUrls.map((url) => ({
        url,
        depth: 0,
        priority: 0,
    }));
    seedUrls.forEach((u) => discovered.add(u));
    const directLinksFromStart = [];
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
    catch {
        // Ignore
    }
    if (queue.length === 0) {
        console.error(`❌ CRITICAL: Queue is empty before starting crawl!`);
        return;
    }
    const sourceShort = new URL(firstSeedUrl).pathname?.replace(/^\/wiki\//, '') || firstSeedUrl.slice(0, 40);
    console.log(`[crawl] START source=${sourceShort} seeds=${seedUrls.length} url=${firstSeedUrl} maxPages=${maxPages} depth=${source.crawl_depth} jobId=${job.id?.slice(0, 8)}`);
    let loopIterations = 0;
    while (queue.length > 0 && visited.size < maxPages) {
        loopIterations++;
        if (loopIterations === 1 && queue.length === 0)
            break;
        queue.sort((a, b) => a.priority - b.priority);
        const { url, depth, priority } = queue.shift();
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
        if (visited.has(normalizedUrl))
            continue;
        if (depth > 2)
            continue;
        if (robotsParser && !robotsParser.isAllowed(normalizedUrl, 'ScholiaCrawler')) {
            continue;
        }
        try {
            if (!conversationId)
                throw new Error(`conversationId is null before calling crawlPage!`);
            console.log(`[D/I] crawlPage START url=${normalizedUrl.slice(0, 60)} depth=${depth} isSeed=${depth === 0} conv=${conversationId?.slice(0, 8)}`);
            const result = await crawlPage(normalizedUrl, source, job, conversationId);
            if (!result) {
                console.error(`[D/I] crawlPage FAILED - page insert/fetch failed`);
                visited.add(normalizedUrl);
                continue;
            }
            const { page, html } = result;
            visited.add(normalizedUrl);
            console.log(`[D/I] crawlPage OK pageId=${page?.id?.slice(0, 8)} visited=${visited.size}`);
            if (!sourceTitleUpdated && page.title) {
                const pageTitle = page.title.replace(PAGE_TITLE_SUFFIX_REGEX, '').trim();
                if (pageTitle && pageTitle.length > 0) {
                    try {
                        const { error } = await supabase
                            .from('sources')
                            .update({ source_label: pageTitle.substring(0, 100) })
                            .eq('id', source.id);
                        if (!error) {
                            source.source_label = pageTitle.substring(0, 100);
                        }
                        sourceTitleUpdated = true;
                    }
                    catch {
                        // Non-blocking
                    }
                }
            }
            const isDynamic = source.crawl_depth === 'dynamic';
            const links = extractLinks(html, normalizedUrl, source);
            const linksWithContext = isDynamic ? extractLinksWithContext(html, normalizedUrl, source) : [];
            const newLinks = [];
            const edgesToInsert = [];
            const linksToProcess = links.slice(0, 200);
            for (const link of linksToProcess) {
                const linkUrlObj = new URL(link);
                linkUrlObj.hash = '';
                linkUrlObj.search = '';
                if (linkUrlObj.pathname === '/' || linkUrlObj.pathname === '') {
                    linkUrlObj.pathname = '/';
                }
                else if (linkUrlObj.pathname.endsWith('/')) {
                    linkUrlObj.pathname = linkUrlObj.pathname.slice(0, -1);
                }
                const normalizedLink = linkUrlObj.toString();
                edgesToInsert.push({
                    from_page_id: page.id,
                    to_url: normalizedLink,
                    owner_id: source.owner_id,
                });
                if (!discovered.has(normalizedLink)) {
                    discovered.add(normalizedLink);
                    newLinks.push(normalizedLink);
                    if (priority === 0 && depth === 0) {
                        directLinksFromStart.push(normalizedLink);
                    }
                    if (depth >= 2)
                        continue;
                    const linkPriority = priority === 0 ? 1 : priority + 1;
                    const queueHasSameOrHigherPriority = queue.some((q) => q.priority <= linkPriority - 1);
                    if (priority === 0 && depth === 0) {
                        queue.push({ url: normalizedLink, depth: depth + 1, priority: linkPriority });
                    }
                    else if (!queueHasSameOrHigherPriority && visited.size + queue.length < maxPages) {
                        queue.push({ url: normalizedLink, depth: depth + 1, priority: linkPriority });
                    }
                }
            }
            console.log(`[crawl] page ${visited.size}/${maxPages} depth=${depth} links=${links.length} newToQueue=${newLinks.length} queue=${queue.length}`);
            if (edgesToInsert.length > 0) {
                try {
                    const batchSize = 50;
                    for (let i = 0; i < edgesToInsert.length; i += batchSize) {
                        const chunk = edgesToInsert.slice(i, i + batchSize);
                        try {
                            await supabase.from('page_edges').insert(chunk);
                        }
                        catch {
                            // Log but don't block
                        }
                        if (i + batchSize < edgesToInsert.length) {
                            await new Promise((resolve) => setTimeout(resolve, 10));
                        }
                    }
                }
                catch (edgeError) {
                    const err = edgeError;
                    console.error(`[crawl] EDGE INSERT ERROR`, err?.message || edgeError);
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
                            console.warn('[crawl] encoded_discovered insert error:', encError.message);
                        }
                        else {
                            console.log(`[D/I] encoded_discovered inserted=${encodedToInsert.length}`);
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
            console.error(`❌ Error crawling ${url}:`, error);
            visited.add(normalizedUrl);
        }
    }
    console.log(`[D/I] Transitioning to indexing: discovered=${discovered.size} indexed=${visited.size} jobId=${job.id?.slice(0, 8)}`);
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
        await indexConversationForRag(conversationId, job.id);
    }
    catch (_indexErr) {
        console.warn('[crawl] RAG indexing failed:', _indexErr);
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
    const exitReason = queue.length === 0 ? 'queue empty' : `visited >= maxPages (${visited.size} >= ${maxPages})`;
    console.log(`[crawl] END source=${sourceShort} visited=${visited.size} exit=${exitReason} iterations=${loopIterations}`);
    console.log(`[D/I] FINAL discovered=${discovered.size} indexed=${visited.size} (this is what job will have after final update)`);
    if (loopIterations === 0) {
        console.error(`❌ CRITICAL: Crawl loop never ran! Loop iterations = 0`);
        console.error(`❌ Queue length: ${queue.length}, visited.size: ${visited.size}, maxPages: ${maxPages}`);
    }
    if (visited.size === 0 && loopIterations > 0) {
        console.error(`❌ CRITICAL: Loop ran ${loopIterations} times but visited.size is still 0!`);
    }
    const { data: insertedPages, error: verifyError } = await supabase
        .from('pages')
        .select('id, url')
        .eq('source_id', source.id)
        .limit(5);
    if (verifyError) {
        console.error(`❌ Error verifying pages:`, verifyError);
    }
    else if (!insertedPages || insertedPages.length === 0) {
        console.error(`❌ CRITICAL: No pages found in DB even though visited.size=${visited.size}!`);
    }
}
//# sourceMappingURL=crawlSource.js.map