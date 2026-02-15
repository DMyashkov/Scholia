/**
 * RAG indexer: chunk page content and embed via OpenAI, then insert into chunks.
 * Called once per conversation after a crawl completes (bulk).
 */
import { supabase } from './db';

const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_MAX_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 100;
const EMBED_BATCH_SIZE = 50;

export async function indexConversationForRag(conversationId: string): Promise<{ chunksCreated: number }> {
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

  const embeddings = await embedBatch(
    apiKey,
    chunkSpecs.map((c) => c.content),
  );

  if (embeddings.length !== chunkSpecs.length) {
    console.error('[indexer] Embedding count mismatch');
    return { chunksCreated: 0 };
  }

  console.log('[indexer] Indexing', chunkSpecs.length, 'chunks from', pages?.length ?? 0, 'pages');
  const rows = chunkSpecs.map((c, i) => ({
    page_id: c.page_id,
    content: c.content,
    start_index: c.start_index,
    end_index: c.end_index,
    embedding: embeddings[i],
    owner_id: c.owner_id,
  }));

  let inserted = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
    const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
    const { error } = await supabase.from('chunks').insert(batch);
    if (error) {
      console.error('[indexer] Chunk insert error:', error.message);
      break;
    }
    inserted += batch.length;
  }

  return { chunksCreated: inserted };
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
