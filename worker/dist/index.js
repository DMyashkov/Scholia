// src/db.ts
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "..", "..", ".env") });
var supabaseUrl = process.env.SUPABASE_URL || "";
var supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables");
}
var supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
var urlDisplay = supabaseUrl ? supabaseUrl.replace(/^https?:\/\//, "").slice(0, 50) : "NOT SET";

// src/crawler/crawlSource.ts
import fetch4 from "node-fetch";
import RobotsParser from "robots-parser";

// src/indexer.ts
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// src/targetLead.ts
import * as cheerio from "cheerio";
import fetch2 from "node-fetch";

// src/crawler/constants.ts
var MAIN_CONTENT_SELECTOR = "main, article, .content, #content, #bodyContent, .mw-parser-output";
var MAX_PAGE_CONTENT_LENGTH = 5e4;
var CRAWLER_USER_AGENT = "ScholiaCrawler/1.0";
var DEFAULT_PAGE_TITLE = "Untitled";
var LOG_URL_MAX_LENGTH = 60;
var MAX_PAGES = {
  shallow: 5,
  medium: 15,
  deep: 35,
  singular: 1,
  dynamic: 1
};
var PAGE_TITLE_SUFFIXES = [
  "Wikipedia",
  "Wikidata",
  "Wikimedia",
  "MDN",
  "Fandom",
  "Medium",
  "Substack",
  "GitHub",
  "Notion",
  "Reddit",
  "GOV.UK",
  "NHS",
  "BBC"
];
var _suffixAlternation = PAGE_TITLE_SUFFIXES.map(
  (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
).join("|");
var PAGE_TITLE_SUFFIX_REGEX = new RegExp(
  `\\s*[\u2013\\-|]\\s*(${_suffixAlternation})\\s*$`,
  "i"
);
var WIKI_STYLE_DOMAINS = ["wikipedia.org", "wikimedia.org"];
function isWikiStyleDomain(hostname) {
  return WIKI_STYLE_DOMAINS.some((d) => hostname.includes(d));
}
var MEDIAWIKI_NS_PREFIXES = [
  "Wikipedia:",
  "Wikipedia_talk:",
  "Special:",
  "Portal:",
  "Help:",
  "Template:",
  "Category:",
  "File:",
  "Media:",
  "Talk:",
  "User:",
  "User_talk:"
];
var CONTEXT_SNIPPET_LENGTH = 200;
var MAX_LINKS_PER_PAGE_DYNAMIC = 200;
var SKIP_SECTION_HEADINGS = [
  "references",
  "citations",
  "external links",
  "further reading",
  "bibliography",
  "notes",
  "sources"
];
var LINK_SKIP_CONTAINER_SELECTORS = '[role="note"], .hatnote';
var DISAMBIGUATION_PATH_MARKER = "(disambiguation)";
function isSkipSectionHeading(text) {
  const t = text.trim().toLowerCase();
  return SKIP_SECTION_HEADINGS.some(
    (h) => t === h || t.startsWith(h + " ") || t.startsWith(h + "(")
  );
}

// src/targetLead.ts
function stripLeadFluff(text) {
  let s = text.trim();
  if (!s) return "";
  while (/\.[^{]+\{[^}]*\}/.test(s)) {
    s = s.replace(/\.[^{]+\{[^}]*\}/g, "").trim();
  }
  s = s.replace(/^[\d.°′″\s/;:-]+[NS]\s*[\d.°′″\s/;:-]+[EW][\s/;.-]*/gi, "").trim();
  s = s.replace(/^[\d.-]+\s*;\s*[\d.-]+[\s.]*/g, "").trim();
  s = s.replace(/\bFrom\s+[^,]+,\s*the\s+free\s+encyclopedia\.?\s*/gi, "").trim();
  const lines = s.split("\n");
  const filtered = lines.filter((line) => {
    const t = line.trim();
    return t && !(t.includes("{") && t.includes("}"));
  });
  s = filtered.join("\n").trim();
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
async function fetchTargetPageLead(url) {
  try {
    const res = await fetch2(url, {
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      redirect: "follow"
    });
    if (!res.ok) return "";
    const html = await res.text();
    const $ = cheerio.load(html);
    const mainContent = $(MAIN_CONTENT_SELECTOR).first().text().trim() || $("body").text().trim();
    const cleaned = stripLeadFluff(mainContent);
    return cleaned.substring(0, CONTEXT_SNIPPET_LENGTH).trim() || cleaned.substring(0, CONTEXT_SNIPPET_LENGTH);
  } catch {
    return "";
  }
}

// src/indexer.ts
var OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
var CHUNK_MAX_CHARS = 600;
var CHUNK_OVERLAP_CHARS = 100;
var EMBED_BATCH_SIZE = 10;
var textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_MAX_CHARS,
  chunkOverlap: CHUNK_OVERLAP_CHARS
});
var DISCOVERED_PROGRESS_INTERVAL_MS = 1200;
var DEFAULT_LINK_SNIPPET = "Link from page";
var OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
function buildPagePrefix(title, url) {
  const parts = [];
  if (title) parts.push(title);
  if (url) parts.push(url);
  return parts.length > 0 ? `Page: ${parts.join(" | ")}
` : "";
}
async function embedAndInsertChunks(chunkSpecs, apiKey, options) {
  let inserted = 0;
  for (let i = 0; i < chunkSpecs.length; i += EMBED_BATCH_SIZE) {
    const batchSpecs = chunkSpecs.slice(i, i + EMBED_BATCH_SIZE);
    const texts = batchSpecs.map((c) => c.embed_text ?? c.content);
    const embeddings = await embedBatch(apiKey, texts);
    if (embeddings.length !== batchSpecs.length) {
      break;
    }
    const rows = batchSpecs.map((c, j) => ({
      page_id: c.page_id,
      content: c.content,
      start_index: c.start_index,
      end_index: c.end_index,
      embedding: embeddings[j],
      owner_id: c.owner_id
    }));
    const { error } = await supabase.from("chunks").insert(rows);
    if (error) {
      break;
    }
    inserted += rows.length;
    await options.onProgress?.(inserted);
  }
  return inserted;
}
async function indexChunkSpecsForRag(chunkSpecs, apiKey, options) {
  if (chunkSpecs.length === 0) return { chunksCreated: 0 };
  const { crawlJobId, conversationId, sourceId, addPageStyle, pageCount } = options;
  const totalChunks = chunkSpecs.length;
  if (crawlJobId) {
    await supabase.from("crawl_jobs").update(
      addPageStyle ? {
        encoding_chunks_total: totalChunks,
        encoding_chunks_done: 0,
        status: "encoding",
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      } : { encoding_chunks_total: totalChunks, encoding_chunks_done: 0 }
    ).eq("id", crawlJobId);
  }
  const inserted = await embedAndInsertChunks(chunkSpecs, apiKey, {
    onProgress: crawlJobId ? async (done) => {
      await supabase.from("crawl_jobs").update({
        encoding_chunks_done: done,
        ...addPageStyle ? { updated_at: (/* @__PURE__ */ new Date()).toISOString() } : { last_activity_at: (/* @__PURE__ */ new Date()).toISOString() }
      }).eq("id", crawlJobId);
    } : void 0
  });
  let discoveredEmbedded = 0;
  if (conversationId) {
    discoveredEmbedded = await embedDiscoveredLinks(conversationId, apiKey, crawlJobId, sourceId);
  }
  return { chunksCreated: inserted + discoveredEmbedded };
}
async function buildChunkSpecsFromPages(pages) {
  const chunkSpecs = [];
  for (const page of pages) {
    const text = (page.content || "").trim();
    if (!text) continue;
    const prefix = buildPagePrefix(page.title ?? void 0, page.url ?? void 0);
    const pageChunks = await textSplitter.splitText(text);
    for (const content of pageChunks) {
      chunkSpecs.push({
        page_id: page.id,
        content,
        ...prefix ? { embed_text: prefix + content } : {},
        start_index: null,
        end_index: null,
        owner_id: page.owner_id
      });
    }
  }
  return chunkSpecs;
}
async function buildChunkSpecsFromSinglePage(pageId, content, ownerId, title, url) {
  const text = (content || "").trim();
  if (!text) return [];
  const prefix = buildPagePrefix(title, url);
  const pageChunks = await textSplitter.splitText(text);
  return pageChunks.map((c) => ({
    page_id: pageId,
    content: c,
    ...prefix ? { embed_text: prefix + c } : {},
    start_index: null,
    end_index: null,
    owner_id: ownerId
  }));
}
async function indexSourceForRag(sourceId, crawlJobId, conversationId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { chunksCreated: 0 };
  }
  const { data: pages, error: pagesError } = await supabase.from("pages").select("id, content, owner_id, title, url").eq("source_id", sourceId).eq("status", "indexed").not("content", "is", null);
  if (pagesError) {
    return { chunksCreated: 0 };
  }
  if (!pages?.length) {
    return { chunksCreated: 0 };
  }
  const chunkSpecs = await buildChunkSpecsFromPages(pages);
  return indexChunkSpecsForRag(chunkSpecs, apiKey, {
    crawlJobId,
    conversationId,
    sourceId,
    pageCount: pages.length,
    logLabel: `(source ${sourceId.slice(0, 8)})`
  });
}
async function indexSinglePageForRag(pageId, content, ownerId, crawlJobId, title, url) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { chunksCreated: 0 };
  }
  const chunkSpecs = await buildChunkSpecsFromSinglePage(pageId, content, ownerId, title, url);
  return indexChunkSpecsForRag(chunkSpecs, apiKey, {
    crawlJobId,
    addPageStyle: true,
    pageCount: 1
  });
}
async function embedDiscoveredLinksForPage(conversationId, pageId, apiKey, crawlJobId, ownerId) {
  const indexedUrls = await getIndexedPageUrlsForPage(pageId);
  const { data: edgeRows } = await supabase.from("page_edges").select("id, to_url").eq("from_page_id", pageId);
  const edgeIds = (edgeRows ?? []).map((r) => r.id);
  if (edgeIds.length === 0) {
    return 0;
  }
  const { data: links, error: fetchError } = await supabase.from("encoded_discovered").select("id, snippet, page_edge_id").in("page_edge_id", edgeIds).is("embedding", null);
  if (fetchError) {
    return 0;
  }
  if (!links?.length) {
    return 0;
  }
  const edgeIdToUrl = new Map((edgeRows ?? []).map((r) => [r.id, r.to_url]));
  const toEmbed = links.filter((l) => {
    const url = edgeIdToUrl.get(l.page_edge_id) || "";
    return !indexedUrls.has(normalizeUrlForCompare(url));
  });
  const total = toEmbed.length;
  if (crawlJobId) {
    const { data: jobRow } = await supabase.from("crawl_jobs").select("encoding_discovered_total, encoding_discovered_done").eq("id", crawlJobId).single();
    const prevTotal = jobRow?.encoding_discovered_total ?? 0;
    if (prevTotal !== total) {
      await supabase.from("crawl_jobs").update({
        encoding_discovered_total: total,
        encoding_discovered_done: 0,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", crawlJobId);
    }
  }
  if (toEmbed.length === 0) {
    return 0;
  }
  const { data: pageRow } = await supabase.from("pages").select("source_id").eq("id", pageId).single();
  const sourceId = pageRow?.source_id;
  const { data: sourceRow } = sourceId ? await supabase.from("sources").select("suggestion_mode").eq("id", sourceId).single() : { data: null };
  const useDive = sourceRow?.suggestion_mode === "dive";
  const BATCH_SIZE = useDive ? 1 : EMBED_BATCH_SIZE;
  let updated = 0;
  let lastProgressUpdate = Date.now();
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = [];
    for (const item of batch) {
      let text = item.snippet;
      if (useDive) {
        const url = edgeIdToUrl.get(item.page_edge_id) || "";
        const lead = await fetchTargetPageLead(url);
        if (lead) {
          text = lead;
          await supabase.from("encoded_discovered").update({ snippet: text }).eq("id", item.id);
        }
      }
      texts.push(text || DEFAULT_LINK_SNIPPET);
    }
    const embeddings = await embedBatch(apiKey, texts);
    if (embeddings.length !== batch.length) break;
    for (let j = 0; j < batch.length; j++) {
      const { error } = await supabase.from("encoded_discovered").update({ embedding: embeddings[j] }).eq("id", batch[j].id);
      if (!error) updated++;
    }
    const now = Date.now();
    await supabase.from("crawl_jobs").update({
      encoding_discovered_done: updated,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", crawlJobId);
    if (now - lastProgressUpdate >= DISCOVERED_PROGRESS_INTERVAL_MS) lastProgressUpdate = now;
  }
  if (updated > 0) {
    await supabase.from("crawl_jobs").update({
      encoding_discovered_done: updated,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", crawlJobId);
    const skipped = links.length - toEmbed.length;
  }
  return updated;
}
function normalizeUrlForCompare(url) {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    u.hash = "";
    u.search = "";
    let path2 = u.pathname;
    if (path2 !== "/" && path2.endsWith("/")) path2 = path2.slice(0, -1);
    return (u.origin + path2).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
async function getIndexedPageUrlsForPage(pageId) {
  const { data: page } = await supabase.from("pages").select("source_id").eq("id", pageId).single();
  const sourceId = page?.source_id;
  if (!sourceId) return /* @__PURE__ */ new Set();
  const { data: pages, error } = await supabase.from("pages").select("url").eq("source_id", sourceId).eq("status", "indexed");
  if (error || !pages?.length) return /* @__PURE__ */ new Set();
  return new Set(pages.map((p) => normalizeUrlForCompare(p.url || "")));
}
async function getIndexedPageUrls(conversationId) {
  const { data: sources } = await supabase.from("sources").select("id").eq("conversation_id", conversationId);
  const sourceIds = (sources ?? []).map((s) => s.id);
  if (sourceIds.length === 0) return /* @__PURE__ */ new Set();
  const { data: pages, error } = await supabase.from("pages").select("url").in("source_id", sourceIds).eq("status", "indexed");
  if (error || !pages?.length) return /* @__PURE__ */ new Set();
  return new Set(pages.map((p) => normalizeUrlForCompare(p.url || "")));
}
async function embedDiscoveredLinks(conversationId, apiKey, crawlJobId, scopeSourceId) {
  const indexedUrls = await getIndexedPageUrls(conversationId);
  let sourcesQuery = supabase.from("sources").select("id, suggestion_mode").eq("conversation_id", conversationId);
  if (scopeSourceId) {
    sourcesQuery = sourcesQuery.eq("id", scopeSourceId);
  }
  const { data: sources } = await sourcesQuery;
  const sourceIds = (sources ?? []).map((s) => s.id);
  const sourceModeMap = new Map((sources ?? []).map((s) => [s.id, s.suggestion_mode]));
  if (sourceIds.length === 0) return 0;
  const { data: pages } = await supabase.from("pages").select("id").in("source_id", sourceIds);
  const pageIds = (pages ?? []).map((p) => p.id);
  if (pageIds.length === 0) return 0;
  const { data: edgeRows } = await supabase.from("page_edges").select("id, to_url, from_page_id").in("from_page_id", pageIds);
  const edgeIds = (edgeRows ?? []).map((r) => r.id);
  if (edgeIds.length === 0) return 0;
  const { data: links, error: fetchError } = await supabase.from("encoded_discovered").select("id, snippet, page_edge_id, owner_id").in("page_edge_id", edgeIds).is("embedding", null);
  if (fetchError || !links?.length) {
    return 0;
  }
  const edgeIdToUrl = new Map((edgeRows ?? []).map((r) => [r.id, r.to_url]));
  const fromPageIds = [...new Set((edgeRows ?? []).map((r) => r.from_page_id).filter(Boolean))];
  const { data: pagesWithSource } = await supabase.from("pages").select("id, source_id").in("id", fromPageIds);
  const pageToSource = new Map((pagesWithSource ?? []).map((p) => [p.id, p.source_id]));
  const edgeIdToUseDive = /* @__PURE__ */ new Map();
  for (const r of edgeRows ?? []) {
    const fromPageId = r.from_page_id;
    const sourceId = fromPageId ? pageToSource.get(fromPageId) : void 0;
    const mode = sourceId ? sourceModeMap.get(sourceId) : void 0;
    edgeIdToUseDive.set(r.id, mode === "dive");
  }
  const toEmbed = links.filter((l) => {
    const url = edgeIdToUrl.get(l.page_edge_id) || "";
    return !indexedUrls.has(normalizeUrlForCompare(url));
  });
  const total = toEmbed.length;
  if (crawlJobId && total > 0) {
    await supabase.from("crawl_jobs").update({ encoding_discovered_total: total, encoding_discovered_done: 0 }).eq("id", crawlJobId);
  }
  if (toEmbed.length === 0) {
    console.log("[indexer] embedDiscoveredLinks (bulk) EARLY_RETURN: toEmbed.length=0", {
      linksLength: links.length,
      total,
      reason: "all links point to already-indexed pages"
    });
    return 0;
  }
  const diveCount = toEmbed.filter((l) => edgeIdToUseDive.get(l.page_edge_id)).length;
  const surfaceCount = toEmbed.length - diveCount;
  console.log("[indexer] embedDiscoveredLinks mode=surface|dive", { surface: surfaceCount, dive: diveCount, total: toEmbed.length });
  const hasAnyDive = diveCount > 0;
  const BATCH_SIZE = hasAnyDive ? 1 : EMBED_BATCH_SIZE;
  let updated = 0;
  let lastProgressUpdate = Date.now();
  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const texts = [];
    for (const item of batch) {
      let text = item.snippet;
      const useDive = edgeIdToUseDive.get(item.page_edge_id);
      if (useDive) {
        const url = edgeIdToUrl.get(item.page_edge_id) || "";
        const lead = await fetchTargetPageLead(url);
        if (lead) {
          text = lead;
          await supabase.from("encoded_discovered").update({ snippet: text }).eq("id", item.id);
          if (updated % 5 === 0 || updated < 3) {
            console.log("[indexer] dive", `[${updated + 1}/${toEmbed.length}]`, url.slice(0, 50) + "...", "\u2192", lead.slice(0, 60) + (lead.length > 60 ? "..." : ""));
          }
        }
      }
      texts.push(text || DEFAULT_LINK_SNIPPET);
    }
    const embeddings = await embedBatch(apiKey, texts);
    if (embeddings.length !== batch.length) break;
    for (let j = 0; j < batch.length; j++) {
      const { error } = await supabase.from("encoded_discovered").update({ embedding: embeddings[j] }).eq("id", batch[j].id);
      if (!error) updated++;
    }
    if (crawlJobId) {
      const now = Date.now();
      await supabase.from("crawl_jobs").update({
        encoding_discovered_done: updated,
        last_activity_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", crawlJobId);
      if (now - lastProgressUpdate >= DISCOVERED_PROGRESS_INTERVAL_MS) lastProgressUpdate = now;
    }
  }
  if (updated > 0) {
    const skipped = links.length - toEmbed.length;
    console.log("[indexer] Embedded", updated, "encoded_discovered", skipped > 0 ? `(skipped ${skipped} already-indexed)` : "");
  }
  return updated;
}
async function embedBatch(apiKey, texts) {
  const out = [];
  const maxRetries = 3;
  for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
    let lastErr = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const res = await fetch(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: OPENAI_EMBEDDING_MODEL,
            input: batch
          })
        });
        if (!res.ok) {
          const errText = await res.text();
          lastErr = new Error(`OpenAI embeddings: ${res.status} ${errText}`);
          if ((res.status === 500 || res.status === 502 || res.status === 429) && attempt < maxRetries - 1) {
            const delayMs = Math.min(1e3 * Math.pow(2, attempt), 8e3);
            console.warn("[indexer] OpenAI embeddings retry", { status: res.status, attempt: attempt + 1, delayMs });
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          throw lastErr;
        }
        const data = await res.json();
        for (const item of data.data) {
          out.push(item.embedding);
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries - 1) {
          const delayMs = Math.min(1e3 * Math.pow(2, attempt), 8e3);
          console.warn("[indexer] OpenAI embeddings retry after error", { message: lastErr.message.slice(0, 80), attempt: attempt + 1, delayMs });
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          throw lastErr;
        }
      }
    }
    if (lastErr) throw lastErr;
  }
  return out;
}

// src/crawler/crawlPage.ts
import * as cheerio2 from "cheerio";
import fetch3 from "node-fetch";

// src/crawler/urlUtils.ts
function stripFragmentAndQuery(input) {
  let s = (input || "").trim();
  const hashIdx = s.indexOf("#");
  if (hashIdx >= 0) s = s.slice(0, hashIdx);
  const qIdx = s.indexOf("?");
  if (qIdx >= 0) s = s.slice(0, qIdx);
  s = s.trim();
  s = s.replace(/^(https?:\/\/)+/i, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  return s;
}
function normalizeUrlForCrawl(input) {
  const s = stripFragmentAndQuery(input);
  try {
    const u = new URL(s);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return s;
  }
}
function urlDedupKey(input) {
  const s = stripFragmentAndQuery(input);
  try {
    const u = new URL(s);
    u.hash = "";
    u.search = "";
    if (u.pathname.endsWith("/") && u.pathname !== "/") u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return s;
  }
}

// src/crawler/crawlPage.ts
async function crawlPage(url, source, conversationId, existingInConversation) {
  if (!conversationId) {
    throw new Error(`conversationId is required for page insertion`);
  }
  try {
    const normalized = urlDedupKey(url);
    const skip = existingInConversation?.has(normalized);
    if (skip) {
      const response2 = await fetch3(url, { headers: { "User-Agent": CRAWLER_USER_AGENT } });
      if (!response2.ok) throw new Error(`HTTP ${response2.status}`);
      const html2 = await response2.text();
      console.log("[crawl] [crawlPage] SKIP (already in conversation)", {
        urlNorm: normalized.slice(-60),
        inputUrlTail: url.slice(-50)
      });
      return { page: null, html: html2, inserted: false };
    }
    let fetchUrl = url;
    let response = await fetch3(fetchUrl, { headers: { "User-Agent": CRAWLER_USER_AGENT } });
    if (response.status === 404) {
      const u = new URL(url);
      const altPathname = u.pathname.endsWith("/") && u.pathname !== "/" ? u.pathname.slice(0, -1) : u.pathname + "/";
      u.pathname = altPathname;
      const altUrl = u.toString();
      const altResponse = await fetch3(altUrl, { headers: { "User-Agent": CRAWLER_USER_AGENT } });
      if (altResponse.ok) {
        fetchUrl = altUrl;
        response = altResponse;
      }
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const html = await response.text();
    const $ = cheerio2.load(html);
    const rawTitle = $("title").first().text().trim() || $("h1").first().text().trim() || DEFAULT_PAGE_TITLE;
    const title = rawTitle.replace(PAGE_TITLE_SUFFIX_REGEX, "").trim() || rawTitle;
    const mainContent = $(MAIN_CONTENT_SELECTOR).first();
    const mainText = (mainContent.length > 0 ? mainContent.text() : $("body").text()).trim().substring(0, MAX_PAGE_CONTENT_LENGTH);
    const content = mainText || $("body").text().trim().substring(0, MAX_PAGE_CONTENT_LENGTH);
    const urlObj = new URL(fetchUrl);
    const path2 = urlObj.pathname + urlObj.search;
    const insertData = {
      source_id: source.id,
      url: fetchUrl,
      title,
      path: path2,
      content,
      status: "indexed",
      owner_id: source.owner_id
    };
    const { data: page, error } = await supabase.from("pages").insert(insertData).select().single();
    if (error) {
      const detailsStr = typeof error.details === "string" ? error.details : JSON.stringify(error.details || "");
      const msg = error.message || "";
      const isConvFk = error.code === "23503" && (detailsStr.includes("conversations") || msg.includes("conversations"));
      const isSourceFk = error.code === "23503" && (detailsStr.includes("source") || msg.includes("source_id") || msg.includes("sources"));
      if (isConvFk) {
        throw new Error(`Conversation ${conversationId} was deleted. Cannot index pages.`);
      }
      if (isSourceFk) {
        throw new Error(`Source ${source.id.slice(0, 8)} was deleted during crawl. Stopping.`);
      }
      const { data: existing } = await supabase.from("pages").select("*").eq("source_id", source.id).eq("url", fetchUrl).single();
      if (existing) {
        console.log("[crawl] [crawlPage] INSERT conflict (existing for this source)", { urlNorm: normalized.slice(-60) });
        return { page: existing, html, inserted: false };
      }
      console.error("crawl: page insert failed", url.slice(0, LOG_URL_MAX_LENGTH), error.message);
      return null;
    }
    console.log("[crawl] [crawlPage] INSERT new page", { pageId: page.id?.slice(0, 8), urlNorm: normalized.slice(-60) });
    return { page, html, inserted: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("crawl: page fetch failed", url.slice(0, LOG_URL_MAX_LENGTH), msg);
    return null;
  }
}

// src/crawler/links.ts
import * as cheerio3 from "cheerio";
function normalizeCurrentUrl(pageUrl) {
  const u = new URL(pageUrl);
  u.hash = "";
  u.search = "";
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/";
  else if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}
function normalizeLinkUrl(href, baseUrl) {
  try {
    const u = new URL(href, baseUrl);
    u.hash = "";
    u.search = "";
    if (u.pathname === "/" || u.pathname === "") u.pathname = "/";
    else if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return { url: u, normalized: u.toString() };
  } catch {
    return null;
  }
}
function shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source) {
  if (linkUrl.toString() === normalizedCurrentUrl) return true;
  try {
    const pathDecoded = decodeURIComponent(linkUrl.pathname);
    if (pathDecoded.toLowerCase().includes(DISAMBIGUATION_PATH_MARKER.toLowerCase())) return true;
  } catch {
  }
  if (isWikiStyleDomain(linkUrl.hostname)) {
    const pathParts = linkUrl.pathname.split("/").filter((p) => p);
    if (pathParts.length >= 2 && pathParts[0] === "wiki") {
      const pageName = decodeURIComponent(pathParts[1] || "");
      if (MEDIAWIKI_NS_PREFIXES.some((ns) => pageName.startsWith(ns)) || pageName === "Main_Page") return true;
    } else if (pathParts.length === 1 && pathParts[0] === "Main_Page") return true;
  }
  if (source.same_domain_only) {
    const baseUrl = new URL(normalizedCurrentUrl);
    const baseDomain = baseUrl.hostname.replace(/^www\./, "");
    const linkDomain = linkUrl.hostname.replace(/^www\./, "");
    const isSameDomain = linkDomain === baseDomain || linkDomain.endsWith("." + baseDomain) || baseDomain.endsWith("." + linkDomain);
    if (!isSameDomain) return true;
  }
  if (linkUrl.pathname.endsWith(".pdf")) return true;
  if (linkUrl.protocol !== "http:" && linkUrl.protocol !== "https:") return true;
  return false;
}
function getContentSelector($) {
  const main2 = $(MAIN_CONTENT_SELECTOR).first();
  return main2.length > 0 ? main2 : $("body");
}
function markSkipSectionsAndGetLinkElements($, contentSelector) {
  contentSelector.find("h2, h3").each((_, el) => {
    const $el = $(el);
    if (isSkipSectionHeading($el.text())) {
      $el.nextUntil("h2, h3").addBack().addClass("crawl-skip-section");
    }
  });
  return contentSelector.find("a[href]").not(function() {
    return $(this).closest(".crawl-skip-section").length > 0;
  }).not(function() {
    return $(this).closest(LINK_SKIP_CONTAINER_SELECTORS).length > 0;
  });
}
function extractLinksWithContext(html, pageUrl, source) {
  try {
    const $ = cheerio3.load(html);
    const seen = /* @__PURE__ */ new Set();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
    const contentSelector = getContentSelector($);
    const linkElements = markSkipSectionsAndGetLinkElements($, contentSelector);
    const result = [];
    linkElements.each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      const parsed = normalizeLinkUrl(href.trim(), pageUrl);
      if (!parsed) return;
      const { url: linkUrl, normalized: normalizedUrl } = parsed;
      if (seen.has(normalizedUrl)) return;
      seen.add(normalizedUrl);
      if (shouldSkipLinkUrl(linkUrl, normalizedCurrentUrl, source)) return;
      const anchorText = $(element).text().trim().replace(/\s+/g, " ").substring(0, 100);
      let contextEl = $(element).closest("p, li, td, .mw-parser-output > div");
      if (contextEl.length === 0) contextEl = $(element).parent();
      const rawText = contextEl.first().text().trim().replace(/\s+/g, " ");
      const pos = anchorText ? rawText.indexOf(anchorText) : -1;
      const half = Math.floor(CONTEXT_SNIPPET_LENGTH / 2);
      let snippet;
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
          const pathParts = linkUrl.pathname.split("/").filter((p) => p);
          const wikiTitle = pathParts[0] === "wiki" && pathParts[1] ? decodeURIComponent(pathParts[1].replace(/_/g, " ")) : linkUrl.pathname;
          snippet = wikiTitle ? `Link to ${wikiTitle}`.substring(0, CONTEXT_SNIPPET_LENGTH) : "Link from page";
        }
      }
      result.push({ url: normalizedUrl, snippet, anchorText });
    });
    return result;
  } catch (error) {
    console.error("crawl: link extraction failed", error);
    return [];
  }
}
function extractLinks(html, pageUrl, source) {
  try {
    const $ = cheerio3.load(html);
    const seen = /* @__PURE__ */ new Set();
    const normalizedCurrentUrl = normalizeCurrentUrl(pageUrl);
    const contentSelector = getContentSelector($);
    let linkElements = markSkipSectionsAndGetLinkElements($, contentSelector);
    if (linkElements.length === 0) {
      const allInContent = contentSelector.find("a[href]").length > 0 ? contentSelector.find("a[href]") : $("a[href]");
      linkElements = allInContent.not(function() {
        return $(this).closest(".crawl-skip-section," + LINK_SKIP_CONTAINER_SELECTORS).length > 0;
      });
    }
    const links = [];
    linkElements.each((_, element) => {
      const href = $(element).attr("href");
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
    console.error("crawl: link extraction failed", error);
    return [];
  }
}

// src/crawler/job.ts
async function updateJobStatus(jobId, status, errorMessage = null, startedAt = null, completedAt = null) {
  const updates = {
    status,
    updated_at: (/* @__PURE__ */ new Date()).toISOString(),
    last_activity_at: (/* @__PURE__ */ new Date()).toISOString()
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
  await supabase.from("crawl_jobs").update(updates).eq("id", jobId);
}
async function updateCrawlJob(jobId, updates) {
  await supabase.from("crawl_jobs").update({ ...updates, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", jobId);
}
async function claimJob() {
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1e3).toISOString();
  const { data: stuckJobs } = await supabase.from("crawl_jobs").select("id").eq("status", "running").lt("last_activity_at", staleThreshold).limit(10);
  if (stuckJobs?.length) {
    await supabase.from("crawl_jobs").update({ status: "queued", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).in("id", stuckJobs.map((j) => j.id));
  }
  const { data: jobs, error: fetchError } = await supabase.from("crawl_jobs").select("*").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
  if (fetchError) {
    console.error("crawl: failed to fetch queued jobs", fetchError);
    return null;
  }
  if (!jobs?.length) {
    return null;
  }
  const job = jobs[0];
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const { data: updated, error: updateError } = await supabase.from("crawl_jobs").update({ status: "running", last_activity_at: now, updated_at: now }).eq("id", job.id).select().single();
  if (updateError || !updated) {
    console.error("crawl: claim failed", job.id?.slice(0, 8), updateError);
    return null;
  }
  return updated;
}

// src/crawler/crawlSource.ts
async function crawlSource(job, source) {
  let conversationId = source.conversation_id;
  if (!conversationId) {
    const { data: sourceRow, error: srcError } = await supabase.from("sources").select("conversation_id").eq("id", source.id).single();
    if (srcError || !sourceRow?.conversation_id) {
      throw new Error(`No conversation found for source ${source.id}`);
    }
    conversationId = sourceRow.conversation_id;
  }
  const { data: conversation, error: convCheckError } = await supabase.from("conversations").select("id").eq("id", conversationId).single();
  if (convCheckError || !conversation) {
    throw new Error(`Conversation ${conversationId} does not exist for source ${source.id}`);
  }
  return crawlSourceWithConversationId(job, source, conversationId);
}
async function crawlSourceWithConversationId(job, source, conversationId) {
  const rawDepth = source.crawl_depth;
  let maxPages = (rawDepth ? MAX_PAGES[rawDepth] : void 0) ?? (rawDepth === "dynamic" ? 1 : 15);
  const explicitKey = job.explicit_crawl_urls;
  const seedUrls = explicitKey && explicitKey.length > 0 ? explicitKey.map((u) => normalizeUrlForCrawl(u)) : [normalizeUrlForCrawl(source.initial_url)];
  if (seedUrls.length > maxPages) {
    maxPages = seedUrls.length;
  }
  const visited = /* @__PURE__ */ new Set();
  const discovered = /* @__PURE__ */ new Set();
  const queue = [...seedUrls];
  seedUrls.forEach((u) => discovered.add(u));
  let newPagesCount = 0;
  const existingInConversation = /* @__PURE__ */ new Set();
  const existingPageIdByUrl = /* @__PURE__ */ new Map();
  const { data: convSources } = await supabase.from("sources").select("id").eq("conversation_id", conversationId);
  const convSourceIds = (convSources ?? []).map((s) => s.id);
  if (convSourceIds.length > 0) {
    const { data: existingPages } = await supabase.from("pages").select("id, url").in("source_id", convSourceIds);
    (existingPages ?? []).forEach((p) => {
      const norm = urlDedupKey(p.url);
      existingInConversation.add(norm);
      existingPageIdByUrl.set(norm, p.id);
    });
  }
  const seedNorm = seedUrls[0] ? urlDedupKey(seedUrls[0]) : "";
  const seedInSet = seedNorm && existingInConversation.has(seedNorm);
  const seedPageId = seedNorm ? existingPageIdByUrl.get(seedNorm) ?? null : null;
  let sourceTitleUpdated = false;
  const firstSeedUrl = seedUrls[0];
  let robotsParser = null;
  try {
    const robotsUrl = new URL("/robots.txt", firstSeedUrl).toString();
    const robotsResponse = await fetch4(robotsUrl);
    if (robotsResponse.ok) {
      const robotsText = await robotsResponse.text();
      robotsParser = RobotsParser(robotsUrl, robotsText);
    }
  } catch (err) {
    console.warn("crawl: robots.txt unavailable", firstSeedUrl.slice(0, 50), err instanceof Error ? err.message : err);
  }
  if (queue.length === 0) {
    return;
  }
  const sourceShort = new URL(firstSeedUrl).pathname?.replace(/^\/wiki\//, "") || firstSeedUrl.slice(0, 40);
  const crawlDepth = source.crawl_depth ?? "shallow";
  const isDynamic = crawlDepth === "dynamic";
  while (queue.length > 0 && newPagesCount < maxPages) {
    const { data: sourceCheck } = await supabase.from("sources").select("id").eq("id", source.id).single();
    if (!sourceCheck) {
      throw new Error(`Source ${source.id.slice(0, 8)} was deleted during crawl; stopping.`);
    }
    const url = queue.shift();
    const normalizedUrl = normalizeUrlForCrawl(url);
    const urlNormForLookup = urlDedupKey(normalizedUrl);
    if (robotsParser && !robotsParser.isAllowed(normalizedUrl, "ScholiaCrawler")) {
      const isSeedUrl = seedUrls.some((s) => urlDedupKey(s) === urlNormForLookup);
      if (isSeedUrl) {
        await updateCrawlJob(job.id, {
          status: "completed",
          error_message: `This page is blocked by the site's robots.txt and cannot be crawled. The site owner has restricted automated access to this URL.`,
          completed_at: (/* @__PURE__ */ new Date()).toISOString()
        });
        return;
      }
      continue;
    }
    try {
      if (!conversationId) throw new Error(`conversationId is null before calling crawlPage!`);
      const result = await crawlPage(normalizedUrl, source, conversationId, existingInConversation);
      if (!result) {
        visited.add(normalizedUrl);
        continue;
      }
      const { page, html, inserted } = result;
      visited.add(normalizedUrl);
      if (inserted && page) {
        newPagesCount++;
        const norm = urlDedupKey(normalizedUrl);
        existingInConversation.add(norm);
        existingPageIdByUrl.set(norm, page.id);
      }
      const fromPageId = page?.id ?? existingPageIdByUrl.get(urlNormForLookup) ?? null;
      if (page && !sourceTitleUpdated && page.title) {
        const label = page.title.trim().substring(0, 100);
        if (label) {
          const { error } = await supabase.from("sources").update({ source_label: label }).eq("id", source.id);
          if (!error) {
            source.source_label = label;
          }
          sourceTitleUpdated = true;
        }
      }
      const isDynamic2 = source.crawl_depth === "dynamic";
      const isSurface = source.suggestion_mode !== "dive";
      const links = extractLinks(html, normalizedUrl, source);
      const linksWithContext = isDynamic2 && isSurface ? extractLinksWithContext(html, normalizedUrl, source) : [];
      const edgesToInsert = [];
      const linksToProcess = isDynamic2 ? links.slice(0, MAX_LINKS_PER_PAGE_DYNAMIC) : links;
      for (const link of linksToProcess) {
        if (!discovered.has(link) && !visited.has(link)) {
          discovered.add(link);
          if (!isDynamic2) {
            queue.push(link);
          }
        }
        if (fromPageId) {
          edgesToInsert.push({
            from_page_id: fromPageId,
            to_url: link,
            owner_id: source.owner_id
          });
        }
      }
      if (edgesToInsert.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < edgesToInsert.length; i += batchSize) {
          const chunk = edgesToInsert.slice(i, i + batchSize);
          const { error: edgeErr } = await supabase.from("page_edges").upsert(chunk, { onConflict: "from_page_id,to_url", ignoreDuplicates: true });
          if (edgeErr) {
            console.error("[crawl] page_edges upsert failed", { error: edgeErr.message, batchSize: chunk.length });
          }
          if (i + batchSize < edgesToInsert.length) {
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        }
      }
      if (page) {
        const { data: convPageIds } = await supabase.from("pages").select("id").in("source_id", convSourceIds);
        const fromPageIds = (convPageIds ?? []).map((p) => p.id);
        if (fromPageIds.length > 0) {
          const { data: updatedEdges, error: backfillErr } = await supabase.from("page_edges").update({ to_page_id: page.id }).eq("to_url", normalizedUrl).in("from_page_id", fromPageIds).is("to_page_id", null).select("id");
          if (backfillErr) {
            console.warn("[crawl] page_edges to_page_id backfill failed", { error: backfillErr.message, url: normalizedUrl.slice(0, 50) });
          }
        }
      }
      if (page && isDynamic2 && edgesToInsert.length > 0) {
        const urlsToEncode = edgesToInsert.slice(0, 500).map((e) => e.to_url);
        const { data: edgeRows } = await supabase.from("page_edges").select("id, to_url").eq("from_page_id", page.id).in("to_url", urlsToEncode);
        const urlToEdgeId = new Map((edgeRows ?? []).map((r) => [r.to_url, r.id]));
        if (urlToEdgeId.size > 0) {
          const encodedToInsert = Array.from(urlToEdgeId.entries()).map(([toUrl, edgeId]) => {
            if (isSurface && linksWithContext.length > 0) {
              const withContext = linksWithContext.find((l) => l.url === toUrl);
              if (withContext && withContext.snippet.length > 0) {
                return {
                  page_edge_id: edgeId,
                  anchor_text: withContext.anchorText || null,
                  snippet: withContext.snippet.substring(0, 500),
                  owner_id: source.owner_id
                };
              }
            }
            return {
              page_edge_id: edgeId,
              anchor_text: null,
              snippet: "Link from page",
              owner_id: source.owner_id
            };
          });
          if (encodedToInsert.length > 0) {
            const { error: encError } = await supabase.from("encoded_discovered").upsert(encodedToInsert, {
              onConflict: "page_edge_id",
              ignoreDuplicates: true
            });
            if (encError) {
              console.warn("[crawl] encoded_discovered insert failed", encError.message);
            }
          }
        }
      }
      await supabase.from("crawl_jobs").update({
        discovered_count: discovered.size,
        indexed_count: newPagesCount,
        last_activity_at: (/* @__PURE__ */ new Date()).toISOString(),
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).eq("id", job.id);
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    } catch (error) {
      if (error instanceof Error && error.message.includes("was deleted")) throw error;
      console.error("crawl: error on page", url.slice(0, 50), error);
      visited.add(normalizedUrl);
    }
  }
  const indexingUpdate = { status: "indexing", updated_at: (/* @__PURE__ */ new Date()).toISOString() };
  if (source.crawl_depth === "dynamic") {
    const { data: pages } = await supabase.from("pages").select("id").eq("source_id", source.id);
    const pageIds = (pages ?? []).map((p) => p.id);
    if (pageIds.length > 0) {
      const { data: edges } = await supabase.from("page_edges").select("id").in("from_page_id", pageIds);
      const edgeIds = (edges ?? []).map((e) => e.id);
      if (edgeIds.length > 0) {
        const { count } = await supabase.from("encoded_discovered").select("*", { count: "exact", head: true }).in("page_edge_id", edgeIds).is("embedding", null);
        if (count != null && count > 0) {
          indexingUpdate.encoding_discovered_total = count;
          indexingUpdate.encoding_discovered_done = 0;
        }
      }
    }
  }
  await updateCrawlJob(job.id, indexingUpdate);
  try {
    await indexSourceForRag(source.id, job.id, conversationId);
  } catch (err) {
    console.warn("[crawl] RAG indexing failed", err);
  }
  const { data: sourcePagesAfter } = await supabase.from("pages").select("id").eq("source_id", source.id);
  const totalPagesForSource = sourcePagesAfter?.length ?? newPagesCount;
  await supabase.from("crawl_jobs").update({
    total_pages: totalPagesForSource,
    discovered_count: discovered.size,
    indexed_count: newPagesCount,
    status: "completed",
    completed_at: (/* @__PURE__ */ new Date()).toISOString(),
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  }).eq("id", job.id);
  const { data: insertedPages, error: verifyError } = await supabase.from("pages").select("id, url").eq("source_id", source.id).limit(5);
  if (verifyError) {
    console.error("crawl: verify failed", verifyError);
  } else if (newPagesCount > 0 && (!insertedPages || insertedPages.length === 0)) {
    console.error("crawl: no pages in DB after crawl");
  }
}

// src/crawler/index.ts
async function processCrawlJob(jobId) {
  try {
    const { data: job, error: jobError } = await supabase.from("crawl_jobs").select("*").eq("id", jobId).single();
    if (jobError || !job) {
      console.error("crawl: job not found", jobId.slice(0, 8), jobError);
      return;
    }
    if (job.status !== "queued" && job.status !== "running") {
      return;
    }
    const { data: source, error: sourceError } = await supabase.from("sources").select("*").eq("id", job.source_id).single();
    if (sourceError || !source) {
      console.error("crawl: source not found", job.source_id?.slice(0, 8));
      await updateJobStatus(jobId, "failed", `Source not found: ${sourceError?.message}`);
      return;
    }
    if (job.status !== "running") {
      await updateJobStatus(jobId, "running", null, (/* @__PURE__ */ new Date()).toISOString());
    }
    await crawlSource(job, source);
    await updateJobStatus(jobId, "completed", null, null, (/* @__PURE__ */ new Date()).toISOString());
  } catch (error) {
    console.error("crawl: job failed", jobId.slice(0, 8), error);
    await updateJobStatus(
      jobId,
      "failed",
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

// src/addPageProcessor.ts
import * as cheerio4 from "cheerio";
import fetch5 from "node-fetch";
import RobotsParser2 from "robots-parser";
var MAX_LINKS_PER_ADD_PAGE = 500;
var ENCODED_SNIPPET_MAX_LENGTH = 500;
var SEED_EDGES_LIMIT = 10;
var DEFAULT_SNIPPET_FALLBACK = "Link from page";
async function processAddPageJob(job) {
  const { id: jobId, source_id: sourceId, explicit_crawl_urls } = job;
  const url = explicit_crawl_urls[0];
  if (!url) {
    await updateCrawlJob(jobId, { status: "failed", error_message: "No URL in explicit_crawl_urls" });
    return;
  }
  const normalizedUrl = normalizeUrlForCrawl(url);
  console.log("[add-page] process start", { jobId: jobId.slice(0, 8), url: normalizedUrl.slice(0, 50) });
  try {
    await updateCrawlJob(jobId, { status: "indexing" });
    const { data: existing } = await supabase.from("pages").select("id").eq("source_id", sourceId).eq("url", normalizedUrl).maybeSingle();
    if (existing) {
      console.log("[add-page] page already exists", existing.id, "- backfilling edges and completing");
      const { data: source2 } = await supabase.from("sources").select("owner_id").eq("id", sourceId).single();
      const ownerId2 = source2?.owner_id;
      if (ownerId2) {
        const { data: seedPages2 } = await supabase.from("pages").select("id").eq("source_id", sourceId).neq("id", existing.id).limit(SEED_EDGES_LIMIT);
        if (seedPages2?.length) {
          const edges = seedPages2.map((p) => ({
            from_page_id: p.id,
            to_url: normalizedUrl,
            owner_id: ownerId2
          }));
          await supabase.from("page_edges").upsert(edges, {
            onConflict: "from_page_id,to_url",
            ignoreDuplicates: true
          });
        }
        const { data: sourcePages2 } = await supabase.from("pages").select("id").eq("source_id", sourceId);
        const fromPageIds2 = (sourcePages2 ?? []).map((p) => p.id);
        if (fromPageIds2.length > 0) {
          await supabase.from("page_edges").update({ to_page_id: existing.id }).eq("to_url", normalizedUrl).in("from_page_id", fromPageIds2).is("to_page_id", null);
        }
      }
      await updateCrawlJob(jobId, { status: "completed" });
      return;
    }
    try {
      const robotsUrl = new URL("/robots.txt", normalizedUrl).toString();
      const robotsRes = await fetch5(robotsUrl);
      if (robotsRes.ok) {
        const robotsText = await robotsRes.text();
        const parser = RobotsParser2(robotsUrl, robotsText);
        if (!parser.isAllowed(normalizedUrl, "ScholiaCrawler")) {
          await updateCrawlJob(jobId, {
            status: "completed",
            error_message: `This page is blocked by the site's robots.txt and cannot be crawled. The site owner has restricted automated access to this URL.`,
            completed_at: (/* @__PURE__ */ new Date()).toISOString()
          });
          return;
        }
      }
    } catch {
    }
    const res = await fetch5(normalizedUrl, {
      headers: { "User-Agent": CRAWLER_USER_AGENT }
    });
    if (!res.ok) {
      await updateCrawlJob(jobId, {
        status: "failed",
        error_message: `Failed to fetch: HTTP ${res.status}`
      });
      throw new Error(`Failed to fetch: HTTP ${res.status}`);
    }
    const html = await res.text();
    const $ = cheerio4.load(html);
    const title = $("title").first().text().trim() || $("h1").first().text().trim() || DEFAULT_PAGE_TITLE;
    const content = $(MAIN_CONTENT_SELECTOR).first().text().trim().substring(0, MAX_PAGE_CONTENT_LENGTH) || $("body").text().trim().substring(0, MAX_PAGE_CONTENT_LENGTH);
    const urlObj = new URL(normalizedUrl);
    const path2 = urlObj.pathname + urlObj.search;
    const { data: source, error: srcErr } = await supabase.from("sources").select("owner_id, same_domain_only, conversation_id, suggestion_mode").eq("id", sourceId).single();
    if (srcErr || !source) {
      await updateCrawlJob(jobId, { status: "failed", error_message: "Source not found" });
      throw new Error("Source not found");
    }
    const ownerId = source.owner_id;
    const { data: newPage, error: insertErr } = await supabase.from("pages").insert({
      source_id: sourceId,
      url: normalizedUrl,
      title,
      path: path2,
      content,
      status: "indexed",
      owner_id: ownerId
    }).select().single();
    if (insertErr) {
      if (insertErr.code === "23505") {
        const { data: existingAfterConflict } = await supabase.from("pages").select("id").eq("source_id", sourceId).eq("url", normalizedUrl).maybeSingle();
        if (existingAfterConflict) {
          console.log("[add-page] insert conflict (page already exists)", existingAfterConflict.id, "- backfilling edges and completing");
          const { data: source2 } = await supabase.from("sources").select("owner_id").eq("id", sourceId).single();
          const ownerId2 = source2?.owner_id;
          if (ownerId2) {
            const { data: seedPages2 } = await supabase.from("pages").select("id").eq("source_id", sourceId).neq("id", existingAfterConflict.id).limit(SEED_EDGES_LIMIT);
            if (seedPages2?.length) {
              await supabase.from("page_edges").upsert(
                seedPages2.map((p) => ({
                  from_page_id: p.id,
                  to_url: normalizedUrl,
                  owner_id: ownerId2
                })),
                { onConflict: "from_page_id,to_url", ignoreDuplicates: true }
              );
            }
            const { data: sourcePages2 } = await supabase.from("pages").select("id").eq("source_id", sourceId);
            const fromPageIds2 = (sourcePages2 ?? []).map((p) => p.id);
            if (fromPageIds2.length > 0) {
              await supabase.from("page_edges").update({ to_page_id: existingAfterConflict.id }).eq("to_url", normalizedUrl).in("from_page_id", fromPageIds2).is("to_page_id", null);
            }
          }
          await updateCrawlJob(jobId, { status: "completed" });
          return;
        }
      }
      await updateCrawlJob(jobId, { status: "failed", error_message: insertErr.message });
      throw new Error(insertErr.message);
    }
    const { data: seedPages } = await supabase.from("pages").select("id, url").eq("source_id", sourceId).neq("id", newPage.id).limit(SEED_EDGES_LIMIT);
    if (seedPages?.length) {
      const edges = seedPages.map((p) => ({
        from_page_id: p.id,
        to_url: normalizedUrl,
        owner_id: ownerId
      }));
      await supabase.from("page_edges").upsert(edges, {
        onConflict: "from_page_id,to_url",
        ignoreDuplicates: true
      });
    }
    const { data: sourcePages } = await supabase.from("pages").select("id").eq("source_id", sourceId);
    const fromPageIds = (sourcePages ?? []).map((p) => p.id);
    if (fromPageIds.length > 0) {
      await supabase.from("page_edges").update({ to_page_id: newPage.id }).eq("to_url", normalizedUrl).in("from_page_id", fromPageIds).is("to_page_id", null);
    }
    const sourceForExtract = {
      same_domain_only: source.same_domain_only ?? true,
      suggestion_mode: source.suggestion_mode
    };
    const isSurface = source.suggestion_mode !== "dive";
    const linksWithContext = isSurface ? extractLinksWithContext(html, normalizedUrl, sourceForExtract) : [];
    const linksUrlOnly = extractLinks(html, normalizedUrl, sourceForExtract);
    console.log("[add-page] links", {
      withContext: linksWithContext.length,
      urlOnly: linksUrlOnly.length,
      isSurface
    });
    const { data: sourcePageEdges } = await supabase.from("page_edges").select("to_url").eq("from_page_id", newPage.id);
    const existingUrls = new Set((sourcePageEdges ?? []).map((r) => r.to_url));
    const newLinkUrls = isSurface ? linksWithContext.filter((l) => !existingUrls.has(l.url)).map((l) => l.url) : linksUrlOnly.filter((url2) => !existingUrls.has(url2));
    const newLinksWithContext = linksWithContext.filter((l) => !existingUrls.has(l.url));
    console.log("[add-page] newLinks after dedup", { newLinksCount: newLinkUrls.length, existingCount: existingUrls.size });
    if (newLinkUrls.length > 0) {
      const edgeRows = newLinkUrls.slice(0, MAX_LINKS_PER_ADD_PAGE).map((url2) => ({
        from_page_id: newPage.id,
        to_url: url2,
        owner_id: ownerId
      }));
      const { error: edgeErr } = await supabase.from("page_edges").upsert(edgeRows, {
        onConflict: "from_page_id,to_url",
        ignoreDuplicates: true
      });
      console.log("[add-page] page_edges upsert", { rowCount: edgeRows.length, error: edgeErr?.message ?? null });
      const { data: edgeIds } = await supabase.from("page_edges").select("id, to_url").eq("from_page_id", newPage.id).in("to_url", newLinkUrls.slice(0, MAX_LINKS_PER_ADD_PAGE));
      const urlToEdgeId = new Map((edgeIds ?? []).map((r) => [r.to_url, r.id]));
      const encodedRows = newLinkUrls.slice(0, MAX_LINKS_PER_ADD_PAGE).filter((url2) => urlToEdgeId.has(url2)).map((url2) => {
        const withContext = newLinksWithContext.find((l) => l.url === url2);
        const snippet = isSurface && withContext && (withContext.snippet || withContext.anchorText) ? (withContext.snippet || withContext.anchorText || DEFAULT_SNIPPET_FALLBACK).substring(0, ENCODED_SNIPPET_MAX_LENGTH) : DEFAULT_SNIPPET_FALLBACK;
        return {
          page_edge_id: urlToEdgeId.get(url2),
          anchor_text: withContext?.anchorText || null,
          snippet,
          owner_id: ownerId
        };
      });
      if (encodedRows.length > 0) {
        const { error: encErr } = await supabase.from("encoded_discovered").upsert(encodedRows, {
          onConflict: "page_edge_id",
          ignoreDuplicates: true
        });
        console.log("[add-page] encoded_discovered upsert", {
          rowCount: encodedRows.length,
          urlToEdgeIdSize: urlToEdgeId.size,
          error: encErr?.message ?? null
        });
      } else {
        console.log("[add-page] encoded_discovered skip: encodedRows.length=0", {
          newLinksCount: newLinkUrls.length,
          urlToEdgeIdSize: urlToEdgeId.size,
          reason: "urlToEdgeId missing some URLs?"
        });
      }
    } else {
      console.log("[add-page] no newLinks to insert", { linksUrlOnly: linksUrlOnly.length, linksWithContext: linksWithContext.length });
    }
    await indexSinglePageForRag(newPage.id, content, ownerId, jobId, title, normalizedUrl);
    const apiKey = process.env.OPENAI_API_KEY;
    const conversationId = source.conversation_id;
    if (!apiKey) {
      console.log("[add-page] SKIP embedDiscoveredLinksForPage: OPENAI_API_KEY not set");
    } else if (!conversationId) {
      console.log("[add-page] SKIP embedDiscoveredLinksForPage: source.conversation_id is null/undefined");
    } else {
      console.log("[add-page] calling embedDiscoveredLinksForPage", { conversationId: conversationId.slice(0, 8), newPageId: newPage.id?.slice(0, 8) });
      await embedDiscoveredLinksForPage(conversationId, newPage.id, apiKey, jobId, ownerId);
    }
    await updateCrawlJob(jobId, { status: "completed" });
    console.log("[add-page] success", newPage.id?.slice(0, 8));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[add-page] error", msg);
    await updateCrawlJob(jobId, { status: "failed", error_message: msg });
    throw err;
  }
}

// src/index.ts
var FALLBACK_POLL_MS = parseInt(process.env.CRAWL_FALLBACK_POLL_MS || "60000", 10);
var MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || "3", 10);
var activeJobs = /* @__PURE__ */ new Set();
var wakeResolver = null;
var wakePromise = () => new Promise((resolve) => {
  wakeResolver = resolve;
});
var wake = () => {
  if (wakeResolver) {
    wakeResolver();
    wakeResolver = null;
  }
};
async function main() {
  console.log("[worker] Started, using Realtime for job discovery (fallback poll every", FALLBACK_POLL_MS / 1e3, "s)");
  supabase.channel("worker-crawl-jobs").on(
    "postgres_changes",
    { event: "INSERT", schema: "public", table: "crawl_jobs" },
    (payload) => {
      if (payload.new?.status === "queued") wake();
    }
  ).subscribe((status) => {
    if (status === "SUBSCRIBED") {
      console.log("[worker] Realtime subscribed to crawl_jobs");
    } else if (status === "CHANNEL_ERROR") {
      console.warn("[worker] Realtime channel error \u2013 relying on fallback poll");
    }
  });
  let fallbackTimer = null;
  const scheduleFallback = () => {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      wake();
    }, FALLBACK_POLL_MS);
  };
  let hasLoggedIdle = false;
  while (true) {
    try {
      while (activeJobs.size < MAX_CONCURRENT_JOBS) {
        const job = await claimJob();
        if (!job) {
          if (!hasLoggedIdle) {
            console.log("[worker] Idle (Add a source or page to create a job)");
            hasLoggedIdle = true;
          }
          scheduleFallback();
          await wakePromise();
          continue;
        }
        hasLoggedIdle = false;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        const sourceShort = job.source_id?.slice(0, 8) || "?";
        const explicitUrls = job.explicit_crawl_urls;
        const isAddPage = explicitUrls && explicitUrls.length === 1;
        if (isAddPage) {
          console.log("[worker] Claimed add-page crawl job", job.id.slice(0, 8), "source", sourceShort);
        } else {
          console.log("[worker] Claimed job", job.id.slice(0, 8), "source", sourceShort, "(discovered/indexed logs will follow with [D/I] prefix)");
        }
        activeJobs.add(job.id);
        const processor = isAddPage ? processAddPageJob({ id: job.id, source_id: job.source_id, explicit_crawl_urls: explicitUrls }) : processCrawlJob(job.id);
        processor.then(() => {
          activeJobs.delete(job.id);
          wake();
        }).catch((error) => {
          activeJobs.delete(job.id);
          wake();
          console.error(`\u274C Job ${job.id.substring(0, 8)}... failed:`, error);
        });
      }
      scheduleFallback();
      await wakePromise();
    } catch (error) {
      console.error("\u274C Error in main loop:", error);
      scheduleFallback();
      await wakePromise();
    }
  }
}
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
