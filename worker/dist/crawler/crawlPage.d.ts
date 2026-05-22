import type { Page, Source } from '../types';
export declare function crawlPage(url: string, source: Source, conversationId: string, existingInConversation?: Set<string>): Promise<{
    page: Page | null;
    html: string;
    inserted: boolean;
} | null>;
//# sourceMappingURL=crawlPage.d.ts.map