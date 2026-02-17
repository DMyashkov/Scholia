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
                from_url: p.url,
                to_url: normalizedUrl,
                owner_id: ownerId,
            }));
            await supabase.from('page_edges').upsert(edges, {
                onConflict: 'from_page_id,to_url',
                ignoreDuplicates: true,
            });
        }
        // Insert discovered_links
        const sourceForExtract = {
            same_domain_only: source.same_domain_only ?? true,
        };
        const linksWithContext = extractLinksWithContext(html, normalizedUrl, sourceForExtract);
        const { data: sourcePages } = await supabase.from('pages').select('id').eq('source_id', sourceId);
        const pageIds = (sourcePages ?? []).map((p) => p.id);
        const { data: existingRows } = pageIds.length > 0
            ? await supabase
                .from('discovered_links')
                .select('to_url')
                .in('from_page_id', pageIds)
            : { data: [] };
        const existingUrls = new Set((existingRows ?? []).map((r) => r.to_url));
        const newLinks = linksWithContext.filter((l) => !existingUrls.has(l.url));
        if (newLinks.length > 0) {
            const toInsert = newLinks.slice(0, 500).map((l) => ({
                from_page_id: newPage.id,
                to_url: l.url,
                anchor_text: l.anchorText || null,
                context_snippet: l.contextSnippet.substring(0, 500),
                owner_id: ownerId,
            }));
            await supabase.from('discovered_links').upsert(toInsert, {
                onConflict: 'from_page_id,to_url',
                ignoreDuplicates: true,
            });
        }
        // Chunk and embed page content
        await indexSinglePageForRag(newPage.id, content, ownerId, jobId);
        // Embed discovered_links for this page
        const apiKey = process.env.OPENAI_API_KEY;
        const conversationId = source.conversation_id;
        if (apiKey && conversationId) {
            await embedDiscoveredLinksForPage(conversationId, newPage.id, apiKey, jobId);
        }
        // Clear embeddings for links pointing to the newly added page - we'll never suggest it again
        await supabase
            .from('discovered_links')
            .update({ embedding: null })
            .eq('from_page_id', newPage.id)
            .eq('to_url', normalizedUrl);
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