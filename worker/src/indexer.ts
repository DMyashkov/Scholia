/**
 * RAG indexer: chunk page content and embed via OpenAI, then insert into chunks.
 * Called once per conversation after a crawl completes (bulk).
 */
import { supabase } from './db';

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

const DISCOVERED_PROGRESS_BATCH = 25; // Update crawl_jobs every N links to avoid DB spam

async function embedDiscoveredLinks(conversationId: string, apiKey: string, crawlJobId?: string): Promise<number> {
  const { data: links, error: fetchError } = await supabase
    .from('discovered_links')
    .select('id, context_snippet')
    .eq('conversation_id', conversationId)
    .is('embedding', null);

  if (fetchError || !links?.length) return 0;

  const total = links.length;
  if (crawlJobId) {
    await supabase
      .from('crawl_jobs')
      .update({ encoding_discovered_total: total, encoding_discovered_done: 0 })
      .eq('id', crawlJobId);
  }

  const texts = links.map((l) => l.context_snippet);
  const embeddings = await embedBatch(apiKey, texts);
  if (embeddings.length !== links.length) return 0;

  let updated = 0;
  for (let i = 0; i < links.length; i++) {
    const { error } = await supabase
      .from('discovered_links')
      .update({ embedding: embeddings[i] })
      .eq('id', links[i].id);
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
    console.log('[indexer] Embedded', updated, 'discovered_links');
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
