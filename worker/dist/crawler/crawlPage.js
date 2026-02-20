import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from '../db';
import { CRAWLER_USER_AGENT, DEFAULT_PAGE_TITLE, LOG_URL_MAX_LENGTH, MAIN_CONTENT_SELECTOR, MAX_PAGE_CONTENT_LENGTH, PAGE_TITLE_SUFFIX_REGEX, } from './constants';
export async function crawlPage(url, source, conversationId) {
    if (!conversationId) {
        throw new Error(`conversationId is required for page insertion`);
    }
    try {
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
            status: 'indexed',
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
                return { page: existing, html };
            }
            console.error('crawl: page insert failed', url.slice(0, LOG_URL_MAX_LENGTH), error.message);
            return null;
        }
        return { page: page, html };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('crawl: page fetch failed', url.slice(0, LOG_URL_MAX_LENGTH), msg);
        return null;
    }
}
//# sourceMappingURL=crawlPage.js.map