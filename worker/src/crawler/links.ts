import * as cheerio from 'cheerio';
import { CONTEXT_SNIPPET_LENGTH, isSkipSectionHeading, isWikiStyleDomain, MEDIAWIKI_NS_PREFIXES } from './constants';
import type { Source } from '../types';

function normalizeCurrentUrl(pageUrl: string): string {
  const currentUrlObj = new URL(pageUrl);
  currentUrlObj.hash = '';
  currentUrlObj.search = '';
  if (currentUrlObj.pathname === '/' || currentUrlObj.pathname === '') {
    currentUrlObj.pathname = '/';
  } else if (currentUrlObj.pathname.endsWith('/')) {
    currentUrlObj.pathname = currentUrlObj.pathname.slice(0, -1);
  }
  return currentUrlObj.toString();
}

function shouldSkipLinkUrl(linkUrl: URL, normalizedCurrentUrl: string, source: Source): boolean {
  if (linkUrl.toString() === normalizedCurrentUrl) return true;
  if (isWikiStyleDomain(linkUrl.hostname)) {
    const pathParts = linkUrl.pathname.split('/').filter((p) => p);
    if (pathParts.length >= 2 && pathParts[0] === 'wiki') {
      const pageName = decodeURIComponent(pathParts[1] || '');
      if (MEDIAWIKI_NS_PREFIXES.some((ns) => pageName.startsWith(ns)) || pageName === 'Main_Page') return true;
    } else if (pathParts.length === 1 && pathParts[0] === 'Main_Page') return true;
  }
  if (source.same_domain_only) {
    const baseUrl = new URL(normalizedCurrentUrl);
    const baseDomain = baseUrl.hostname.replace(/^www\./, '');
    const linkDomain = linkUrl.hostname.replace(/^www\./, '');
    const isSameDomain =
      linkDomain === baseDomain ||
      linkDomain.endsWith('.' + baseDomain) ||
      baseDomain.endsWith('.' + linkDomain);
    if (!isSameDomain) return true;
  }
  if (linkUrl.pathname.endsWith('.pdf')) return true;
  if (linkUrl.protocol !== 'http:' && linkUrl.protocol !== 'https:') return true;
  return false;
}

export function extractLinksWithContext(
  html: string,
  pageUrl: string,
  source: Source
): Array<{ url: string; snippet: string; anchorText: string }> {
  try {
    const $ = cheerio.load(html);
    const baseUrl = new URL(pageUrl);
    const seen = new Set<string>();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);

    const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
    const contentSelector = mainContent.length > 0 ? mainContent : $('body');
    contentSelector.find('h2, h3').each((_, el) => {
      const $el = $(el);
      if (isSkipSectionHeading($el.text())) {
        $el.nextUntil('h2, h3').addBack().addClass('crawl-skip-section');
      }
    });
    const linkElements = contentSelector.find('a[href]').not(function () {
      return $(this).closest('.crawl-skip-section').length > 0;
    });

    const result: Array<{ url: string; snippet: string; anchorText: string }> = [];

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
        if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source)) return;

        const anchorText = $(element).text().trim().replace(/\s+/g, ' ').substring(0, 100);
        let contextEl = $(element).closest('p, li, td, .mw-parser-output > div');
        if (contextEl.length === 0) {
          contextEl = $(element).parent();
        }
        const rawText = contextEl.first().text().trim().replace(/\s+/g, ' ');
        const pos = anchorText ? rawText.indexOf(anchorText) : -1;
        const half = Math.floor(CONTEXT_SNIPPET_LENGTH / 2);
        let snippet: string;
        if (pos >= 0) {
          if (pos < 50) snippet = rawText.slice(pos, Math.min(rawText.length, pos + CONTEXT_SNIPPET_LENGTH)).trim();
          else if (pos + anchorText.length > rawText.length - 50) snippet = rawText.slice(Math.max(0, rawText.length - CONTEXT_SNIPPET_LENGTH), rawText.length).trim();
          else snippet = rawText.slice(Math.max(0, pos - half), Math.min(rawText.length, pos + anchorText.length + half)).trim();
        } else {
          snippet = rawText.substring(0, CONTEXT_SNIPPET_LENGTH);
        }
        if (snippet.length < 20) {
          if (anchorText && anchorText.length >= 5) {
            snippet = anchorText.substring(0, CONTEXT_SNIPPET_LENGTH);
          } else {
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
      } catch {
        /* skip bad url */
      }
    });

    return result;
  } catch (error) {
    console.error('crawl: link extraction failed', error);
    return [];
  }
}

export function extractLinks(html: string, pageUrl: string, source: Source): string[] {
  try {
    const $ = cheerio.load(html);
    const baseUrl = new URL(pageUrl);
    const seen = new Set<string>();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);

    const mainContent = $('main, article, #content, #bodyContent, .mw-parser-output').first();
    const contentSelector = mainContent.length > 0 ? mainContent : $('body');
    contentSelector.find('h2, h3').each((_, el) => {
      const $el = $(el);
      if (isSkipSectionHeading($el.text())) {
        $el.nextUntil('h2, h3').addBack().addClass('crawl-skip-section');
      }
    });
    let linkElements = contentSelector.find('a[href]').not(function () {
      return $(this).closest('.crawl-skip-section').length > 0;
    });
    if (linkElements.length === 0) {
      linkElements = contentSelector.find('a[href]').length > 0 ? contentSelector.find('a[href]') : $('a[href]');
    }
    const links: string[] = [];

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
        if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source)) return;

        links.push(normalizedUrl);
      } catch {
        /* skip bad url */
      }
    });

    if (links.length < 10) {
      console.log('crawl: few links on page', links.length, new URL(pageUrl).pathname?.slice(0, 50));
    }
    return links;
  } catch (error) {
    console.error('crawl: link extraction failed', error);
    return [];
  }
}
