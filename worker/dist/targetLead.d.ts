/** Strip leading junk (CSS, coordinates, boilerplate) from page text */
export declare function stripLeadFluff(text: string): string;
/** Fetch a URL and return the first ~200 chars of main content (lead), with fluff stripped */
export declare function fetchTargetPageLead(url: string): Promise<string>;
/** Fetch leads for multiple URLs with delay between requests. Returns map of url -> lead. */
export declare function fetchTargetLeadsBatch(urls: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, string>>;
//# sourceMappingURL=targetLead.d.ts.map