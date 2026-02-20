import * as cheerio from 'cheerio';
import { CONTEXT_SNIPPET_LENGTH, isWikiStyleDomain, MEDIAWIKI_NS_PREFIXES } from './constants';
function normalizeCurrentUrl(pageUrl) {
    const currentUrlObj = new URL(pageUrl);
    currentUrlObj.hash = '';
    currentUrlObj.search = '';
    if (currentUrlObj.pathname === '/' || currentUrlObj.pathname === '') {
        currentUrlObj.pathname = '/';
    }
    else if (currentUrlObj.pathname.endsWith('/')) {
        currentUrlObj.pathname = currentUrlObj.pathname.slice(0, -1);
    }
    return currentUrlObj.toString();
}
function shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source) {
    if (linkUrl.toString() === normalizedCurrentUrl)
        return true;
    if (isWikiStyleDomain(linkUrl.hostname)) {
        const pathParts = linkUrl.pathname.split('/').filter((p) => p);
        if (pathParts.length >= 2 && pathParts[0] === 'wiki') {
            const pageName = decodeURIComponent(pathParts[1] || '');
            if (MEDIAWIKI_NS_PREFIXES.some((ns) => pageName.startsWith(ns)) || pageName === 'Main_Page')
                return true;
        }
        else if (pathParts.length === 1 && pathParts[0] === 'Main_Page')
            return true;
    }
    if (source.same_domain_only) {
        const baseUrl = new URL(normalizedCurrentUrl);
        const baseDomain = baseUrl.hostname.replace(/^www\./, '');
        const linkDomain = linkUrl.hostname.replace(/^www\./, '');
        const isSameDomain = linkDomain === baseDomain ||
            linkDomain.endsWith('.' + baseDomain) ||
            baseDomain.endsWith('.' + linkDomain);
        if (!isSameDomain)
            return true;
    }
    if (linkUrl.pathname.endsWith('.pdf'))
        return true;
    if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:')
        return true;
    return false;
}
/**
 * For dynamic mode: extract links with ~200 chars of surrounding context for RAG.
 * Exported for addPageProcessor.
 */
export function extractLinksWithContext(html, pageUrl, source) {
    try {
        const $ = cheerio.load(html);
        const baseUrl = new URL(pageUrl);
        const seen = new Set();
        const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
        const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
        const contentSelector = mainContent.length > 0 ? mainContent : $('body');
        const linkElements = contentSelector.find('a[href]').length > 0
            ? contentSelector.find('a[href]')
            : $('a[href]');
        const result = [];
        linkElements.each((_, element) => {
            const href = $(element).attr('href');
            if (!href)
                return;
            const trimmedHref = href.trim();
            if (trimmedHref === '#' || (trimmedHref.startsWith('#') && !trimmedHref.startsWith('http')))
                return;
            try {
                const linkUrl = new URL(href, pageUrl);
                linkUrl.hash = '';
                linkUrl.search = '';
                if (linkUrl.pathname === '/' || linkUrl.pathname === '') {
                    linkUrl.pathname = '/';
                }
                else if (linkUrl.pathname.endsWith('/')) {
                    linkUrl.pathname = linkUrl.pathname.slice(0, -1);
                }
                const normalizedUrl = linkUrl.toString();
                if (seen.has(normalizedUrl))
                    return;
                seen.add(normalizedUrl);
                if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source))
                    return;
                const anchorText = $(element).text().trim().replace(/\s+/g, ' ').substring(0, 100);
                let contextEl = $(element).closest('p, li, td, .mw-parser-output > div');
                if (contextEl.length === 0) {
                    contextEl = $(element).parent();
                }
                const rawText = contextEl.first().text().trim().replace(/\s+/g, ' ');
                const pos = anchorText ? rawText.indexOf(anchorText) : -1;
                const half = Math.floor(CONTEXT_SNIPPET_LENGTH / 2);
                let snippet;
                if (pos >= 0) {
                    if (pos < 50)
                        snippet = rawText.slice(pos, Math.min(rawText.length, pos + CONTEXT_SNIPPET_LENGTH)).trim();
                    else if (pos + anchorText.length > rawText.length - 50)
                        snippet = rawText.slice(Math.max(0, rawText.length - CONTEXT_SNIPPET_LENGTH), rawText.length).trim();
                    else
                        snippet = rawText.slice(Math.max(0, pos - half), Math.min(rawText.length, pos + anchorText.length + half)).trim();
                }
                else {
                    snippet = rawText.substring(0, CONTEXT_SNIPPET_LENGTH);
                }
                if (snippet.length < 20) {
                    if (anchorText && anchorText.length >= 5) {
                        snippet = anchorText.substring(0, CONTEXT_SNIPPET_LENGTH);
                    }
                    else {
                        const pathParts = linkUrl.pathname.split('/').filter((p) => p);
                        const wikiTitle = pathParts[0] === 'wiki' && pathParts[1]
                            ? decodeURIComponent(pathParts[1].replace(/_/g, ' '))
                            : linkUrl.pathname;
                        snippet = wikiTitle ? `Link to ${wikiTitle}`.substring(0, CONTEXT_SNIPPET_LENGTH) : 'Link from page';
                    }
                }
                result.push({
                    url: normalizedUrl,
                    snippet,
                    anchorText,
                });
            }
            catch {
                // Invalid URL
            }
        });
        return result;
    }
    catch (error) {
        console.error(`❌ Error extracting links with context:`, error);
        return [];
    }
}
export function extractLinks(html, pageUrl, source) {
    try {
        const $ = cheerio.load(html);
        const baseUrl = new URL(pageUrl);
        const seen = new Set();
        const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
        const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
        const contentSelector = mainContent.length > 0 ? mainContent : $('body');
        const linkElements = contentSelector.find('a[href]').length > 0
            ? contentSelector.find('a[href]')
            : $('a[href]');
        const links = [];
        linkElements.each((_, element) => {
            const href = $(element).attr('href');
            if (!href)
                return;
            const trimmedHref = href.trim();
            if (trimmedHref === '#' || (trimmedHref.startsWith('#') && !trimmedHref.startsWith('http')))
                return;
            try {
                const linkUrl = new URL(href, pageUrl);
                linkUrl.hash = '';
                linkUrl.search = '';
                if (linkUrl.pathname === '/' || linkUrl.pathname === '') {
                    linkUrl.pathname = '/';
                }
                else if (linkUrl.pathname.endsWith('/')) {
                    linkUrl.pathname = linkUrl.pathname.slice(0, -1);
                }
                const normalizedUrl = linkUrl.toString();
                if (seen.has(normalizedUrl))
                    return;
                seen.add(normalizedUrl);
                if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source))
                    return;
                links.push(normalizedUrl);
            }
            catch {
                // Invalid URL
            }
        });
        if (links.length < 10) {
            console.log(`[crawl] extractLinks WARNING: only ${links.length} links from page (${new URL(pageUrl).pathname?.slice(0, 50)})`);
        }
        return links;
    }
    catch (error) {
        console.error(`❌ Error extracting links:`, error);
        return [];
    }
}
//# sourceMappingURL=links.js.map