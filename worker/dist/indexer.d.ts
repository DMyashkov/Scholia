export declare function indexConversationForRag(conversationId: string, crawlJobId?: string): Promise<{
    chunksCreated: number;
}>;
/** Index a single page for RAG and report progress to crawl_jobs (add-page flow) */
export declare function indexSinglePageForRag(pageId: string, content: string, ownerId: string, crawlJobId: string): Promise<{
    chunksCreated: number;
}>;
/** Embed encoded_discovered for a single page (add-page flow) and report progress to crawl_jobs.
 * Skips links pointing to already-indexed pages - we never suggest those. */
export declare function embedDiscoveredLinksForPage(conversationId: string, pageId: string, apiKey: string, crawlJobId: string): Promise<number>;
//# sourceMappingURL=indexer.d.ts.map