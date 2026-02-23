import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from '../db';
import type { Page, Source } from '../types';
import {
  CRAWLER_USER_AGENT,
  DEFAULT_PAGE_TITLE,
  LOG_URL_MAX_LENGTH,
  MAIN_CONTENT_SELECTOR,
  MAX_PAGE_CONTENT_LENGTH,
  PAGE_TITLE_SUFFIX_REGEX,
} from './constants';
import { normalizeUrlForCrawl } from './urlUtils';

export async function crawlPage(
  url: string,
  source: Source,
  conversationId: string,
  existingInConversation?: Set<string>
): Promise<{ page: Page | null; html: string; inserted: boolean } | null> {
  if (!conversationId) {
    throw new Error(`conversationId is required for page insertion`);
  }

  try {
    const normalized = normalizeUrlForCrawl(url);
    const skip = existingInConversation?.has(normalized);
    if (skip) {
      const response = await fetch(url, { headers: { 'User-Agent': CRAWLER_USER_AGENT } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      console.log('[crawl] [crawlPage] SKIP (already in conversation)', {
        urlNorm: normalized.slice(-60),
        inputUrlTail: url.slice(-50),
      });
      return { page: null, html, inserted: false };
    }

    const response = await fetch(url, {
      headers: { 'User-Agent': CRAWLER_USER_AGENT },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const rawTitle = $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      DEFAULT_PAGE_TITLE;
    const title = rawTitle.replace(PAGE_TITLE_SUFFIX_REGEX, '').trim() || rawTitle;

    // Main content: try semantic/standard selectors (main, article, #content, #bodyContent, etc.); fall back to body if none match or text is empty
    const mainContent = $(MAIN_CONTENT_SELECTOR).first();
    const mainText = (mainContent.length > 0 ? mainContent.text() : $('body').text()).trim().substring(0, MAX_PAGE_CONTENT_LENGTH);
    const content = mainText || $('body').text().trim().substring(0, MAX_PAGE_CONTENT_LENGTH);

    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search;

    const insertData = {
      source_id: source.id,
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
      const detailsStr = typeof error.details === 'string' ? error.details : JSON.stringify(error.details || '');
      const msg = error.message || '';
      const isConvFk = error.code === '23503' && (detailsStr.includes('conversations') || msg.includes('conversations'));
      const isSourceFk = error.code === '23503' && (detailsStr.includes('source') || msg.includes('source_id') || msg.includes('sources'));
      if (isConvFk) {
        throw new Error(`Conversation ${conversationId} was deleted. Cannot index pages.`);
      }
      if (isSourceFk) {
        throw new Error(`Source ${source.id.slice(0, 8)} was deleted during crawl. Stopping.`);
      }

      const { data: existing } = await supabase
        .from('pages')
        .select('*')
        .eq('source_id', source.id)
        .eq('url', url)
        .single();

      if (existing) {
        console.log('[crawl] [crawlPage] INSERT conflict (existing for this source)', { urlNorm: normalized.slice(-60) });
        return { page: existing as Page, html, inserted: false };
      }
      console.error('crawl: page insert failed', url.slice(0, LOG_URL_MAX_LENGTH), error.message);
      return null;
    }
    console.log('[crawl] [crawlPage] INSERT new page', { pageId: (page as Page).id?.slice(0, 8), urlNorm: normalized.slice(-60) });
    return { page: page as Page, html, inserted: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('crawl: page fetch failed', url.slice(0, LOG_URL_MAX_LENGTH), msg);
    return null;
  }
}
