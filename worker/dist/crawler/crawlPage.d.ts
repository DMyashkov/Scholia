import type { CrawlJob, Page, Source } from '../types';
export declare function crawlPage(url: string, source: Source, job: CrawlJob, conversationId: string): Promise<{
    page: Page;
    html: string;
} | null>;
//# sourceMappingURL=crawlPage.d.ts.map