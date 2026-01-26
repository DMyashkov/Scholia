import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import RobotsParser from 'robots-parser';
import { supabase } from './db';
import type { CrawlJob, Source, Page, PageEdge } from './types';

const MAX_PAGES: Record<Source['crawl_depth'], number> = {
  shallow: 5,
  medium: 15,
  deep: 35,
};

export async function processCrawlJob(jobId: string) {

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

    // Check if job is still queued or running (might have been claimed)
    if (job.status !== 'queued' && job.status !== 'running') {
      console.log(`⏭️  Job ${jobId} is ${job.status}, skipping`);
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

    console.log(`🎯 Processing job ${jobId} for source: ${source.url}`);
    
    // Update job to running (if not already)
    if (job.status !== 'running') {
      await updateJobStatus(jobId, 'running', null, new Date().toISOString());
    }

    // Start crawling
    await crawlSource(job, source);

    // Mark as completed
    await updateJobStatus(jobId, 'completed', null, null, new Date().toISOString());

  } catch (error) {
    console.error(`❌ Error processing job ${jobId}:`, error);
    await updateJobStatus(
      jobId,
      'failed',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function crawlSource(job: CrawlJob, source: Source) {
  // Get conversation_id from the job (stored when job was created)
  // This is more reliable than querying conversation_sources
  const conversationId = job.conversation_id;
  
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
    
    console.log(`📋 Using fallback conversation_id: ${fallbackConversationId}`);
    return crawlSourceWithConversationId(job, source, fallbackConversationId);
  }
  
  console.log(`📋 Crawling for conversation: ${conversationId}`);
  return crawlSourceWithConversationId(job, source, conversationId);
}

async function crawlSourceWithConversationId(job: CrawlJob, source: Source, conversationId: string) {

  const maxPages = MAX_PAGES[source.crawl_depth];
  const visited = new Set<string>();
  const discovered = new Set<string>(); // All discovered URLs (including queued)
  const queue: Array<{ url: string; depth: number }> = [{ url: source.url, depth: 0 }];
  discovered.add(source.url);
  let linksCount = 0;

  console.log(`🕷️  Starting crawl for source ${source.id}: ${source.url} (max: ${maxPages} pages)`);

  // Update source title from first page crawled
  let sourceTitleUpdated = false;

  // Fetch robots.txt
  let robotsParser: any = null;
  try {
    const robotsUrl = new URL('/robots.txt', source.url).toString();
    const robotsResponse = await fetch(robotsUrl);
    if (robotsResponse.ok) {
      const robotsText = await robotsResponse.text();
      robotsParser = RobotsParser(robotsUrl, robotsText);
      console.log(`✅ Loaded robots.txt for ${source.domain}`);
    }
  } catch (error) {
    console.warn(`⚠️  Failed to fetch robots.txt for ${source.url}:`, error);
  }

  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift()!;

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
      console.log(`🚫 Blocked by robots.txt: ${normalizedUrl}`);
      continue;
    }

    try {
      console.log(`📄 Fetching [${visited.size + 1}/${maxPages}]: ${normalizedUrl}`);
      console.log(`🔗 About to call crawlPage with conversationId: ${conversationId} (exists: ${!!conversationId})`);
      if (!conversationId) {
        throw new Error(`conversationId is null before calling crawlPage!`);
      }
      const result = await crawlPage(normalizedUrl, source, job, conversationId);
      if (result) {
        const { page, html } = result;
        visited.add(normalizedUrl);
        
        // Update source title from first page (use page title instead of domain)
        if (!sourceTitleUpdated && page.title) {
          const pageTitle = page.title.replace(/\s*-\s*Wikipedia.*$/i, '').trim(); // Remove " - Wikipedia" suffix
          if (pageTitle && pageTitle !== source.domain && pageTitle.length > 0) {
            try {
              await supabase
                .from('sources')
                .update({ domain: pageTitle.substring(0, 100) }) // Limit length
                .eq('id', source.id);
              source.domain = pageTitle.substring(0, 100);
              console.log(`📝 Updated source title to: ${pageTitle}`);
              sourceTitleUpdated = true;
            } catch (err) {
              console.warn(`⚠️  Failed to update source title:`, err);
            }
          }
        }

        // Extract links BEFORE updating progress (so we count discovered)
        console.log(`🔍 Starting link extraction from ${normalizedUrl}...`);
        const startTime = Date.now();
        const links = extractLinks(html, normalizedUrl, source);
        const extractionTime = Date.now() - startTime;
        const newLinks: string[] = [];
        const edgesToInsert: Array<{conversation_id: string; source_id: string; from_url: string; to_url: string; owner_id: string | null}> = [];
        
        console.log(`🔗 Found ${links.length} links from ${normalizedUrl} (took ${extractionTime}ms)`);
        
        // Links are already sorted with priority first (from extractLinks)
        // Take first 200 links (which includes priority links first)
        const linksToProcess = links.slice(0, 200);
        
        if (links.length > 200) {
          console.log(`⚠️  Limiting to ${linksToProcess.length} links (${links.length} total found)`);
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
          edgesToInsert.push({
            conversation_id: conversationId,
            source_id: source.id,
            from_url: normalizedUrl,
            to_url: normalizedLink,
            owner_id: source.owner_id,
          });
          
          if (!discovered.has(normalizedLink)) {
            discovered.add(normalizedLink);
            newLinks.push(normalizedLink);
            
            // Add to queue if we haven't reached max pages
            // Always add if we haven't reached max, regardless of include_subpages (that's for filtering, not queueing)
            if (visited.size + queue.length < maxPages && depth < 2) {
              queue.push({ url: normalizedLink, depth: depth + 1 });
              // Only log every 10th queued link to avoid spam
              if (newLinks.length % 10 === 0) {
                console.log(`➕ Queued ${newLinks.length} links so far (queue: ${queue.length}, visited: ${visited.size})`);
              }
            }
          }
        }
        
        // Batch insert all edges at once (much faster)
        // Use smaller batches (100 at a time) to avoid timeouts
        if (edgesToInsert.length > 0) {
          console.log(`💾 Batch inserting ${edgesToInsert.length} edges...`);
          const edgeStart = Date.now();
          try {
            const batchSize = 100;
            let successCount = 0;
            
            for (let i = 0; i < edgesToInsert.length; i += batchSize) {
              const chunk = edgesToInsert.slice(i, i + batchSize);
              const { error: batchError } = await supabase
                .from('page_edges')
                .insert(chunk);
              
              if (batchError) {
                // If chunk fails, try individual inserts for that chunk (might be duplicates)
                if (batchError.code === '23505' || batchError.message.includes('duplicate')) {
                  // Duplicates are fine, count as success
                  successCount += chunk.length;
                } else {
                  // Non-duplicate error, try individual inserts
                  for (const edge of chunk) {
                    try {
                      const { error: edgeError } = await supabase.from('page_edges').insert(edge);
                      if (!edgeError || edgeError.code === '23505') {
                        successCount++;
                      }
                    } catch (e: any) {
                      // Ignore duplicates
                      if (e?.code === '23505') {
                        successCount++;
                      }
                    }
                  }
                }
              } else {
                successCount += chunk.length;
              }
            }
            
            linksCount += successCount;
            const edgeTime = Date.now() - edgeStart;
            console.log(`✅ Inserted ${successCount}/${edgesToInsert.length} edges in ${edgeTime}ms`);
          } catch (edgeError: any) {
            console.warn(`⚠️  Error inserting edges: ${edgeError?.message}`);
            // Continue anyway - edges are nice to have but not critical
            linksCount += Math.floor(edgesToInsert.length * 0.8); // Estimate
          }
        }

        // Update job progress with all counters
        await supabase
          .from('crawl_jobs')
          .update({ 
            discovered_count: discovered.size,
            indexed_count: visited.size,
            links_count: linksCount,
            last_activity_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', job.id);

        console.log(`✅ Indexed [${visited.size}/${maxPages}]: ${page.title || 'Untitled'} (${linksToProcess.length} links processed, ${newLinks.length} new, queue: ${queue.length}, discovered: ${discovered.size})`);

        // Small delay to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`❌ Error crawling ${url}:`, error);
      // Continue with next page
    }
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

  console.log(`🎉 Crawl complete: ${visited.size} pages indexed, ${discovered.size} discovered, ${linksCount} edges`);
}

async function crawlPage(url: string, source: Source, job: CrawlJob, conversationId: string): Promise<{ page: Page; html: string } | null> {
  // Validate conversationId
  console.log(`🔍 crawlPage called with conversationId: ${conversationId} (type: ${typeof conversationId})`);
  if (!conversationId) {
    console.error(`❌ conversationId is required but was: ${conversationId}`);
    throw new Error(`conversationId is required for page insertion`);
  }

  try {
    console.log(`🌐 Fetching ${url}...`);
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

    console.log(`📥 Downloading HTML...`);
    const html = await response.text();
    const fetchTime = Date.now() - fetchStart;
    console.log(`✅ Downloaded ${(html.length / 1024).toFixed(1)}KB in ${fetchTime}ms`);
    
    console.log(`🔧 Loading into cheerio...`);
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
    
    console.log(`💾 Inserting page with conversation_id: ${conversationId}, source_id: ${source.id}`);
    
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
    
    console.log(`📝 Insert data:`, { 
      source_id: insertData.source_id, 
      conversation_id: insertData.conversation_id,
      url: insertData.url,
      hasContent: !!insertData.content 
    });
    
    const { data: page, error } = await supabase
      .from('pages')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      // Might be duplicate, try to get existing (check by conversation_id too)
      const { data: existing } = await supabase
        .from('pages')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('source_id', source.id)
        .eq('url', url)
        .single();

      if (existing) {
        return { page: existing as Page, html };
      }
      throw error;
    }

    return { page: page as Page, html };
  } catch (error) {
    console.error(`Failed to crawl page ${url}:`, error);
    return null;
  }
}

function extractLinks(html: string, pageUrl: string, source: Source): string[] {
  try {
    console.log(`📝 Parsing HTML (${(html.length / 1024).toFixed(1)}KB)...`);
    const parseStart = Date.now();
    const $ = cheerio.load(html);
    const parseTime = Date.now() - parseStart;
    console.log(`✅ HTML parsed in ${parseTime}ms`);
    
    // Find main content area (prioritize links in main content)
    const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
    const hasMainContent = mainContent.length > 0;
    const contentSelector = hasMainContent ? mainContent : $('body');
    
    // For proximity-based prioritization, get the first few paragraphs/sections
    // Links that appear early in the content are more relevant
    const firstContent = contentSelector.find('p, h1, h2, h3, .mw-parser-output > p, .mw-parser-output > h2').slice(0, 10);
    const earlyContentSelector = firstContent.length > 0 ? firstContent : contentSelector;
    
    const links: string[] = [];
    const priorityLinks: string[] = []; // Links in main content
    const earlyLinks: string[] = []; // Links in first paragraphs (highest priority)
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

    console.log(`🔍 Extracting links from ${pageUrl}...`);
    let totalLinksFound = 0;
    let skippedAnchor = 0;
    let skippedSamePage = 0;
    let skippedDomain = 0;
    let skippedPdf = 0;
    let skippedProtocol = 0;
    let added = 0;

    // Extract links from early content first (highest priority), then main content, then all
    const earlyContentLinks = earlyContentSelector.find('a[href]');
    const mainContentLinks = contentSelector.find('a[href]');
    const allLinks = $('a[href]');
    console.log(`📊 Found ${allLinks.length} total links (${mainContentLinks.length} in main content, ${earlyContentLinks.length} in first paragraphs)`);
    
    // Process early content links first for proximity-based prioritization
    const linkElements = earlyContentLinks.length > 0 ? earlyContentLinks : (mainContentLinks.length > 0 ? mainContentLinks : allLinks);
    let processedCount = 0;
    const logInterval = 500; // Log every 500 links to reduce spam
    
    linkElements.each((_, element) => {
      processedCount++;
      if (processedCount % logInterval === 0) {
        console.log(`  ⏳ Processed ${processedCount}/${linkElements.length} links...`);
      }
      const href = $(element).attr('href');
      if (!href) return;
      totalLinksFound++;

      // Skip anchor-only links (just # or starting with #)
      const trimmedHref = href.trim();
      if (trimmedHref === '#' || (trimmedHref.startsWith('#') && !trimmedHref.startsWith('http'))) {
        skippedAnchor++;
        return;
      }

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
        if (normalizedUrl === normalizedCurrentUrl) {
          skippedSamePage++;
          return;
        }
        
        // Filter out Wikipedia meta pages (Wikipedia:, Wikipedia_talk:, Special:, Portal:, Help:, etc.)
        if (linkUrl.hostname.includes('wikipedia.org')) {
          // For Wikipedia, the pathname is like /wiki/Page_Name or /wiki/Wikipedia:Namespace
          const pathParts = linkUrl.pathname.split('/').filter(p => p);
          if (pathParts.length >= 2 && pathParts[0] === 'wiki') {
            const pageName = decodeURIComponent(pathParts[1] || '');
            // Skip Wikipedia namespace pages and meta pages
            if (pageName.startsWith('Wikipedia:') || 
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
                pageName === 'Main_Page') {
              skippedDomain++; // Reuse counter for meta pages
              return;
            }
          } else if (pathParts.length === 1 && pathParts[0] === 'Main_Page') {
            skippedDomain++;
            return;
          }
        }
        
        // Apply filters
        if (source.same_domain_only) {
          // Allow same domain and subdomains (e.g., en.wikipedia.org and wikipedia.org)
          const baseDomain = baseUrl.hostname.replace(/^www\./, '');
          const linkDomain = linkUrl.hostname.replace(/^www\./, '');
          
          // Check if it's the same base domain, a subdomain, or parent domain
          // Examples:
          // - en.wikipedia.org matches en.wikipedia.org (exact)
          // - en.wikipedia.org matches wikipedia.org (parent)
          // - wikipedia.org matches en.wikipedia.org (subdomain)
          const isSameDomain = 
            linkDomain === baseDomain || 
            linkDomain.endsWith('.' + baseDomain) ||
            baseDomain.endsWith('.' + linkDomain);
          
          if (!isSameDomain) {
            skippedDomain++;
            return;
          }
        }

        if (!source.include_pdfs && linkUrl.pathname.endsWith('.pdf')) {
          skippedPdf++;
          return;
        }

        // Only HTTP/HTTPS links
        if (linkUrl.protocol === 'http:' || linkUrl.protocol === 'https:') {
          // Highest priority: links in first paragraphs (proximity to source)
          if (earlyContentSelector.find(element).length > 0 || $(element).closest('p, h1, h2, h3').length > 0 && $(element).closest('main, article, #content, #bodyContent, .mw-parser-output').length > 0) {
            // Check if it's in the first few paragraphs
            const isEarly = $(element).closest('p, h1, h2, h3').index() < 10 || 
                           $(element).closest('.mw-parser-output > p, .mw-parser-output > h2').index() < 10;
            if (isEarly) {
              earlyLinks.push(normalizedUrl);
            } else if (hasMainContent && $(element).closest('main, article, #content, #bodyContent, .mw-parser-output').length > 0) {
              priorityLinks.push(normalizedUrl);
            } else {
              links.push(normalizedUrl);
            }
          } else if (hasMainContent && $(element).closest('main, article, #content, #bodyContent, .mw-parser-output').length > 0) {
            priorityLinks.push(normalizedUrl);
          } else {
            links.push(normalizedUrl);
          }
          added++;
        } else {
          skippedProtocol++;
        }
      } catch (urlError) {
        // Invalid URL, skip
        console.log(`⚠️  Invalid URL skipped: ${href}`);
      }
    });

    // Return links in priority order: early content first (proximity), then main content, then others
    // This ensures we crawl links "close to the source" first
    const allValidLinks = [...earlyLinks, ...priorityLinks, ...links];
    const summary = `📊 Link extraction summary: ${totalLinksFound} total, ${added} added (${earlyLinks.length} early, ${priorityLinks.length} main content), ${skippedAnchor} anchor-only, ${skippedSamePage} same-page, ${skippedDomain} filtered, ${skippedPdf} PDF, ${skippedProtocol} wrong-protocol`;
    console.log(summary);
    console.log(`✅ Returning ${allValidLinks.length} valid links (${earlyLinks.length} from first paragraphs, ${priorityLinks.length} from main content)`);
    return allValidLinks;
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
    console.log(`🔄 Reclaiming ${stuckJobs.length} stuck job(s)`);
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

  if (fetchError || !jobs || jobs.length === 0) {
    return null;
  }

  const job = jobs[0];
  
  // Atomically update: only if still queued
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('crawl_jobs')
    .update({ 
      status: 'running',
      last_activity_at: now,
      updated_at: now
    })
    .eq('id', job.id)
    .eq('status', 'queued') // Only update if still queued (atomic check)
    .select()
    .single();

  if (updateError || !updated) {
    // Job was claimed by another worker or no longer queued
    return null;
  }

  console.log(`✅ Claimed job: ${updated.id} for source: ${updated.source_id}`);
  return updated as CrawlJob;
}
