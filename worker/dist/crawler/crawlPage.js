import * as cheerio from 'cheerio';
import fetch from 'node-fetch';
import { supabase } from '../db';
export async function crawlPage(url, source, job, conversationId) {
    if (!conversationId) {
        console.error(`❌ conversationId is required but was: ${conversationId}`);
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
                console.error(`[D/I] conversation_id FK violation - conversation was deleted, failing job`);
                throw new Error(`Conversation ${conversationId} was deleted. Cannot index pages.`);
            }
            console.error(`\n❌ ========== PAGE INSERTION FAILED ==========`);
            console.error(`❌ URL: ${url}`);
            console.error(`❌ Error code: ${error.code}`);
            console.error(`❌ Error message: ${error.message}`);
            console.error(`❌ ========== END PAGE INSERTION ERROR ==========\n`);
            const { data: existing } = await supabase
                .from('pages')
                .select('*')
                .eq('source_id', source.id)
                .eq('url', url)
                .single();
            if (existing) {
                console.log(`[D/I] PAGE duplicate - using existing pageId=${existing?.id?.slice(0, 8)}`);
                return { page: existing, html };
            }
            console.error(`[D/I] PAGE INSERT FAILED - returning null`);
            return null;
        }
        console.log(`[D/I] PAGE INSERT OK pageId=${page?.id?.slice(0, 8)} conv=${conversationId?.slice(0, 8)} url=${url.slice(0, 50)}`);
        return { page: page, html };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const isFetch = msg.includes('HTTP') || msg.includes('fetch') || msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT');
        console.error(`[D/I] crawlPage EXCEPTION - no page inserted url=${url.slice(0, 50)}`, { error: msg, isFetchError: isFetch });
        return null;
    }
}
//# sourceMappingURL=crawlPage.js.map