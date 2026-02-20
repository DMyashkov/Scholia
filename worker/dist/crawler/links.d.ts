import type { Source } from '../types';
/**
 * For dynamic mode: extract links with ~200 chars of surrounding context for RAG.
 * Exported for addPageProcessor.
 */
export declare function extractLinksWithContext(html: string, pageUrl: string, source: Source): Array<{
    url: string;
    snippet: string;
    anchorText: string;
}>;
export declare function extractLinks(html: string, pageUrl: string, source: Source): string[];
//# sourceMappingURL=links.d.ts.map