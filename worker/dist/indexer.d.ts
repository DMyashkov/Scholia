/** Index one source's pages for RAG (used after a source crawl). Optionally run discovered-link embedding for the conversation. */
export declare function indexSourceForRag(sourceId: string, crawlJobId?: string, conversationId?: string): Promise<{
    chunksCreated: number;
}>;
/** Index all sources in a conversation (e.g. full re-index). Prefer indexSourceForRag after a single-source crawl. */
export declare function indexConversationForRag(conversationId: string, crawlJobId?: string): Promise<{
    chunksCreated: number;
}>;
/** Index a single page for RAG and report progress to crawl_jobs (add-page flow) */
export declare function indexSinglePageForRag(pageId: string, content: string, ownerId: string, crawlJobId: string): Promise<{
    chunksCreated: number;
}>;
/** Embed encoded_discovered for a single page (add-page flow) and report progress to crawl_jobs.
 * Skips links pointing to already-indexed pages - we never suggest those.
 * In dive mode: fetches each target page, gets lead, then embeds (progress = fetch+encode per link). */
export declare function embedDiscoveredLinksForPage(conversationId: string, pageId: string, apiKey: string, crawlJobId: string, ownerId: string): Promise<number>;
//# sourceMappingURL=indexer.d.ts.map