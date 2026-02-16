// Edge Function: add a single page to an existing dynamic source
// Fetches the URL, inserts the page, creates edge, indexes for RAG

import { createClient } from 'npm:@supabase/supabase-js@2';
import * as cheerio from 'npm:cheerio@1.0.0-rc.12';

// Align with worker/src/indexer.ts: same chunk params and progress batch sizes
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_MAX_CHARS = 600;
const CHUNK_OVERLAP_CHARS = 100;
const EMBED_BATCH_SIZE = 50;
const DISCOVERED_PROGRESS_BATCH = 25;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let parsedBody: { conversationId?: string; sourceId?: string; url?: string } | undefined;
  let jobId: string | undefined;
  let supabaseClient: ReturnType<typeof createClient> | undefined;

  try {
    parsedBody = (await req.json()) as { conversationId?: string; sourceId?: string; url?: string };
    const body = parsedBody;
    const { conversationId, sourceId, url } = body;
    console.log('[add-page] request', { conversationId, sourceId, url });

    if (!conversationId || !sourceId || !url?.trim()) {
      return new Response(
        JSON.stringify({ error: 'conversationId, sourceId, and url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const authHeader = req.headers.get('Authorization');
    console.log('[add-page] auth:', { hasHeader: !!authHeader });
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const supabase = supabaseClient;

    // Normalize URL: strip fragment, query, strip protocol then add https (matches client urlUtils)
    let s = (url || '').trim();
    const hashIdx = s.indexOf('#');
    if (hashIdx >= 0) s = s.slice(0, hashIdx);
    const qIdx = s.indexOf('?');
    if (qIdx >= 0) s = s.slice(0, qIdx);
    s = s.trim();
    s = s.replace(/^(https?:\/\/)+/i, '');
    s = 'https://' + s;
    let normalizedUrl = s;
    try {
      const u = new URL(s);
      u.hash = '';
      u.search = '';
      if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
      normalizedUrl = u.toString();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if page already exists
    const { data: existing } = await supabase
      .from('pages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .eq('url', normalizedUrl)
      .single();
    if (existing) {
      console.log('[add-page] page already exists', existing.id);
      return new Response(
        JSON.stringify({ page: existing, message: 'Page already in graph' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create add_page_job so frontend can show indexing → encoding status
    const { data: job, error: jobErr } = await supabase
      .from('add_page_jobs')
      .insert({ conversation_id: conversationId, source_id: sourceId, url: normalizedUrl, status: 'indexing' })
      .select('id')
      .single();
    if (jobErr) {
      console.warn('[add-page] failed to create add_page_job:', jobErr.message);
    }
    jobId = job?.id;

    const updateJobStatus = async (
      status: string,
      errMsg?: string,
      encChunksDone?: number,
      encChunksTotal?: number,
      encDiscoveredDone?: number,
      encDiscoveredTotal?: number
    ) => {
      if (!jobId) return;
      const updates: Record<string, unknown> = {
        status,
        error_message: errMsg ?? null,
        updated_at: new Date().toISOString(),
      };
      if (encChunksTotal != null) updates.encoding_chunks_total = encChunksTotal;
      if (encChunksDone != null) updates.encoding_chunks_done = encChunksDone;
      if (encDiscoveredTotal != null) updates.encoding_discovered_total = encDiscoveredTotal;
      if (encDiscoveredDone != null) updates.encoding_discovered_done = encDiscoveredDone;
      await supabase.from('add_page_jobs').update(updates).eq('id', jobId);
    };

    // Fetch page
    const res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'ScholiaCrawler/1.0' },
    });
    if (!res.ok) {
      console.error('[add-page] fetch failed', res.status);
      await updateJobStatus('failed', `Failed to fetch: HTTP ${res.status}`);
      return new Response(
        JSON.stringify({ error: `Failed to fetch: HTTP ${res.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const html = await res.text();
    console.log('[add-page] fetched html length:', html.length);

    const $ = cheerio.load(html);
    const title = $('title').first().text().trim() || $('h1').first().text().trim() || 'Untitled';
    const content =
      $('main, article, .content, #content, #bodyContent, .mw-parser-output')
        .first()
        .text()
        .trim()
        .substring(0, 50000) ||
      $('body').text().trim().substring(0, 50000);

    const urlObj = new URL(normalizedUrl);
    const path = urlObj.pathname + urlObj.search;

    // Get source and verify user has access to conversation
    const { data: source, error: srcErr } = await supabase
      .from('sources')
      .select('owner_id, same_domain_only, include_pdfs')
      .eq('id', sourceId)
      .single();
    if (srcErr || !source) {
      return new Response(
        JSON.stringify({ error: 'Source not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const { data: { user } } = await supabase.auth.getUser();
    const ownerId = user?.id ?? source.owner_id ?? null;
    console.log('[add-page] source ok, ownerId:', !!ownerId);

    // Get seed page for edge (first page of this source in this conversation)
    const { data: seedPages } = await supabase
      .from('pages')
      .select('id, url')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .limit(10);

    // Insert new page
    const { data: newPage, error: insertErr } = await supabase
      .from('pages')
      .insert({
        source_id: sourceId,
        conversation_id: conversationId,
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
      console.error('[add-page] page insert error:', insertErr.code, insertErr.message);
      await updateJobStatus('failed', insertErr.message);
      return new Response(
        JSON.stringify({ error: insertErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create edges from each existing page to the new page (bidirectional exploration)
    if (seedPages?.length) {
      const edges = seedPages.map((p) => ({
        conversation_id: conversationId,
        source_id: sourceId,
        from_page_id: p.id,
        from_url: p.url,
        to_url: normalizedUrl,
        owner_id: ownerId,
      }));
      await supabase.from('page_edges').upsert(edges, {
        onConflict: 'conversation_id,source_id,from_url,to_url',
        ignoreDuplicates: true,
      });
    }

    // Chunk and embed (report encoding progress like worker indexer)
    const chunks = chunkText(content, CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS);
    console.log('[add-page] chunks:', chunks.length);
    if (chunks.length > 0) {
      await updateJobStatus('encoding', undefined, 0, chunks.length, undefined, undefined);
      const embeddings = await embedBatch(openaiKey, chunks);
      const rows = chunks.slice(0, embeddings.length).map((content, i) => ({
        page_id: newPage.id,
        content,
        start_index: null,
        end_index: null,
        embedding: embeddings[i],
        owner_id: ownerId,
      }));
      let inserted = 0;
      for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
        const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
        await supabase.from('chunks').insert(batch);
        inserted += batch.length;
        await updateJobStatus('encoding', undefined, inserted, chunks.length, undefined, undefined);
      }
    } else {
      await updateJobStatus('encoding');
    }

    // Populate discovered_links from new page (for future suggestions)
    // Note: We upsert with onConflict (conversation_id, source_id, to_url). The total discovered
    // count only increases by links that don't already exist—overlap with existing pages = fewer new rows.
    console.log('[add-page] extracting discovered_links...');
    const linksWithContext = extractLinksWithContext(html, normalizedUrl, {
      same_domain_only: source.same_domain_only ?? true,
      include_pdfs: source.include_pdfs ?? false,
    });
    const { data: existingRows } = await supabase
      .from('discovered_links')
      .select('to_url')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId);
    const existingUrls = new Set((existingRows ?? []).map((r) => r.to_url));
    const newLinks = linksWithContext.filter((l) => !existingUrls.has(l.url));
    console.log('[add-page] extracted', linksWithContext.length, 'links;', newLinks.length, 'new (not already discovered),', linksWithContext.length - newLinks.length, 'duplicates');
    if (newLinks.length > 0) {
      const toInsert = newLinks.slice(0, 500).map((l) => ({
        conversation_id: conversationId,
        source_id: sourceId,
        from_page_id: newPage.id,
        to_url: l.url,
        anchor_text: l.anchorText || null,
        context_snippet: l.contextSnippet.substring(0, 500),
        owner_id: ownerId,
      }));
      const { error: dlErr } = await supabase.from('discovered_links').upsert(toInsert, {
        onConflict: 'conversation_id,source_id,to_url',
        ignoreDuplicates: true,
      });
      if (!dlErr && toInsert.length > 0) {
        const { data: linksToEmbed } = await supabase
          .from('discovered_links')
          .select('id, context_snippet')
          .eq('conversation_id', conversationId)
          .eq('from_page_id', newPage.id)
          .is('embedding', null);
        if (linksToEmbed?.length) {
          const total = linksToEmbed.length;
          await updateJobStatus('encoding', undefined, undefined, undefined, 0, total);
          const snippets = linksToEmbed.map((l) => l.context_snippet);
          const linkEmbs = await embedBatch(openaiKey, snippets);
          let done = 0;
          for (let i = 0; i < linksToEmbed.length && i < linkEmbs.length; i++) {
            await supabase
              .from('discovered_links')
              .update({ embedding: linkEmbs[i] })
              .eq('id', linksToEmbed[i].id);
            done++;
            if (done % DISCOVERED_PROGRESS_BATCH === 0) {
              await updateJobStatus('encoding', undefined, undefined, undefined, done, total);
            }
          }
          if (done > 0) {
            await updateJobStatus('encoding', undefined, undefined, undefined, done, total);
          }
        }
      }
    }

    console.log('[add-page] success, page id:', newPage.id);
    await updateJobStatus('completed');

    return new Response(
      JSON.stringify({
        page: newPage,
        discoveredLinks: { extracted: linksWithContext.length, new: newLinks.length },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[add-page] unhandled error:', e);
    const errMsg = e instanceof Error ? e.message : String(e);
    try {
      if (jobId && supabaseClient) {
        await supabaseClient.from('add_page_jobs').update({ status: 'failed', error_message: errMsg, updated_at: new Date().toISOString() }).eq('id', jobId);
      }
    } catch (_) { /* ignore */ }
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

const CONTEXT_LEN = 200;

function extractLinksWithContext(
  html: string,
  pageUrl: string,
  opts: { same_domain_only: boolean; include_pdfs: boolean }
): Array<{ url: string; contextSnippet: string; anchorText: string }> {
  const $ = cheerio.load(html);
  const baseUrl = new URL(pageUrl);
  const seen = new Set<string>();
  const currentUrlNorm = new URL(pageUrl);
  currentUrlNorm.hash = '';
  currentUrlNorm.search = '';
  if (currentUrlNorm.pathname.endsWith('/') && currentUrlNorm.pathname !== '/') currentUrlNorm.pathname = currentUrlNorm.pathname.slice(0, -1);
  const currentStr = currentUrlNorm.toString();

  const main = $('main, article, #content, #bodyContent, .mw-parser-output').first();
  const sel = main.length ? main : $('body');
  const links = sel.find('a[href]').length ? sel.find('a[href]') : $('a[href]');
  const out: Array<{ url: string; contextSnippet: string; anchorText: string }> = [];

  links.each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href === '#' || (href.startsWith('#') && !href.startsWith('http'))) return;
    try {
      const linkUrl = new URL(href, pageUrl);
      linkUrl.hash = '';
      linkUrl.search = '';
      if (linkUrl.pathname.endsWith('/') && linkUrl.pathname !== '/') linkUrl.pathname = linkUrl.pathname.slice(0, -1);
      const urlStr = linkUrl.toString();
      if (seen.has(urlStr) || urlStr === currentStr) return;
      seen.add(urlStr);

      if (linkUrl.hostname.includes('wikipedia.org')) {
        const parts = linkUrl.pathname.split('/').filter(Boolean);
        if (parts[0] === 'wiki' && parts[1]) {
          const name = decodeURIComponent(parts[1]);
          if (/^(Wikipedia|Special|Portal|Help|Template|Category|File|Media|Talk|User)/.test(name) || name === 'Main_Page') return;
        }
      }
      if (opts.same_domain_only) {
        const base = baseUrl.hostname.replace(/^www\./, '');
        const link = linkUrl.hostname.replace(/^www\./, '');
        if (link !== base && !link.endsWith('.' + base) && !base.endsWith('.' + link)) return;
      }
      if (!opts.include_pdfs && linkUrl.pathname.endsWith('.pdf')) return;
      if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:') return;

      const anchorText = $(el).text().trim().replace(/\s+/g, ' ').substring(0, 100);
      let ctxEl = $(el).closest('p, li, td, .mw-parser-output > div');
      if (!ctxEl.length) ctxEl = $(el).parent();
      const raw = ctxEl.first().text().trim().replace(/\s+/g, ' ');
      const half = Math.floor(CONTEXT_LEN / 2);
      let contextSnippet: string;
      const pos = anchorText ? raw.indexOf(anchorText) : -1;
      if (pos >= 0) {
        if (pos < 50) contextSnippet = raw.slice(pos, Math.min(raw.length, pos + CONTEXT_LEN)).trim();
        else if (pos + anchorText.length > raw.length - 50) contextSnippet = raw.slice(Math.max(0, raw.length - CONTEXT_LEN), raw.length).trim();
        else contextSnippet = raw.slice(Math.max(0, pos - half), Math.min(raw.length, pos + anchorText.length + half)).trim();
      } else {
        contextSnippet = raw.substring(0, CONTEXT_LEN);
      }
      // Don't skip links with short context—use anchor or URL title as fallback so we capture all links
      if (contextSnippet.length < 20) {
        if (anchorText && anchorText.length >= 5) {
          contextSnippet = anchorText.substring(0, CONTEXT_LEN);
        } else {
          const pathParts = linkUrl.pathname.split('/').filter(Boolean);
          const wikiTitle = pathParts[0] === 'wiki' && pathParts[1]
            ? decodeURIComponent(pathParts[1].replace(/_/g, ' '))
            : linkUrl.pathname;
          contextSnippet = wikiTitle ? `Link to ${wikiTitle}`.substring(0, CONTEXT_LEN) : 'Link from page';
        }
      }
      out.push({ url: urlStr, contextSnippet, anchorText });
    } catch {
      /* skip invalid */
    }
  });
  return out;
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
      body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: batch }),
    });
    if (!res.ok) throw new Error(`OpenAI: ${res.status}`);
    const data = (await res.json()) as { data: { embedding: number[] }[] };
    for (const item of data.data) out.push(item.embedding);
  }
  return out;
}
