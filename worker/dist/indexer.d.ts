export declare function indexConversationForRag(conversationId: string, crawlJobId?: string): Promise<{
    chunksCreated: number;
}>;
/** Index a single page for RAG and report progress to add_page_jobs */
export declare function indexSinglePageForRag(pageId: string, content: string, ownerId: string | null, addPageJobId: string): Promise<{
    chunksCreated: number;
}>;
/** Embed discovered_links for a single page (add-page flow) and report progress */
export declare function embedDiscoveredLinksForPage(conversationId: string, pageId: string, apiKey: string, addPageJobId: string): Promise<number>;
//# sourceMappingURL=indexer.d.ts.map