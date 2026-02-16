import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import RobotsParser from 'robots-parser';
import { supabase } from './db';
import { indexConversationForRag } from './indexer';
import type { CrawlJob, Source, Page, PageEdge } from './types';

const MAX_PAGES: Record<Source['crawl_depth'], number> = {
  shallow: 5,
  medium: 15,
  deep: 35,
  dynamic: 1, // Only the seed page; discovered links stored for RAG suggestion
};

let _noQueuedLogCounter = 0;

export async function processCrawlJob(jobId: string) {
  console.log('[crawl] processCrawlJob start', { jobId: jobId.slice(0, 8) });

  try {
    // Get the crawl job
    const { data: job, error: jobError } = await supabase
      .from('crawl_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      console.error(`❌ Failed to fetch job ${jobId}:`, jobError);
      return;
    }
    console.log('[crawl] job loaded', {
      jobId: job.id?.slice(0, 8),
      status: job.status,
      sourceId: job.source_id?.slice(0, 8),
      conversationId: job.conversation_id?.slice(0, 8),
    });
    console.log(`[D/I] job from DB: discovered_count=${(job as any).discovered_count ?? '?'} indexed_count=${(job as any).indexed_count ?? job.pages_indexed ?? '?'} pages_indexed=${job.pages_indexed}`);

    // Check if job is still queued or running (might have been claimed)
    if (job.status !== 'queued' && job.status !== 'running') {
      console.log('[crawl] job no longer runnable', { jobId: job.id?.slice(0, 8), status: job.status });
      return;
    }

    // Get the source
    const { data: source, error: sourceError } = await supabase
      .from('sources')
      .select('*')
      .eq('id', job.source_id)
      .single();

    if (sourceError || !source) {
      console.error(`❌ Failed to fetch source ${job.source_id}:`, sourceError);
      await updateJobStatus(jobId, 'failed', `Source not found: ${sourceError?.message}`);
      return;
    }

  if (!job.conversation_id) {
    console.error(`❌ WARNING: Job ${jobId} has no conversation_id! This will cause pages to be created with wrong conversation_id.`);
  }
    
    // Update job to running (if not already)
    if (job.status !== 'running') {
      await updateJobStatus(jobId, 'running', null, new Date().toISOString());
    }

    // Start crawling
    await crawlSource(job, source);

    // Mark as completed
    await updateJobStatus(jobId, 'completed', null, null, new Date().toISOString());

  } catch (error) {
    console.error(`\n❌ ========== FATAL ERROR PROCESSING JOB ${jobId.substring(0, 8)}... ==========`);
    console.error(`❌ Error:`, error);
    console.error(`❌ Stack:`, error instanceof Error ? error.stack : 'No stack trace');
    console.error(`❌ ========== END ERROR ==========\n`);
    await updateJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : String(error)
    );
    throw error; // Re-throw so caller knows it failed
  }
}

async function crawlSource(job: CrawlJob, source: Source) {
  // Get conversation_id from the job (stored when job was created)
  // This is more reliable than querying conversation_sources
  let conversationId = job.conversation_id;
  
  if (!conversationId) {
    console.error(`❌ conversation_id is missing from crawl job ${job.id}`);
    // Fallback: try to get it from conversation_sources
    const { data: convSources, error: convError } = await supabase
      .from('conversation_sources')
      .select('conversation_id')
      .eq('source_id', source.id)
      .limit(1);

    if (convError || !convSources || convSources.length === 0) {
      console.error(`❌ Failed to find conversation for source ${source.id}:`, convError);
      throw new Error(`No conversation found for source ${source.id}`);
    }

    const fallbackConversationId = convSources[0]?.conversation_id;
    if (!fallbackConversationId) {
      throw new Error(`conversation_id is null for source ${source.id}`);
    }
    
    conversationId = fallbackConversationId;
  }
  
  // Validate that the conversation exists
  const { data: conversation, error: convCheckError } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .single();
  
  if (convCheckError || !conversation) {
    console.error(`❌ Conversation ${conversationId} does not exist! Error:`, convCheckError);
    // Try to find the correct conversation from conversation_sources
    const { data: convSources } = await supabase
      .from('conversation_sources')
      .select('conversation_id')
      .eq('source_id', source.id)
      .limit(1);
    
    if (convSources && convSources.length > 0) {
      const correctConversationId = convSources[0].conversation_id;
      
      // Update the crawl job with the correct conversation_id
      await supabase
        .from('crawl_jobs')
        .update({ conversation_id: correctConversationId })
        .eq('id', job.id);
      
      conversationId = correctConversationId;
    } else {
      throw new Error(`Conversation ${conversationId} does not exist and no alternative found for source ${source.id}`);
    }
  }
  
  
  // Double-check: verify the conversation_id matches what's in the job
  if (job.conversation_id && job.conversation_id !== conversationId) {
  }
  
  return crawlSourceWithConversationId(job, source, conversationId);
}

