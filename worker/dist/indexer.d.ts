export declare function indexSourceForRag(sourceId: string, crawlJobId?: string, conversationId?: string): Promise<{
    chunksCreated: number;
}>;
export declare function indexConversationForRag(conversationId: string, crawlJobId?: string): Promise<{
    chunksCreated: number;
}>;
export declare function indexSinglePageForRag(pageId: string, content: string, ownerId: string, crawlJobId: string): Promise<{
    chunksCreated: number;
}>;
export declare function embedDiscoveredLinksForPage(conversationId: string, pageId: string, apiKey: string, crawlJobId: string, ownerId: string): Promise<number>;
//# sourceMappingURL=indexer.d.ts.map