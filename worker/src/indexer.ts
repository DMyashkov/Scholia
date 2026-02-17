/**
 * RAG indexer: chunk page content and embed via OpenAI, then insert into chunks.
 * Called once per conversation after a crawl completes (bulk).
 */
import { supabase } from './db';

// Align with supabase/functions/add-page: same chunk params and progress batch sizes
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_MAX_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 100;
const EMBED_BATCH_SIZE = 50;

export async function indexConversationForRag(
  conversationId: string,
  crawlJobId?: string
): Promise<{ chunksCreated: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ OPENAI_API_KEY not set; skipping RAG indexing');
    return { chunksCreated: 0 };
  }

  const { data: pages, error: pagesError } = await supabase
    .from('pages')
    .select('id, content, owner_id')
    .eq('conversation_id', conversationId)
    .eq('status', 'indexed')
    .not('content', 'is', null);

  if (pagesError) {
    console.error('[indexer] Failed to fetch pages:', pagesError.message);
    return { chunksCreated: 0 };
  }
  if (!pages?.length) {
    return { chunksCreated: 0 };
  }

  const chunkSpecs: { page_id: string; content: string; start_index: number | null; end_index: number | null; owner_id: string | null }[] = [];

  for (const page of pages) {
    const text = (page.content || '').trim();
    if (!text) continue;
    const pageChunks = chunkText(text, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS);
    for (const content of pageChunks) {
      chunkSpecs.push({
        page_id: page.id,
        content,
        start_index: null,
        end_index: null,
        owner_id: page.owner_id ?? null,
      });
    }
  }

  if (chunkSpecs.length === 0) {
    return { chunksCreated: 0 };
  }

  const totalChunks = chunkSpecs.length;
  if (crawlJobId) {
    await supabase
      .from('crawl_jobs')
      .update({ encoding_chunks_total: totalChunks, encoding_chunks_done: 0 })
      .eq('id', crawlJobId);
  }

  console.log('[indexer] Indexing', totalChunks, 'chunks from', pages?.length ?? 0, 'pages');
  let inserted = 0;

  // Process in batches to report encoding progress
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
    if (crawlJobId) {
      await supabase
        .from('crawl_jobs')
        .update({ encoding_chunks_done: inserted, last_activity_at: new Date().toISOString() })
        .eq('id', crawlJobId);
    }
  }

  // Embed discovered_links for dynamic mode (RAG suggestions)
  const discoveredEmbedded = await embedDiscoveredLinks(conversationId, apiKey, crawlJobId);

  return { chunksCreated: inserted + discoveredEmbedded };
}

/** Index a single page for RAG and report progress to add_page_jobs */
export async function indexSinglePageForRag(
  pageId: string,
  content: string,
  ownerId: string | null,
  addPageJobId: string
): Promise<{ chunksCreated: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ OPENAI_API_KEY not set; skipping RAG indexing');
    return { chunksCreated: 0 };
  }

  const text = (content || '').trim();
  if (!text) return { chunksCreated: 0 };

  const chunkSpecs = chunkText(text, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS)
    .map((content) => ({
      page_id: pageId,
      content,
      start_index: null as number | null,
      end_index: null as number | null,
      owner_id: ownerId,
    }));

  if (chunkSpecs.length === 0) return { chunksCreated: 0 };

  const totalChunks = chunkSpecs.length;
  await supabase
    .from('add_page_jobs')
    .update({
      encoding_chunks_total: totalChunks,
      encoding_chunks_done: 0,
      status: 'encoding',
      updated_at: new Date().toISOString(),
    })
    .eq('id', addPageJobId);

  let inserted = 0;
  for (let i = 0; i < chunkSpecs.length; i += EMBED_BATCH_SIZE) {
    const batchSpecs = chunkSpecs.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batchSpecs.map((c) => c.content);
    const embeddings = await embedBatch(apiKey, texts);
    if (embeddings.length !== batchSpecs.length) break;
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
      console.error('[indexer] add-page chunk insert error:', error.message);
      break;
    }
    inserted += rows.length;
    await supabase
      .from('add_page_jobs')
      .update({
        encoding_chunks_done: inserted,
        updated_at: new Date().toISOString(),
      })
      .eq('id', addPageJobId);
  }
  return { chunksCreated: inserted };
}

/** Embed discovered_links for a single page (add-page flow) and report progress.
 * Skips links pointing to already-indexed pages - we never suggest those. */
