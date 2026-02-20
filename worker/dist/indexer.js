/**
 * RAG indexer: chunk page content and embed via OpenAI, then insert into chunks.
 * Called once per conversation after a crawl completes (bulk).
 */
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { supabase } from './db';
import { fetchTargetPageLead } from './targetLead';
// Align with supabase/functions/add-page: same chunk params and progress batch sizes
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_MAX_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 100;
const EMBED_BATCH_SIZE = 10;
const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_MAX_CHARS,
    chunkOverlap: CHUNK_OVERLAP_CHARS,
});
const DISCOVERED_PROGRESS_INTERVAL_MS = 1200;
const DEFAULT_LINK_SNIPPET = 'Link from page';
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
/** Embed a batch of texts and insert chunk rows; returns number inserted. Stops on first error. */
async function embedAndInsertChunks(chunkSpecs, apiKey, options) {
    let inserted = 0;
    for (let i = 0; i < chunkSpecs.length; i += EMBED_BATCH_SIZE) {
        const batchSpecs = chunkSpecs.slice(i, i + EMBED_BATCH_SIZE);
        const texts = batchSpecs.map((c) => c.content);
        const embeddings = await embedBatch(apiKey, texts);
        if (embeddings.length !== batchSpecs.length) {
            console.error('[indexer] Embedding count mismatch in batch');
            break;
        }
        const rows = batchSpecs.map((c, j) => ({
            page_id: c.page_id,
            content: c.content,
            start_index: c.start_index,
            end_index: c.end_index,
            embedding: embeddings[j],
            owner_id: c.owner_id,
        }));
        const { error } = await supabase.from('chunks').insert(rows);
        if (error) {
            console.error('[indexer] Chunk insert error:', error.message);
            break;
        }
        inserted += rows.length;
        await options.onProgress?.(inserted);
    }
    return inserted;
}
/** Shared: update crawl_jobs, embed chunks, optionally embed discovered links. */
async function indexChunkSpecsForRag(chunkSpecs, apiKey, options) {
    if (chunkSpecs.length === 0)
        return { chunksCreated: 0 };
    const { crawlJobId, conversationId, addPageStyle, pageCount, logLabel } = options;
    const totalChunks = chunkSpecs.length;
    if (crawlJobId) {
        await supabase
            .from('crawl_jobs')
            .update(addPageStyle
            ? {
                encoding_chunks_total: totalChunks,
                encoding_chunks_done: 0,
                status: 'encoding',
                updated_at: new Date().toISOString(),
            }
            : { encoding_chunks_total: totalChunks, encoding_chunks_done: 0 })
            .eq('id', crawlJobId);
    }
    console.log('[indexer] Indexing', totalChunks, 'chunks from', pageCount, 'pages', logLabel ?? '');
    const inserted = await embedAndInsertChunks(chunkSpecs, apiKey, {
        onProgress: crawlJobId
            ? async (done) => {
                await supabase
                    .from('crawl_jobs')
                    .update({
                    encoding_chunks_done: done,
                    ...(addPageStyle ? { updated_at: new Date().toISOString() } : { last_activity_at: new Date().toISOString() }),
                })
                    .eq('id', crawlJobId);
            }
            : undefined,
    });
    let discoveredEmbedded = 0;
    if (conversationId) {
        discoveredEmbedded = await embedDiscoveredLinks(conversationId, apiKey, crawlJobId);
    }
    return { chunksCreated: inserted + discoveredEmbedded };
}
async function buildChunkSpecsFromPages(pages) {
    const chunkSpecs = [];
    for (const page of pages) {
        const text = (page.content || '').trim();
        if (!text)
            continue;
        const pageChunks = await textSplitter.splitText(text);
        for (const content of pageChunks) {
            chunkSpecs.push({
                page_id: page.id,
                content,
                start_index: null,
                end_index: null,
                owner_id: page.owner_id,
            });
        }
    }
    return chunkSpecs;
}
async function buildChunkSpecsFromSinglePage(pageId, content, ownerId) {
    const text = (content || '').trim();
    if (!text)
        return [];
    const pageChunks = await textSplitter.splitText(text);
    return pageChunks.map((c) => ({
        page_id: pageId,
        content: c,
        start_index: null,
        end_index: null,
        owner_id: ownerId,
    }));
}
/** Index one source's pages for RAG (used after a source crawl). Optionally run discovered-link embedding for the conversation. */
export async function indexSourceForRag(sourceId, crawlJobId, conversationId) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ OPENAI_API_KEY not set; skipping RAG indexing');
        return { chunksCreated: 0 };
    }
    const { data: pages, error: pagesError } = await supabase
        .from('pages')
        .select('id, content, owner_id')
        .eq('source_id', sourceId)
        .eq('status', 'indexed')
        .not('content', 'is', null);
    if (pagesError) {
        console.error('[indexer] Failed to fetch pages:', pagesError.message);
        return { chunksCreated: 0 };
    }
    if (!pages?.length)
        return { chunksCreated: 0 };
    const chunkSpecs = await buildChunkSpecsFromPages(pages);
    return indexChunkSpecsForRag(chunkSpecs, apiKey, {
        crawlJobId,
        conversationId,
        pageCount: pages.length,
        logLabel: `(source ${sourceId.slice(0, 8)})`,
    });
}
/** Index all sources in a conversation (e.g. full re-index). Prefer indexSourceForRag after a single-source crawl. */
export async function indexConversationForRag(conversationId, crawlJobId) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ OPENAI_API_KEY not set; skipping RAG indexing');
        return { chunksCreated: 0 };
    }
    const { data: sources } = await supabase
        .from('sources')
        .select('id')
        .eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0)
        return { chunksCreated: 0 };
    const { data: pages, error: pagesError } = await supabase
        .from('pages')
        .select('id, content, owner_id')
        .in('source_id', sourceIds)
        .eq('status', 'indexed')
        .not('content', 'is', null);
    if (pagesError) {
        console.error('[indexer] Failed to fetch pages:', pagesError.message);
        return { chunksCreated: 0 };
    }
    if (!pages?.length)
        return { chunksCreated: 0 };
    const chunkSpecs = await buildChunkSpecsFromPages(pages);
    return indexChunkSpecsForRag(chunkSpecs, apiKey, {
        crawlJobId,
        conversationId,
        pageCount: pages.length,
        logLabel: '(conversation)',
    });
}
/** Index a single page for RAG and report progress to crawl_jobs (add-page flow) */
export async function indexSinglePageForRag(pageId, content, ownerId, crawlJobId) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ OPENAI_API_KEY not set; skipping RAG indexing');
        return { chunksCreated: 0 };
    }
    const chunkSpecs = await buildChunkSpecsFromSinglePage(pageId, content, ownerId);
    return indexChunkSpecsForRag(chunkSpecs, apiKey, {
        crawlJobId,
        addPageStyle: true,
        pageCount: 1,
    });
}
/** Embed encoded_discovered for a single page (add-page flow) and report progress to crawl_jobs.
 * Skips links pointing to already-indexed pages - we never suggest those.
 * In dive mode: fetches each target page, gets lead, then embeds (progress = fetch+encode per link). */