function normalizeUrlForCrawl(input: string): string {
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

async function crawlSourceWithConversationId(job: CrawlJob, source: Source, conversationId: string) {
  const seedUrl = normalizeUrlForCrawl(source.url);

  const rawDepth = (source as { crawl_depth?: string }).crawl_depth;
  const maxPages =
    (rawDepth && MAX_PAGES[rawDepth as Source['crawl_depth']]) ??
    (rawDepth === 'dynamic' ? 1 : 15);
  const visited = new Set<string>();
  const discovered = new Set<string>(); // All discovered URLs (including queued)
  // Hub-and-spoke: prioritize direct links from starting page
  // Queue structure: { url, depth, priority }
  // Priority: 0 = starting page, 1 = direct links from starting page, 2 = links from depth 1 pages, etc.
  const queue: Array<{ url: string; depth: number; priority: number }> = [{ url: seedUrl, depth: 0, priority: 0 }];
  const directLinksFromStart: string[] = []; // Links directly from the starting page
  discovered.add(seedUrl);
  let linksCount = 0;


  // Update source title from first page crawled
  let sourceTitleUpdated = false;

  // Fetch robots.txt
  let robotsParser: any = null;
  try {
    const robotsUrl = new URL('/robots.txt', seedUrl).toString();
    const robotsResponse = await fetch(robotsUrl);
    if (robotsResponse.ok) {
      const robotsText = await robotsResponse.text();
      robotsParser = RobotsParser(robotsUrl, robotsText);
    }
  } catch (error) {
  }

  
  if (queue.length === 0) {
    console.error(`❌ CRITICAL: Queue is empty before starting crawl! This should never happen.`);
    console.error(`❌ Source URL: ${seedUrl}`);
    return;
  }

  const sourceShort = new URL(seedUrl).pathname?.replace(/^\/wiki\//, '') || seedUrl.slice(0, 40);
  console.log(`[crawl] START source=${sourceShort} url=${seedUrl} maxPages=${maxPages} depth=${source.crawl_depth} jobId=${job.id?.slice(0, 8)}`);
  console.log(`[D/I] INIT discovered=${discovered.size} visited=${visited.size} (seed in discovered, no pages yet; job NOT updated until first page succeeds)`);

  let loopIterations = 0;
  while (queue.length > 0 && visited.size < maxPages) {
    loopIterations++;

    if (loopIterations === 1 && queue.length === 0) {
      console.error(`❌ CRITICAL: Queue became empty on first iteration!`);
      break;
    }
    // Sort queue by priority (lower = higher priority) to process direct links first
    queue.sort((a, b) => a.priority - b.priority);
    const { url, depth, priority } = queue.shift()!;

    // Normalize URL (remove fragment and trailing slash) before checking
    const urlObj = new URL(url);
    urlObj.hash = '';
    urlObj.search = ''; // Also remove query params for normalization
    // Normalize path: remove trailing slash, but keep root as /
    if (urlObj.pathname === '/' || urlObj.pathname === '') {
      urlObj.pathname = '/';
    } else if (urlObj.pathname.endsWith('/')) {
      urlObj.pathname = urlObj.pathname.slice(0, -1);
    }
    const normalizedUrl = urlObj.toString();

    if (visited.has(normalizedUrl)) continue;
    if (depth > 2) continue; // Max depth limit

    // Check robots.txt
    if (robotsParser && !robotsParser.isAllowed(normalizedUrl, 'ScholiaCrawler')) {
      continue;
    }

    try {
      const linkType = priority === 0 ? '🎯 STARTING PAGE' : priority === 1 ? '⭐ DIRECT LINK' : `🔗 Depth ${depth} link`;
      if (!conversationId) {
        throw new Error(`conversationId is null before calling crawlPage!`);
      }
      console.log(`[D/I] crawlPage START url=${normalizedUrl.slice(0, 60)} depth=${depth} isSeed=${depth === 0} conv=${conversationId?.slice(0, 8)}`);
      const result = await crawlPage(normalizedUrl, source, job, conversationId);
      if (!result) {
        console.error(`[D/I] crawlPage FAILED - page insert/fetch failed; we will NOT update job (discovered/indexed stay stale)`);
        console.error(`❌ Failed to crawl page ${normalizedUrl} - skipping and continuing`, {
          depth,
          isSeedPage: depth === 0,
          jobId: job.id?.slice(0, 8),
          sourceId: source.id?.slice(0, 8),
        });
        if (depth === 0) {
          console.error(`❌ CRITICAL: Seed page failed! No pages will be indexed for this source.`);
        }
        console.error(`❌ Check the error logs above to see why page insertion/fetch failed.`);
        // Mark as visited anyway to avoid infinite retries
        visited.add(normalizedUrl);
        continue;
      }
      
      const { page, html } = result;
      visited.add(normalizedUrl);
      console.log(`[D/I] crawlPage OK pageId=${page?.id?.slice(0, 8)} visited=${visited.size} (will extract links then update job)`);
      
      // Update source_label from first page (human-readable label for UI). domain stays as hostname.
      if (!sourceTitleUpdated && page.title) {
          const pageTitle = page.title.replace(/\s*-\s*Wikipedia.*$/i, '').trim();
          if (pageTitle && pageTitle.length > 0) {
            try {
              const { error } = await supabase
                .from('sources')
                .update({ source_label: pageTitle.substring(0, 100) })
                .eq('id', source.id);
              if (!error) {
                (source as { source_label?: string }).source_label = pageTitle.substring(0, 100);
              }
              sourceTitleUpdated = true;
            } catch (_err) {
              // Non-blocking
            }
          }
      }

      // Extract links BEFORE updating progress (so we count discovered)
      const isDynamic = source.crawl_depth === 'dynamic';
      const links = extractLinks(html, normalizedUrl, source);
      // Only extract links-with-context for dynamic sources (expensive: 200-char context + embeddings for RAG suggestions)
      const linksWithContext = isDynamic ? extractLinksWithContext(html, normalizedUrl, source) : [];

      const newLinks: string[] = [];
      const edgesToInsert: Array<{conversation_id: string; source_id: string; from_page_id: string; from_url: string; to_url: string; owner_id: string | null}> = [];
      
      const linksToProcess = links.slice(0, 200);

      // Insert discovered_links only for dynamic sources (avoids expensive embedding of every link for shallow/medium/deep)
      if (isDynamic && linksWithContext.length > 0) {
        const toInsert = linksWithContext
          .filter((l) => l.contextSnippet.length > 0)
          .slice(0, 500)
          .map((l) => ({
            conversation_id: conversationId,
            source_id: source.id,
            from_page_id: page.id,
            to_url: l.url,
            anchor_text: l.anchorText || null,
            context_snippet: l.contextSnippet.substring(0, 500),
            owner_id: source.owner_id,
          }));
        const { error: dlError } = await supabase.from('discovered_links').upsert(toInsert, {
          onConflict: 'conversation_id,source_id,to_url',
          ignoreDuplicates: true,
        });
        if (dlError) {
          console.warn('[crawl] discovered_links insert error:', dlError.message);
        } else {
          console.log(`[D/I] discovered_links inserted=${toInsert.length} conv=${conversationId?.slice(0, 8)} source=${source.id?.slice(0, 8)}`);
        }
      }

      for (const link of linksToProcess) {
          // Links are already normalized by extractLinks, but double-check normalization
          const linkUrlObj = new URL(link);
          linkUrlObj.hash = '';
          linkUrlObj.search = '';
          // Normalize path: remove trailing slash, but keep root as /
          if (linkUrlObj.pathname === '/' || linkUrlObj.pathname === '') {
            linkUrlObj.pathname = '/';
          } else if (linkUrlObj.pathname.endsWith('/')) {
            linkUrlObj.pathname = linkUrlObj.pathname.slice(0, -1);
          }
          const normalizedLink = linkUrlObj.toString();
          
          // Add edge to batch (isolated per conversation)
          // from_page_id lets the frontend match "from" by ID; to_url matched by URL when page is indexed
          edgesToInsert.push({
            conversation_id: conversationId,
            source_id: source.id,
            from_page_id: page.id,
            from_url: normalizedUrl,
            to_url: normalizedLink,
            owner_id: source.owner_id,
          });

          if (!discovered.has(normalizedLink)) {
            discovered.add(normalizedLink);
            newLinks.push(normalizedLink);
            
            // Hub-and-spoke: prioritize direct links from starting page
            // If this is the starting page (depth 0, priority 0), save its links for priority processing
            if (priority === 0 && depth === 0) {
              directLinksFromStart.push(normalizedLink);
            }
            
            // Add to queue if we haven't reached max pages
            // Priority: 1 = direct links from start, 2 = links from depth 1, etc.
            if (visited.size + queue.length < maxPages && depth < 2) {
              const linkPriority = priority === 0 ? 1 : priority + 1; // Direct links from start get priority 1
              queue.push({ url: normalizedLink, depth: depth + 1, priority: linkPriority });
            }
          }
      }

      console.log(`[crawl] page ${visited.size}/${maxPages} depth=${depth} links=${links.length} newToQueue=${newLinks.length} queue=${queue.length}`);

      // Insert edges immediately after page insertion for real-time UI updates
      // CRITICAL: Edge insertion errors must NOT stop the crawl - wrap in try-catch
      if (edgesToInsert.length > 0) {
        
        try {
          const edgeStart = Date.now();
          // Use smaller batches (50 at a time) for better real-time updates
          const batchSize = 50;
          let successCount = 0;
          
          // Insert edges in batches - CRITICAL: errors must not stop the crawl
          for (let i = 0; i < edgesToInsert.length; i += batchSize) {
            const chunk = edgesToInsert.slice(i, i + batchSize);
            try {
              const { error: batchError } = await supabase
                .from('page_edges')
                .insert(chunk);
              
              if (batchError) {
                // If chunk fails, check if it's duplicates (which is fine)
                if (batchError.code === '23505' || batchError.message.includes('duplicate')) {
                  // Duplicates are fine, count as success
                  successCount += chunk.length;
                } else {
                  // Non-duplicate error - log but don't block
                  // Estimate success to keep crawl going
                  successCount += Math.floor(chunk.length * 0.5);
                }
              } else {
                successCount += chunk.length;
              }
            } catch (chunkError: any) {
              // CRITICAL: Log but don't throw - continue with next chunk
              // Estimate success for this chunk so crawl continues
              successCount += Math.floor(chunk.length * 0.5);
            }
            
            // Small delay between batches to avoid overwhelming the database
            if (i + batchSize < edgesToInsert.length) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
          }
          
          linksCount += successCount;
        } catch (edgeError: any) {
          console.error(`[crawl] EDGE INSERT ERROR`, edgeError?.message || edgeError);
          // CRITICAL: Log error but continue crawling - edges are not critical
          // Estimate links count so crawl can continue
          linksCount += Math.floor(edgesToInsert.length * 0.8);
        }
      }

      // Update job progress with all counters
      const updatePayload = {
        discovered_count: discovered.size,
        indexed_count: visited.size,
        links_count: linksCount,
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      console.log(`[D/I] JOB UPDATE writing discovered=${updatePayload.discovered_count} indexed=${updatePayload.indexed_count} links=${updatePayload.links_count} jobId=${job.id?.slice(0, 8)}`);
      await supabase
        .from('crawl_jobs')
        .update(updatePayload)
        .eq('id', job.id);


      // Small delay to be respectful
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      // Rethrow conversation-deleted so job fails fast
      if (error instanceof Error && error.message.includes('was deleted')) throw error;
      console.error(`❌ Error crawling ${url}:`, error);
      // Continue with next page
    }
  }

  // Run indexer BEFORE marking completed so when UI shows "ready", chunks exist
  console.log(`[D/I] Transitioning to indexing: discovered=${discovered.size} indexed=${visited.size} jobId=${job.id?.slice(0, 8)}`);
  await supabase
    .from('crawl_jobs')
    .update({ status: 'indexing', updated_at: new Date().toISOString() })
    .eq('id', job.id);

  try {
    await indexConversationForRag(conversationId, job.id);
  } catch (_indexErr) {
    console.warn('[crawl] RAG indexing failed:', _indexErr);
  }

  // Final update
  await supabase
    .from('crawl_jobs')
    .update({ 
      total_pages: visited.size,
      discovered_count: discovered.size,
      indexed_count: visited.size,
      links_count: linksCount,
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', job.id);

  const exitReason = queue.length === 0 ? 'queue empty' : `visited >= maxPages (${visited.size} >= ${maxPages})`;
  console.log(`[crawl] END source=${sourceShort} visited=${visited.size} exit=${exitReason} linksCount=${linksCount} iterations=${loopIterations}`);
  console.log(`[D/I] FINAL discovered=${discovered.size} indexed=${visited.size} (this is what job will have after final update)`);

  if (loopIterations === 0) {
    console.error(`❌ CRITICAL: Crawl loop never ran! Loop iterations = 0`);
    console.error(`❌ This means the while condition was false from the start.`);
    console.error(`❌ Queue length: ${queue.length}, visited.size: ${visited.size}, maxPages: ${maxPages}`);
  }
  
  if (visited.size === 0 && loopIterations > 0) {
    console.error(`❌ CRITICAL: Loop ran ${loopIterations} times but visited.size is still 0!`);
    console.error(`❌ This means all page insertions failed.`);
  }
  
  // Final verification: Check if any pages were actually inserted
  const { data: insertedPages, error: verifyError } = await supabase
    .from('pages')
    .select('id, conversation_id, url')
    .eq('conversation_id', conversationId)
    .eq('source_id', source.id)
    .limit(5);
  
  if (verifyError) {
    console.error(`❌ Error verifying pages:`, verifyError);
  } else {
    if (!insertedPages || insertedPages.length === 0) {
      console.error(`❌ CRITICAL: No pages found in DB even though visited.size=${visited.size}!`);
      console.error(`❌ This means all page insertions failed. Check error logs above.`);
    }
  }
}

async function crawlPage(url: string, source: Source, job: CrawlJob, conversationId: string): Promise<{ page: Page; html: string } | null> {
  // Validate conversationId
  if (!conversationId) {
    console.error(`❌ conversationId is required but was: ${conversationId}`);
    throw new Error(`conversationId is required for page insertion`);
  }

  try {
    const fetchStart = Date.now();
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ScholiaCrawler/1.0',
      },
      // Note: node-fetch doesn't support timeout in options, use AbortController if needed
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const fetchTime = Date.now() - fetchStart;
    
    const $ = cheerio.load(html);

    // Extract title
    const title = $('title').first().text().trim() || 
                  $('h1').first().text().trim() || 
                  'Untitled';

    // Extract main content (simplified - you can improve this)
    const content = $('main, article, .content, #content')
      .first()
      .text()
      .trim()
      .substring(0, 50000) || // Limit content size
      $('body').text().trim().substring(0, 50000);

    // Get path from URL
    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;

    // Insert page into database with conversation_id (isolated per conversation)
    if (!conversationId) {
      console.error(`❌ conversationId is null/undefined in crawlPage for URL: ${url}`);
      throw new Error(`conversationId is required but was: ${conversationId}`);
    }
    
    
    const insertData = {
      source_id: source.id,
      conversation_id: conversationId,
      url: url,
      title: title,
      path: path,
      content: content,
      status: 'indexed' as const,
      owner_id: source.owner_id,
    };

    const { data: page, error } = await supabase
      .from('pages')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // FK violation on conversation_id = conversation was deleted; fail job immediately
      const detailsStr = typeof error.details === 'string' ? error.details : JSON.stringify(error.details || '');
      const isConvFk = error.code === '23503' && (detailsStr.includes('conversations') || (error.message || '').includes('conversations'));
      if (isConvFk) {
        console.error(`[D/I] conversation_id FK violation - conversation was deleted, failing job`);
        throw new Error(`Conversation ${conversationId} was deleted. Cannot index pages.`);
      }
      console.error(`\n❌ ========== PAGE INSERTION FAILED ==========`);
      console.error(`❌ URL: ${url}`);
      console.error(`❌ Error code: ${error.code}`);
      console.error(`❌ Error message: ${error.message}`);
      console.error(`❌ Error details: ${JSON.stringify(error.details, null, 2)}`);
      console.error(`❌ Error hint: ${error.hint}`);
      console.error(`❌ Insert data:`, JSON.stringify({
        source_id: insertData.source_id?.substring(0, 8),
        conversation_id: insertData.conversation_id?.substring(0, 8),
        url: insertData.url?.substring(0, 50),
        hasContent: !!insertData.content,
        contentLength: insertData.content?.length || 0,
      }, null, 2));
      console.error(`❌ ========== END PAGE INSERTION ERROR ==========\n`);
      // Might be duplicate, try to get existing (check by conversation_id too)
      const { data: existing } = await supabase
        .from('pages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('source_id', source.id)
        .eq('url', url)
        .single();

      if (existing) {
        console.log(`[D/I] PAGE duplicate - using existing pageId=${existing?.id?.slice(0, 8)}`);
        return { page: existing as Page, html };
      }
      const errorDetails = {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        insertData: {
          source_id: insertData.source_id?.substring(0, 8),
          conversation_id: insertData.conversation_id?.substring(0, 8),
          url: insertData.url?.substring(0, 50),
          hasContent: !!insertData.content,
          status: insertData.status,
        },
      };
      console.error(`[D/I] PAGE INSERT FAILED - returning null (crawler will not update job for this URL)`);
      console.error(`❌ No existing page found, error details:`, JSON.stringify(errorDetails, null, 2));
      // Don't throw - return null so crawler can continue
      return null;
    }

    console.log(`[D/I] PAGE INSERT OK pageId=${(page as Page)?.id?.slice(0, 8)} conv=${conversationId?.slice(0, 8)} url=${url.slice(0, 50)}`);
    return { page: page as Page, html };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isFetch = msg.includes('HTTP') || msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
    console.error(`[D/I] crawlPage EXCEPTION - no page inserted url=${url.slice(0, 50)}`, { error: msg, isFetchError: isFetch });
    console.error(`[crawl] crawlPage failed url=${url}`, {
      error: msg,
      isFetchError: isFetch,
    });
    return null;
  }
}

const CONTEXT_SNIPPET_LENGTH = 200;

/** For dynamic mode: extract links with ~200 chars of surrounding context for RAG */
function extractLinksWithContext(
  html: string,
  pageUrl: string,
  source: Source
): Array<{ url: string; contextSnippet: string; anchorText: string }> {
  try {
    const $ = cheerio.load(html);
    const baseUrl = new URL(pageUrl);
    const seen = new Set<string>();

    const currentUrlObj = new URL(pageUrl);
    currentUrlObj.hash = '';
    currentUrlObj.search = '';
    if (currentUrlObj.pathname === '/' || currentUrlObj.pathname === '') {
      currentUrlObj.pathname = '/';
    } else if (currentUrlObj.pathname.endsWith('/')) {
      currentUrlObj.pathname = currentUrlObj.pathname.slice(0, -1);
    }
    const normalizedCurrentUrl = currentUrlObj.toString();

    const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
    const contentSelector = mainContent.length > 0 ? mainContent : $('body');
    const linkElements = contentSelector.find('a[href]').length > 0
      ? contentSelector.find('a[href]')
      : $('a[href]');

    const result: Array<{ url: string; contextSnippet: string; anchorText: string }> = [];

    linkElements.each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const trimmedHref = href.trim();
      if (trimmedHref === '#' || (trimmedHref.startsWith('#') && !trimmedHref.startsWith('http'))) return;

      try {
        const linkUrl = new URL(href, pageUrl);
        linkUrl.hash = '';
        linkUrl.search = '';
        if (linkUrl.pathname === '/' || linkUrl.pathname === '') {
          linkUrl.pathname = '/';
        } else if (linkUrl.pathname.endsWith('/')) {
          linkUrl.pathname = linkUrl.pathname.slice(0, -1);
        }
        const normalizedUrl = linkUrl.toString();

        if (seen.has(normalizedUrl)) return;
        seen.add(normalizedUrl);
        if (normalizedUrl === normalizedCurrentUrl) return;

        if (linkUrl.hostname.includes('wikipedia.org')) {
          const pathParts = linkUrl.pathname.split('/').filter((p) => p);
          if (pathParts.length >= 2 && pathParts[0] === 'wiki') {
            const pageName = decodeURIComponent(pathParts[1] || '');
            if (
              pageName.startsWith('Wikipedia:') ||
              pageName.startsWith('Wikipedia_talk:') ||
              pageName.startsWith('Special:') ||
              pageName.startsWith('Portal:') ||
              pageName.startsWith('Help:') ||
              pageName.startsWith('Template:') ||
              pageName.startsWith('Category:') ||
              pageName.startsWith('File:') ||
              pageName.startsWith('Media:') ||
              pageName.startsWith('Talk:') ||
              pageName.startsWith('User:') ||
              pageName.startsWith('User_talk:') ||
              pageName === 'Main_Page'
            )
              return;
          } else if (pathParts.length === 1 && pathParts[0] === 'Main_Page') return;
        }

        if (source.same_domain_only) {
          const baseDomain = baseUrl.hostname.replace(/^www\./, '');
          const linkDomain = linkUrl.hostname.replace(/^www\./, '');
          const isSameDomain =
            linkDomain === baseDomain ||
            linkDomain.endsWith('.' + baseDomain) ||
            baseDomain.endsWith('.' + linkDomain);
          if (!isSameDomain) return;
        }

        if (!source.include_pdfs && linkUrl.pathname.endsWith('.pdf')) return;
        if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:') return;

        const anchorText = $(element).text().trim().replace(/\s+/g, ' ').substring(0, 100);
        // Get surrounding context: parent p, li, div, or paragraph-like block
        let contextEl = $(element).closest('p, li, td, .mw-parser-output > div');
        if (contextEl.length === 0) {
          contextEl = $(element).parent();
        }
        const rawText = contextEl.first().text().trim().replace(/\s+/g, ' ');
        // Center on link text; omit leading junk when link at start, trailing when at end
        const pos = anchorText ? rawText.indexOf(anchorText) : -1;
        const half = Math.floor(CONTEXT_SNIPPET_LENGTH / 2);
        let contextSnippet: string;
        if (pos >= 0) {
          if (pos < 50) contextSnippet = rawText.slice(pos, Math.min(rawText.length, pos + CONTEXT_SNIPPET_LENGTH)).trim();
          else if (pos + anchorText.length > rawText.length - 50) contextSnippet = rawText.slice(Math.max(0, rawText.length - CONTEXT_SNIPPET_LENGTH), rawText.length).trim();
          else contextSnippet = rawText.slice(Math.max(0, pos - half), Math.min(rawText.length, pos + anchorText.length + half)).trim();
        } else {
          contextSnippet = rawText.substring(0, CONTEXT_SNIPPET_LENGTH);
        }
        // Don't skip links with short context—use anchor or URL title as fallback to capture all links
        if (contextSnippet.length < 20) {
          if (anchorText && anchorText.length >= 5) {
            contextSnippet = anchorText.substring(0, CONTEXT_SNIPPET_LENGTH);
          } else {
            const pathParts = linkUrl.pathname.split('/').filter((p) => p);
            const wikiTitle = pathParts[0] === 'wiki' && pathParts[1]
              ? decodeURIComponent(pathParts[1].replace(/_/g, ' '))
              : linkUrl.pathname;
            contextSnippet = wikiTitle ? `Link to ${wikiTitle}`.substring(0, CONTEXT_SNIPPET_LENGTH) : 'Link from page';
          }
        }

        result.push({
          url: normalizedUrl,
          contextSnippet,
          anchorText,
        });
      } catch {
        // Invalid URL
      }
    });

    return result;
  } catch (error) {
    console.error(`❌ Error extracting links with context:`, error);
    return [];
  }
}

function extractLinks(html: string, pageUrl: string, source: Source): string[] {
  try {
    const $ = cheerio.load(html);
    const baseUrl = new URL(pageUrl);
    const seen = new Set<string>();

    // Normalize current page URL for comparison
    const currentUrlObj = new URL(pageUrl);
    currentUrlObj.hash = '';
    currentUrlObj.search = ''; // Remove query params
    // Normalize path: remove trailing slash, but keep root as /
    if (currentUrlObj.pathname === '/' || currentUrlObj.pathname === '') {
      currentUrlObj.pathname = '/';
    } else if (currentUrlObj.pathname.endsWith('/')) {
      currentUrlObj.pathname = currentUrlObj.pathname.slice(0, -1);
    }
    const normalizedCurrentUrl = currentUrlObj.toString();

    const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
    const contentSelector = mainContent.length > 0 ? mainContent : $('body');
    const linkElements = contentSelector.find('a[href]').length > 0
      ? contentSelector.find('a[href]')
      : $('a[href]');

    const links: string[] = [];

    linkElements.each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const trimmedHref = href.trim();
      if (trimmedHref === '#' || (trimmedHref.startsWith('#') && !trimmedHref.startsWith('http'))) return;

      try {
        const linkUrl = new URL(href, pageUrl);
        
        // Remove fragment (hash) and query params from URL to normalize
        linkUrl.hash = '';
        linkUrl.search = '';
        
        // Normalize path: remove trailing slash, but keep root as /
        if (linkUrl.pathname === '/' || linkUrl.pathname === '') {
          linkUrl.pathname = '/';
        } else if (linkUrl.pathname.endsWith('/')) {
          linkUrl.pathname = linkUrl.pathname.slice(0, -1);
        }
        
        const normalizedUrl = linkUrl.toString();
        
        // Skip if we've already seen this URL
        if (seen.has(normalizedUrl)) {
          return;
        }
        seen.add(normalizedUrl);
        
        // Skip if it's the same page (after normalization)
        if (normalizedUrl === normalizedCurrentUrl) return;

        if (linkUrl.hostname.includes('wikipedia.org')) {
          const pathParts = linkUrl.pathname.split('/').filter(p => p);
          if (pathParts.length >= 2 && pathParts[0] === 'wiki') {
            const pageName = decodeURIComponent(pathParts[1] || '');
            if (pageName.startsWith('Wikipedia:') || pageName.startsWith('Wikipedia_talk:') ||
                pageName.startsWith('Special:') || pageName.startsWith('Portal:') ||
                pageName.startsWith('Help:') || pageName.startsWith('Template:') ||
                pageName.startsWith('Category:') || pageName.startsWith('File:') ||
                pageName.startsWith('Media:') || pageName.startsWith('Talk:') ||
                pageName.startsWith('User:') || pageName.startsWith('User_talk:') ||
                pageName === 'Main_Page') return;
          } else if (pathParts.length === 1 && pathParts[0] === 'Main_Page') return;
        }

        if (source.same_domain_only) {
          const baseDomain = baseUrl.hostname.replace(/^www\./, '');
          const linkDomain = linkUrl.hostname.replace(/^www\./, '');
          const isSameDomain =
            linkDomain === baseDomain ||
            linkDomain.endsWith('.' + baseDomain) ||
            baseDomain.endsWith('.' + linkDomain);
          if (!isSameDomain) return;
        }

        if (!source.include_pdfs && linkUrl.pathname.endsWith('.pdf')) return;
        if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:') return;

        links.push(normalizedUrl);
      } catch {
        // Invalid URL
      }
    });

    if (links.length < 10) {
      console.log(`[crawl] extractLinks WARNING: only ${links.length} links from page (${new URL(pageUrl).pathname?.slice(0, 50)})`);
    }
    return links;
  } catch (error) {
    console.error(`❌ Error extracting links:`, error);
    return [];
  }
}