export async function embedDiscoveredLinksForPage(
  conversationId: string,
  pageId: string,
  apiKey: string,
  addPageJobId: string
): Promise<number> {
  const indexedUrls = await getIndexedPageUrls(conversationId);
  const { data: links, error: fetchError } = await supabase
    .from('discovered_links')
    .select('id, context_snippet, to_url')
    .eq('conversation_id', conversationId)
    .eq('from_page_id', pageId)
    .is('embedding', null);

  if (fetchError || !links?.length) return 0;

  const toEmbed = links.filter((l) => !indexedUrls.has(normalizeUrlForCompare(l.to_url || '')));
  if (toEmbed.length === 0) return 0;

  const total = toEmbed.length;
  await supabase
    .from('add_page_jobs')
    .update({
      encoding_discovered_total: total,
      encoding_discovered_done: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', addPageJobId);

  const texts = toEmbed.map((l) => l.context_snippet);
  const embeddings = await embedBatch(apiKey, texts);
  if (embeddings.length !== texts.length) return 0;

  let updated = 0;
  for (let i = 0; i < toEmbed.length; i++) {
    const { error } = await supabase
      .from('discovered_links')
      .update({ embedding: embeddings[i] })
      .eq('id', toEmbed[i].id);
    if (!error) updated++;
    if (updated % DISCOVERED_PROGRESS_BATCH === 0) {
      await supabase
        .from('add_page_jobs')
        .update({
          encoding_discovered_done: updated,
          updated_at: new Date().toISOString(),
        })
        .eq('id', addPageJobId);
    }
  }
  if (updated > 0) {
    await supabase
      .from('add_page_jobs')
      .update({
        encoding_discovered_done: updated,
        updated_at: new Date().toISOString(),
      })
      .eq('id', addPageJobId);
    const skipped = links.length - toEmbed.length;
    console.log('[indexer] add-page embedded', updated, 'discovered_links', skipped > 0 ? `(skipped ${skipped} already-indexed)` : '');
  }
  return updated;
}

const DISCOVERED_PROGRESS_BATCH = 25; // Update crawl_jobs every N links to avoid DB spam

/** Normalize URL for comparison (strip hash, query, lowercase) */
function normalizeUrlForCompare(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    u.hash = '';
    u.search = '';
    let path = u.pathname;
    if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
    return (u.origin + path).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Fetch indexed page URLs for a conversation - we never suggest already-indexed pages */
async function getIndexedPageUrls(conversationId: string): Promise<Set<string>> {
  const { data: pages, error } = await supabase
    .from('pages')
    .select('url')
    .eq('conversation_id', conversationId)
    .eq('status', 'indexed');
  if (error || !pages?.length) return new Set();
  return new Set(pages.map((p) => normalizeUrlForCompare(p.url || '')));
}

async function embedDiscoveredLinks(conversationId: string, apiKey: string, crawlJobId?: string): Promise<number> {
  const indexedUrls = await getIndexedPageUrls(conversationId);
  const { data: links, error: fetchError } = await supabase
    .from('discovered_links')
    .select('id, context_snippet, to_url')
    .eq('conversation_id', conversationId)
    .is('embedding', null);

  if (fetchError || !links?.length) return 0;

  const toEmbed = links.filter((l) => !indexedUrls.has(normalizeUrlForCompare(l.to_url || '')));
  if (toEmbed.length === 0) return 0;

  const total = toEmbed.length;
  if (crawlJobId) {
    await supabase
      .from('crawl_jobs')
      .update({ encoding_discovered_total: total, encoding_discovered_done: 0 })
      .eq('id', crawlJobId);
  }

  const texts = toEmbed.map((l) => l.context_snippet);
  const embeddings = await embedBatch(apiKey, texts);
  if (embeddings.length !== texts.length) return 0;

  let updated = 0;
  for (let i = 0; i < toEmbed.length; i++) {
    const { error } = await supabase
      .from('discovered_links')
      .update({ embedding: embeddings[i] })
      .eq('id', toEmbed[i].id);
    if (!error) updated++;
    if (crawlJobId && updated % DISCOVERED_PROGRESS_BATCH === 0) {
      await supabase
        .from('crawl_jobs')
        .update({ encoding_discovered_done: updated, last_activity_at: new Date().toISOString() })
        .eq('id', crawlJobId);
    }
  }
  if (crawlJobId && updated > 0) {
    await supabase
      .from('crawl_jobs')
      .update({ encoding_discovered_done: updated })
      .eq('id', crawlJobId);
  }
  if (updated > 0) {
    const skipped = links.length - toEmbed.length;
    console.log('[indexer] Embedded', updated, 'discovered_links', skipped > 0 ? `(skipped ${skipped} already-indexed)` : '');
  }
  return 0; // Don't count toward chunksCreated
}

function chunkText(text: string, maxChars: number, overlap: number): string[] {
  const out: string[] = [];
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim());
  let current = '';

  for (const p of paragraphs) {
    if (current.length + p.length + 2 <= maxChars) {
      current += (current ? '\n\n' : '') + p;
    } else {
      if (current) {
        out.push(current.trim());
        const overlapStart = Math.max(0, current.length - overlap);
        current = current.slice(overlapStart) + '\n\n' + p;
      } else {
        for (let i = 0; i < p.length; i += maxChars - overlap) {
          out.push(p.slice(i, i + maxChars));
        }
        current = '';
      }
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
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
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    for (const item of data.data) {
      out.push(item.embedding);
    }
  }
  return out;
}
