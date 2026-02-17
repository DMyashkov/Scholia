/**
 * Process add_page_jobs: fetch URL, insert page, edges, discovered_links, chunk+embed for RAG.
 * Mirrors logic from supabase/functions/add-page but runs in worker for progress reporting consistency.
 */
import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from './db';
import { indexSinglePageForRag, embedDiscoveredLinksForPage } from './indexer';
import { extractLinksWithContext } from './crawler';
import type { Source } from './types';

function normalizeUrl(input: string): string {
  let s = (input || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf('?');
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.trim();
  s = s.replace(/^(https?:\/\/)+/i, '');
  s = 'https://' + s;
  try {
    const u = new URL(s);
    u.hash = '';
    u.search = '';
    if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return s;
  }
}

async function updateAddPageJob(
  jobId: string,
  updates: { status?: string; error_message?: string | null }
) {
  await supabase
    .from('add_page_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', jobId);
}

export async function claimAddPageJob(): Promise<{
  id: string;
  conversation_id: string;
  source_id: string;
  url: string;
} | null> {
  const { data: jobs, error } = await supabase
    .from('add_page_jobs')
    .select('id, conversation_id, source_id, url')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (error || !jobs?.length) return null;

  const job = jobs[0];
  const { data: updated, error: updateError } = await supabase
    .from('add_page_jobs')
    .update({ status: 'indexing', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id, conversation_id, source_id, url')
    .single();

  if (updateError || !updated) return null;
  return updated;
}

export async function processAddPageJob(job: {
  id: string;
  conversation_id: string;
  source_id: string;
  url: string;
}): Promise<void> {
  const { id: jobId, conversation_id: conversationId, source_id: sourceId, url } = job;
  const normalizedUrl = normalizeUrl(url);

  console.log('[add-page] process start', { jobId: jobId.slice(0, 8), url: normalizedUrl.slice(0, 50) });

  try {
    // Check if page already exists
    const { data: existing } = await supabase
      .from('pages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .eq('url', normalizedUrl)
      .maybeSingle();

    if (existing) {
      console.log('[add-page] page already exists', existing.id);
      await updateAddPageJob(jobId, { status: 'completed' });
      return;
    }

    // Fetch page
    const res = await fetch(normalizedUrl, {
      headers: { 'User-Agent': 'ScholiaCrawler/1.0' },
    });
    if (!res.ok) {
      await updateAddPageJob(jobId, {
        status: 'failed',
        error_message: `Failed to fetch: HTTP ${res.status}`,
      });
      throw new Error(`Failed to fetch: HTTP ${res.status}`);
    }
    const html = await res.text();

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

    // Get source
    const { data: source, error: srcErr } = await supabase
      .from('sources')
      .select('owner_id, same_domain_only, include_pdfs')
      .eq('id', sourceId)
      .single();

    if (srcErr || !source) {
      await updateAddPageJob(jobId, { status: 'failed', error_message: 'Source not found' });
      throw new Error('Source not found');
    }
    const ownerId = source.owner_id;

    // Insert page
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
      await updateAddPageJob(jobId, { status: 'failed', error_message: insertErr.message });
      throw new Error(insertErr.message);
    }

    // Create edges from seed pages
    const { data: seedPages } = await supabase
      .from('pages')
      .select('id, url')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .limit(10);

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

    // Insert discovered_links
    const sourceForExtract = {
      same_domain_only: source.same_domain_only ?? true,
      include_pdfs: source.include_pdfs ?? false,
    } as Source;
    const linksWithContext = extractLinksWithContext(html, normalizedUrl, sourceForExtract);

    const { data: existingRows } = await supabase
      .from('discovered_links')
      .select('to_url')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId);
    const existingUrls = new Set((existingRows ?? []).map((r) => r.to_url));
    const newLinks = linksWithContext.filter((l) => !existingUrls.has(l.url));

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
      await supabase.from('discovered_links').upsert(toInsert, {
        onConflict: 'conversation_id,source_id,to_url',
        ignoreDuplicates: true,
      });
    }

    // Chunk and embed page content
    await indexSinglePageForRag(newPage.id, content, ownerId, jobId);

    // Embed discovered_links for this page
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      await embedDiscoveredLinksForPage(conversationId, newPage.id, apiKey, jobId);
    }

    // Clear embeddings for links pointing to the newly added page - we'll never suggest it again
    await supabase
      .from('discovered_links')
      .update({ embedding: null })
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .eq('to_url', normalizedUrl);

    await updateAddPageJob(jobId, { status: 'completed' });
    console.log('[add-page] success', newPage.id?.slice(0, 8));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[add-page] error', msg);
    await updateAddPageJob(jobId, { status: 'failed', error_message: msg });
    throw err;
  }
}
