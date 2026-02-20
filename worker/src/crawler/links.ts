import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { CONTEXT_SNIPPET_LENGTH, MAIN_CONTENT_SELECTOR, isSkipSectionHeading, isWikiStyleDomain, MEDIAWIKI_NS_PREFIXES } from './constants';
import type { Source } from '../types';

function normalizeCurrentUrl(pageUrl: string): string {
  const u = new URL(pageUrl);
  u.hash = '';
  u.search = '';
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/';
  else if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

function normalizeLinkUrl(href: string, baseUrl: string): { url: URL; normalized: string } | null {
  try {
    const u = new URL(href, baseUrl);
    u.hash = '';
    u.search = '';
    if (u.pathname === '/' || u.pathname === '') u.pathname = '/';
    else if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return { url: u, normalized: u.toString() };
  } catch {
    return null;
  }
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

function getContentSelector($: CheerioAPI) {
  const main = $(MAIN_CONTENT_SELECTOR).first();
  return main.length > 0 ? main : $('body');
}

function markSkipSectionsAndGetLinkElements($: CheerioAPI, contentSelector: ReturnType<typeof getContentSelector>) {
  contentSelector.find('h2, h3').each((_, el) => {
    const $el = $(el);
    if (isSkipSectionHeading($el.text())) {
      $el.nextUntil('h2, h3').addBack().addClass('crawl-skip-section');
    }
  });
  return contentSelector.find('a[href]').not(function () {
    return $(this).closest('.crawl-skip-section').length > 0;
  });
}

export function extractLinksWithContext(
  html: string,
  pageUrl: string,
  source: Source
): Array<{ url: string; snippet: string; anchorText: string }> {
  try {
    const $ = cheerio.load(html);
    const seen = new Set<string>();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
    const contentSelector = getContentSelector($);
    const linkElements = markSkipSectionsAndGetLinkElements($, contentSelector);
    const result: Array<{ url: string; snippet: string; anchorText: string }> = [];

    linkElements.each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const parsed = normalizeLinkUrl(href.trim(), pageUrl);
      if (!parsed) return;
      const { url: linkUrl, normalized: normalizedUrl } = parsed;

      if (seen.has(normalizedUrl)) return;
      seen.add(normalizedUrl);
      if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source)) return;

      const anchorText = $(element).text().trim().replace(/\s+/g, ' ').substring(0, 100);
      let contextEl = $(element).closest('p, li, td, .mw-parser-output > div');
      if (contextEl.length === 0) contextEl = $(element).parent();
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

      result.push({ url: normalizedUrl, snippet, anchorText });
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
    const seen = new Set<string>();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
    const contentSelector = getContentSelector($);
    let linkElements = markSkipSectionsAndGetLinkElements($, contentSelector);
    if (linkElements.length === 0) {
      linkElements = contentSelector.find('a[href]').length > 0 ? contentSelector.find('a[href]') : $('a[href]');
    }
    const links: string[] = [];

    linkElements.each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      const parsed = normalizeLinkUrl(href.trim(), pageUrl);
      if (!parsed) return;
      const { url: linkUrl, normalized: normalizedUrl } = parsed;

      if (seen.has(normalizedUrl)) return;
      seen.add(normalizedUrl);
      if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source)) return;

      links.push(normalizedUrl);
    });

    return links;
  } catch (error) {
    console.error('crawl: link extraction failed', error);
    return [];
  }
}