async function updateJobStatus(
  jobId: string,
  status: CrawlJob['status'],
  errorMessage: string | null = null,
  startedAt: string | null = null,
  completedAt: string | null = null
) {
  const updates: any = {
    status,
    updated_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  };

  if (errorMessage !== null) {
    updates.error_message = errorMessage;
  }
  if (startedAt !== null) {
    updates.started_at = startedAt;
  }
  if (completedAt !== null) {
    updates.completed_at = completedAt;
  }

  await supabase
    .from('crawl_jobs')
    .update(updates)
    .eq('id', jobId);
}

/**
 * Atomically claim a queued job
 * Returns null if no job available or if claim failed
 */
export async function claimJob(): Promise<CrawlJob | null> {
  // First, check for stuck jobs (running but no heartbeat in 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stuckJobs } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('status', 'running')
    .lt('last_activity_at', fiveMinutesAgo)
    .limit(10);

  if (stuckJobs && stuckJobs.length > 0) {
    // Reset to queued so they can be claimed
    const stuckIds = stuckJobs.map(j => j.id);
    await supabase
      .from('crawl_jobs')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .in('id', stuckIds);
  }

  // Atomically claim a queued job
  // Get oldest queued job
  const { data: jobs, error: fetchError } = await supabase
    .from('crawl_jobs')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (fetchError) {
    console.error(`❌ Error fetching queued jobs:`, fetchError);
    console.error(`❌ Error details:`, JSON.stringify(fetchError, null, 2));
    return null;
  }

  // Log when no queued jobs (helps debug "crawl never started") - throttle to avoid spam
  if (!jobs || jobs.length === 0) {
    _noQueuedLogCounter++;
    const shouldLog = _noQueuedLogCounter <= 2 || _noQueuedLogCounter % 12 === 0;
    if (shouldLog) {
      const { data: allJobs, error: allError } = await supabase
        .from('crawl_jobs')
        .select('id, status, source_id, conversation_id, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
    if (allError) {
      console.log(`[worker] no queued jobs, fetch error (check DB connection):`, allError.message);
    } else if (!allJobs || allJobs.length === 0) {
      console.log(`[worker] no queued jobs, DB has 0 crawl_jobs (add a source to create one)`);
    } else {
      const summary = allJobs.map((j: any) => ({ id: j.id?.slice(0, 8), status: j.status, created: j.created_at?.slice(11, 19) }));
      console.log(`[worker] no queued jobs but ${allJobs.length} recent:`, summary);
      const queued = allJobs.filter((j: any) => j.status === 'queued');
      if (queued.length > 0) {
        console.log(`[worker] BUG: ${queued.length} queued in recent but claimJob missed them!`, queued.map((j: any) => j.id));
      }
    }
    }
    return null;
  }
  _noQueuedLogCounter = 0; // reset when we find a job
    
  // Log job details for debugging
  const jobToClaim = jobs[0];
  
  // Atomically update: only if still queued
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('crawl_jobs')
    .update({ 
      status: 'running',
      last_activity_at: now,
      updated_at: now
    })
    .eq('id', jobToClaim.id)
    .eq('status', 'queued') // Only update if still queued (atomic check)
    .select()
    .single();

  if (updateError || !updated) {
    console.log('[worker] claim failed (race or no longer queued)', {
      jobId: jobToClaim.id?.slice(0, 8),
      updateError: updateError?.message,
    });
    return null;
  }

  return updated as CrawlJob;
}
