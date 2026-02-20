import type { Source } from '../types';
export declare function extractLinksWithContext(html: string, pageUrl: string, source: Source): Array<{
    url: string;
    snippet: string;
    anchorText: string;
}>;
export declare function extractLinks(html: string, pageUrl: string, source: Source): string[];
//# sourceMappingURL=links.d.ts.map