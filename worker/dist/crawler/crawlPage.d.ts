import type { Page, Source } from '../types';
export declare function crawlPage(url: string, source: Source, conversationId: string): Promise<{
    page: Page;
    html: string;
} | null>;
//# sourceMappingURL=crawlPage.d.ts.map