export async function embedDiscoveredLinksForPage(conversationId, pageId, apiKey, crawlJobId, ownerId) {
    console.log('[indexer] embedDiscoveredLinksForPage ENTRY', { pageId: pageId.slice(0, 8), crawlJobId: crawlJobId.slice(0, 8) });
    const indexedUrls = await getIndexedPageUrlsForPage(pageId);
    console.log('[indexer] embedDiscoveredLinksForPage indexedUrls', { count: indexedUrls.size, sample: [...indexedUrls].slice(0, 3) });
    const { data: edgeRows } = await supabase
        .from('page_edges')
        .select('id, to_url')
        .eq('from_page_id', pageId);
    const edgeIds = (edgeRows ?? []).map((r) => r.id);
    if (edgeIds.length === 0) {
        console.log('[indexer] embedDiscoveredLinksForPage EARLY_RETURN: edgeIds.length=0', { reason: 'no page_edges for this page' });
        return 0;
    }
    console.log('[indexer] embedDiscoveredLinksForPage page_edges', { edgeCount: edgeIds.length });
    const { data: links, error: fetchError } = await supabase
        .from('encoded_discovered')
        .select('id, snippet, page_edge_id')
        .in('page_edge_id', edgeIds)
        .is('embedding', null);
    if (fetchError) {
        console.log('[indexer] embedDiscoveredLinksForPage EARLY_RETURN: fetchError', { error: fetchError.message });
        return 0;
    }
    if (!links?.length) {
        console.log('[indexer] embedDiscoveredLinksForPage EARLY_RETURN: links.length=0', {
            reason: 'no encoded_discovered with null embedding for these edges (may already be embedded)',
        });
        return 0;
    }
    console.log('[indexer] embedDiscoveredLinksForPage encoded_discovered (null embedding)', { linksCount: links.length });
    const edgeIdToUrl = new Map((edgeRows ?? []).map((r) => [r.id, r.to_url]));
    const toEmbed = links.filter((l) => {
        const url = edgeIdToUrl.get(l.page_edge_id) || '';
        return !indexedUrls.has(normalizeUrlForCompare(url));
    });
    const total = toEmbed.length;
    if (crawlJobId && total > 0) {
        await supabase
            .from('crawl_jobs')
            .update({
            encoding_discovered_total: total,
            encoding_discovered_done: 0,
            updated_at: new Date().toISOString(),
        })
            .eq('id', crawlJobId);
    }
    if (toEmbed.length === 0) {
        console.log('[indexer] embedDiscoveredLinksForPage EARLY_RETURN: toEmbed.length=0', {
            linksLength: links.length,
            total,
            reason: 'all links point to already-indexed pages',
        });
        return 0;
    }
    const { data: pageRow } = await supabase.from('pages').select('source_id').eq('id', pageId).single();
    const sourceId = pageRow?.source_id;
    const { data: sourceRow } = sourceId
        ? await supabase.from('sources').select('suggestion_mode').eq('id', sourceId).single()
        : { data: null };
    const useDive = sourceRow?.suggestion_mode === 'dive';
    if (useDive)
        console.log('[indexer] embedDiscoveredLinksForPage mode=dive: fetch+encode per link');
    const BATCH_SIZE = useDive ? 1 : EMBED_BATCH_SIZE;
    let updated = 0;
    let lastProgressUpdate = Date.now();
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
        const batch = toEmbed.slice(i, i + BATCH_SIZE);
        const texts = [];
        for (const item of batch) {
            let text = item.snippet;
            if (useDive) {
                const url = edgeIdToUrl.get(item.page_edge_id) || '';
                const lead = await fetchTargetPageLead(url);
                if (lead) {
                    text = lead;
                    await supabase
                        .from('encoded_discovered')
                        .update({ snippet: text })
                        .eq('id', item.id);
                    console.log('[indexer] dive', `[${updated + 1}/${toEmbed.length}]`, url.slice(0, 50) + '...', '→', lead.slice(0, 60) + (lead.length > 60 ? '...' : ''));
                }
            }
            texts.push(text || DEFAULT_LINK_SNIPPET);
        }
        const embeddings = await embedBatch(apiKey, texts);
        if (embeddings.length !== batch.length)
            break;
        for (let j = 0; j < batch.length; j++) {
            const { error } = await supabase
                .from('encoded_discovered')
                .update({ embedding: embeddings[j] })
                .eq('id', batch[j].id);
            if (!error)
                updated++;
        }
        const now = Date.now();
        await supabase
            .from('crawl_jobs')
            .update({
            encoding_discovered_done: updated,
            updated_at: new Date().toISOString(),
        })
            .eq('id', crawlJobId);
        if (now - lastProgressUpdate >= DISCOVERED_PROGRESS_INTERVAL_MS)
            lastProgressUpdate = now;
    }
    if (updated > 0) {
        await supabase
            .from('crawl_jobs')
            .update({
            encoding_discovered_done: updated,
            updated_at: new Date().toISOString(),
        })
            .eq('id', crawlJobId);
        const skipped = links.length - toEmbed.length;
        console.log('[indexer] embedDiscoveredLinksForPage SUCCESS', {
            updated,
            total: toEmbed.length,
            skipped,
        });
    }
    else {
        console.log('[indexer] embedDiscoveredLinksForPage WARN: updated=0', {
            toEmbedLength: toEmbed.length,
            reason: 'all UPDATEs to encoded_discovered failed (check RLS?)',
        });
    }
    return updated;
}
/** Normalize URL for comparison (strip hash, query, lowercase) */
function normalizeUrlForCompare(url) {
    try {
        const u = new URL(url.startsWith('http') ? url : `https://${url}`);
        u.hash = '';
        u.search = '';
        let path = u.pathname;
        if (path !== '/' && path.endsWith('/'))
            path = path.slice(0, -1);
        return (u.origin + path).toLowerCase();
    }
    catch {
        return url.toLowerCase();
    }
}
/** Fetch indexed page URLs for a page's source - we never suggest already-indexed pages */
async function getIndexedPageUrlsForPage(pageId) {
    const { data: page } = await supabase.from('pages').select('source_id').eq('id', pageId).single();
    const sourceId = page?.source_id;
    if (!sourceId)
        return new Set();
    const { data: pages, error } = await supabase
        .from('pages')
        .select('url')
        .eq('source_id', sourceId)
        .eq('status', 'indexed');
    if (error || !pages?.length)
        return new Set();
    return new Set(pages.map((p) => normalizeUrlForCompare(p.url || '')));
}
/** Fetch indexed page URLs for a conversation's sources - we never suggest already-indexed pages */
async function getIndexedPageUrls(conversationId) {
    const { data: sources } = await supabase
        .from('sources')
        .select('id')
        .eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    if (sourceIds.length === 0)
        return new Set();
    const { data: pages, error } = await supabase
        .from('pages')
        .select('url')
        .in('source_id', sourceIds)
        .eq('status', 'indexed');
    if (error || !pages?.length)
        return new Set();
    return new Set(pages.map((p) => normalizeUrlForCompare(p.url || '')));
}
async function embedDiscoveredLinks(conversationId, apiKey, crawlJobId) {
    const indexedUrls = await getIndexedPageUrls(conversationId);
    const { data: sources } = await supabase
        .from('sources')
        .select('id, suggestion_mode')
        .eq('conversation_id', conversationId);
    const sourceIds = (sources ?? []).map((s) => s.id);
    const sourceModeMap = new Map((sources ?? []).map((s) => [s.id, s.suggestion_mode]));
    if (sourceIds.length === 0)
        return 0;
    const { data: pages } = await supabase
        .from('pages')
        .select('id')
        .in('source_id', sourceIds);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length === 0)
        return 0;
    const { data: edgeRows } = await supabase
        .from('page_edges')
        .select('id, to_url, from_page_id')
        .in('from_page_id', pageIds);
    const edgeIds = (edgeRows ?? []).map((r) => r.id);
    if (edgeIds.length === 0)
        return 0;
    const { data: links, error: fetchError } = await supabase
        .from('encoded_discovered')
        .select('id, snippet, page_edge_id, owner_id')
        .in('page_edge_id', edgeIds)
        .is('embedding', null);
    if (fetchError || !links?.length)
        return 0;
    const edgeIdToUrl = new Map((edgeRows ?? []).map((r) => [r.id, r.to_url]));
    const fromPageIds = [...new Set((edgeRows ?? []).map((r) => r.from_page_id).filter(Boolean))];
    const { data: pagesWithSource } = await supabase
        .from('pages')
        .select('id, source_id')
        .in('id', fromPageIds);
    const pageToSource = new Map((pagesWithSource ?? []).map((p) => [p.id, p.source_id]));
    const edgeIdToUseDive = new Map();
    for (const r of edgeRows ?? []) {
        const fromPageId = r.from_page_id;
        const sourceId = fromPageId ? pageToSource.get(fromPageId) : undefined;
        const mode = sourceId ? sourceModeMap.get(sourceId) : undefined;
        edgeIdToUseDive.set(r.id, mode === 'dive');
    }
    const toEmbed = links.filter((l) => {
        const url = edgeIdToUrl.get(l.page_edge_id) || '';
        return !indexedUrls.has(normalizeUrlForCompare(url));
    });
    const total = toEmbed.length;
    if (crawlJobId && total > 0) {
        await supabase
            .from('crawl_jobs')
            .update({ encoding_discovered_total: total, encoding_discovered_done: 0 })
            .eq('id', crawlJobId);
    }
    if (toEmbed.length === 0) {
        console.log('[indexer] embedDiscoveredLinks (bulk) EARLY_RETURN: toEmbed.length=0', {
            linksLength: links.length,
            total,
            reason: 'all links point to already-indexed pages',
        });
        return 0;
    }
    const diveCount = toEmbed.filter((l) => edgeIdToUseDive.get(l.page_edge_id)).length;
    const surfaceCount = toEmbed.length - diveCount;
    console.log('[indexer] embedDiscoveredLinks mode=surface|dive', { surface: surfaceCount, dive: diveCount, total: toEmbed.length });
    // Process in batches; for dive mode we fetch each target before embedding (progress = fetch+encode per link)
    const hasAnyDive = diveCount > 0;
    const BATCH_SIZE = hasAnyDive ? 1 : EMBED_BATCH_SIZE;
    let updated = 0;
    let lastProgressUpdate = Date.now();
    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
        const batch = toEmbed.slice(i, i + BATCH_SIZE);
        const texts = [];
        for (const item of batch) {
            let text = item.snippet;
            const useDive = edgeIdToUseDive.get(item.page_edge_id);
            if (useDive) {
                const url = edgeIdToUrl.get(item.page_edge_id) || '';
                const lead = await fetchTargetPageLead(url);
                if (lead) {
                    text = lead;
                    await supabase
                        .from('encoded_discovered')
                        .update({ snippet: text })
                        .eq('id', item.id);
                    if (updated % 5 === 0 || updated < 3) {
                        console.log('[indexer] dive', `[${updated + 1}/${toEmbed.length}]`, url.slice(0, 50) + '...', '→', lead.slice(0, 60) + (lead.length > 60 ? '...' : ''));
                    }
                }
            }
            texts.push(text || DEFAULT_LINK_SNIPPET);
        }
        const embeddings = await embedBatch(apiKey, texts);
        if (embeddings.length !== batch.length)
            break;
        for (let j = 0; j < batch.length; j++) {
            const { error } = await supabase
                .from('encoded_discovered')
                .update({ embedding: embeddings[j] })
                .eq('id', batch[j].id);
            if (!error)
                updated++;
        }
        if (crawlJobId) {
            const now = Date.now();
            await supabase
                .from('crawl_jobs')
                .update({
                encoding_discovered_done: updated,
                last_activity_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
                .eq('id', crawlJobId);
            if (now - lastProgressUpdate >= DISCOVERED_PROGRESS_INTERVAL_MS)
                lastProgressUpdate = now;
        }
    }
    if (updated > 0) {
        const skipped = links.length - toEmbed.length;
        console.log('[indexer] Embedded', updated, 'encoded_discovered', skipped > 0 ? `(skipped ${skipped} already-indexed)` : '');
    }
    return 0; // encoded_discovered rows updated; not counted in chunksCreated
}
async function embedBatch(apiKey, texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
        const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
        const res = await fetch(OPENAI_EMBEDDINGS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: OPENAI_EMBEDDING_MODEL,
                input: batch,
            }),
        });
        if (!res.ok) {
            const err = await res.text();
            throw new Error(`OpenAI embeddings: ${res.status} ${err}`);
        }
        const data = (await res.json());
        for (const item of data.data) {
            out.push(item.embedding);
        }
    }
    return out;
}
//# sourceMappingURL=indexer.js.map