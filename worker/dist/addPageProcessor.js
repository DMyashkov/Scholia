/**
 * Process add-page crawl jobs: fetch URL, insert page, edges, discovered_links, chunk+embed for RAG.
 * Add-page jobs are crawl_jobs with explicit_crawl_urls = [url]. Updates crawl_jobs for progress.
 */
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from './db';
import { indexSinglePageForRag, embedDiscoveredLinksForPage } from './indexer';
import { extractLinksWithContext } from './crawler';
function normalizeUrl(input) {
    let s = (input || '').trim();
    const hashIdx = s.indexOf('#');
    if (hashIdx >= 0)
        s = s.slice(0, hashIdx);
    const qIdx = s.indexOf('?');
    if (qIdx >= 0)
        s = s.slice(0, qIdx);
    s = s.trim();
    s = s.replace(/^(https?:\/\/)+/i, '');
    s = 'https://' + s;
    try {
        const u = new URL(s);
        u.hash = '';
        u.search = '';
        if (u.pathname.endsWith('/') && u.pathname !== '/')
            u.pathname = u.pathname.slice(0, -1);
        return u.toString();
    }
    catch {
        return s;
    }
}
async function updateCrawlJob(jobId, updates) {
    await supabase
        .from('crawl_jobs')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', jobId);
}
export async function processAddPageJob(job) {
    const { id: jobId, source_id: sourceId, explicit_crawl_urls } = job;
    const url = explicit_crawl_urls[0];
    if (!url) {
        await updateCrawlJob(jobId, { status: 'failed', error_message: 'No URL in explicit_crawl_urls' });
        return;
    }
    const normalizedUrl = normalizeUrl(url);
    console.log('[add-page] process start', { jobId: jobId.slice(0, 8), url: normalizedUrl.slice(0, 50) });
    try {
        await updateCrawlJob(jobId, { status: 'indexing' });
        // Check if page already exists
        const { data: existing } = await supabase
            .from('pages')
            .select('id')
            .eq('source_id', sourceId)
            .eq('url', normalizedUrl)
            .maybeSingle();
        if (existing) {
            console.log('[add-page] page already exists', existing.id);
            await updateCrawlJob(jobId, { status: 'completed' });
            return;
        }
        // Fetch page
        const res = await fetch(normalizedUrl, {
            headers: { 'User-Agent': 'ScholiaCrawler/1.0' },
        });
        if (!res.ok) {
            await updateCrawlJob(jobId, {
                status: 'failed',
                error_message: `Failed to fetch: HTTP ${res.status}`,
            });
            throw new Error(`Failed to fetch: HTTP ${res.status}`);
        }
        const html = await res.text();
        const $ = cheerio.load(html);
        const title = $('title').first().text().trim() || $('h1').first().text().trim() || 'Untitled';
        const content = $('main, article, .content, #content, #bodyContent, .mw-parser-output')
            .first()
            .text()
            .trim()
            .substring(0, 50000) ||
            $('body').text().trim().substring(0, 50000);
        const urlObj = new URL(normalizedUrl);
        const path = urlObj.pathname + urlObj.search;
        // Get source
        const { data: source, error: srcErr } = await supabase
            .from('sources')
            .select('owner_id, same_domain_only, conversation_id')
            .eq('id', sourceId)
            .single();
        if (srcErr || !source) {
            await updateCrawlJob(jobId, { status: 'failed', error_message: 'Source not found' });
            throw new Error('Source not found');
        }
        const ownerId = source.owner_id;
        // Insert page
        const { data: newPage, error: insertErr } = await supabase
            .from('pages')
            .insert({
            source_id: sourceId,
            url: normalizedUrl,
            title,
            path,
            content,
            status: 'indexed',
            owner_id: ownerId,
        })
            .select()
            .single();
        if (insertErr) {
            await updateCrawlJob(jobId, { status: 'failed', error_message: insertErr.message });
            throw new Error(insertErr.message);
        }
        // Create edges from existing pages to the new page
        const { data: seedPages } = await supabase
            .from('pages')
            .select('id, url')
            .eq('source_id', sourceId)
            .neq('id', newPage.id)
            .limit(10);
        if (seedPages?.length) {
            const edges = seedPages.map((p) => ({
                from_page_id: p.id,
                to_url: normalizedUrl,
                owner_id: ownerId,
            }));
            await supabase.from('page_edges').upsert(edges, {
                onConflict: 'from_page_id,to_url',
                ignoreDuplicates: true,
            });
        }
        // Insert page_edges for new page's outbound links, then encoded_discovered
        const sourceForExtract = {
            same_domain_only: source.same_domain_only ?? true,
        };
        const linksWithContext = extractLinksWithContext(html, normalizedUrl, sourceForExtract);
        console.log('[add-page] extractLinksWithContext', {
            linksCount: linksWithContext.length,
            sameDomainOnly: sourceForExtract.same_domain_only,
            sampleUrls: linksWithContext.slice(0, 3).map((l) => l.url.slice(0, 60)),
        });
        const { data: sourcePageEdges } = await supabase
            .from('page_edges')
            .select('to_url')
            .eq('from_page_id', newPage.id);
        const existingUrls = new Set((sourcePageEdges ?? []).map((r) => r.to_url));
        const newLinks = linksWithContext.filter((l) => !existingUrls.has(l.url));
        console.log('[add-page] newLinks after dedup', { newLinksCount: newLinks.length, existingCount: existingUrls.size });
        if (newLinks.length > 0) {
            const edgeRows = newLinks.slice(0, 500).map((l) => ({
                from_page_id: newPage.id,
                to_url: l.url,
                owner_id: ownerId,
            }));
            const { error: edgeErr } = await supabase.from('page_edges').upsert(edgeRows, {
                onConflict: 'from_page_id,to_url',
                ignoreDuplicates: true,
            });
            console.log('[add-page] page_edges upsert', { rowCount: edgeRows.length, error: edgeErr?.message ?? null });
            const { data: edgeIds } = await supabase
                .from('page_edges')
                .select('id, to_url')
                .eq('from_page_id', newPage.id)
                .in('to_url', newLinks.slice(0, 500).map((l) => l.url));
            const urlToEdgeId = new Map((edgeIds ?? []).map((r) => [r.to_url, r.id]));
            const encodedRows = newLinks
                .slice(0, 500)
                .filter((l) => urlToEdgeId.has(l.url))
                .map((l) => ({
                page_edge_id: urlToEdgeId.get(l.url),
                anchor_text: l.anchorText || null,
                snippet: (l.snippet || l.anchorText || 'Link from page').substring(0, 500),
                owner_id: ownerId,
            }));
            if (encodedRows.length > 0) {
                const { error: encErr } = await supabase.from('encoded_discovered').upsert(encodedRows, {
                    onConflict: 'page_edge_id',
                    ignoreDuplicates: true,
                });
                console.log('[add-page] encoded_discovered upsert', {
                    rowCount: encodedRows.length,
                    urlToEdgeIdSize: urlToEdgeId.size,
                    error: encErr?.message ?? null,
                });
            }
            else {
                console.log('[add-page] encoded_discovered skip: encodedRows.length=0', {
                    newLinksCount: newLinks.length,
                    urlToEdgeIdSize: urlToEdgeId.size,
                    reason: 'urlToEdgeId missing some URLs?',
                });
            }
        }
        else {
            console.log('[add-page] no newLinks to insert', { linksWithContextCount: linksWithContext.length });
        }
        // Chunk and embed page content
        await indexSinglePageForRag(newPage.id, content, ownerId, jobId);
        // Embed encoded_discovered for this page
        const apiKey = process.env.OPENAI_API_KEY;
        const conversationId = source.conversation_id;
        if (!apiKey) {
            console.log('[add-page] SKIP embedDiscoveredLinksForPage: OPENAI_API_KEY not set');
        }
        else if (!conversationId) {
            console.log('[add-page] SKIP embedDiscoveredLinksForPage: source.conversation_id is null/undefined');
        }
        else {
            console.log('[add-page] calling embedDiscoveredLinksForPage', { conversationId: conversationId.slice(0, 8), newPageId: newPage.id?.slice(0, 8) });
            await embedDiscoveredLinksForPage(conversationId, newPage.id, apiKey, jobId, ownerId);
        }
        // Clear embeddings for links pointing to the newly added page - we'll never suggest it again
        const { data: edgesToNewPage } = await supabase.from('page_edges').select('id').eq('to_url', normalizedUrl);
        const edgeIdsToClear = (edgesToNewPage ?? []).map((r) => r.id);
        if (edgeIdsToClear.length > 0) {
            const { error: clearErr } = await supabase.from('encoded_discovered').update({ embedding: null }).in('page_edge_id', edgeIdsToClear);
            console.log('[add-page] cleared embeddings for links→newPage', { edgeCount: edgeIdsToClear.length, error: clearErr?.message ?? null });
        }
        await updateCrawlJob(jobId, { status: 'completed' });
        console.log('[add-page] success', newPage.id?.slice(0, 8));
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[add-page] error', msg);
        await updateCrawlJob(jobId, { status: 'failed', error_message: msg });
        throw err;
    }
}
//# sourceMappingURL=addPageProcessor.js.map