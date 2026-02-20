import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from '../db';
import type { CrawlJob, Page, Source } from '../types';

export async function crawlPage(
  url: string,
  source: Source,
  job: CrawlJob,
  conversationId: string
): Promise<{ page: Page; html: string } | null> {
  if (!conversationId) {
    throw new Error(`conversationId is required for page insertion`);
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ScholiaCrawler/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const title = $('title').first().text().trim() ||
      $('h1').first().text().trim() ||
      'Untitled';

    const content = $('main, article, .content, #content')
      .first()
      .text()
      .trim()
      .substring(0, 50000) ||
      $('body').text().trim().substring(0, 50000);

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
      const isConvFk = error.code === '23503' && (detailsStr.includes('conversations') || (error.message || '').includes('conversations'));
      if (isConvFk) {
        throw new Error(`Conversation ${conversationId} was deleted. Cannot index pages.`);
      }

      const { data: existing } = await supabase
        .from('pages')
        .select('*')
        .eq('source_id', source.id)
        .eq('url', url)
        .single();

      if (existing) {
        return { page: existing as Page, html };
      }
      console.error('crawl: page insert failed', url.slice(0, 60), error.message);
      return null;
    }
    return { page: page as Page, html };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('crawl: page fetch failed', url.slice(0, 60), msg);
    return null;
  }
}
