export declare function stripLeadFluff(text: string): string;
export declare function fetchTargetPageLead(url: string): Promise<string>;
export declare function fetchTargetLeadsBatch(urls: string[], onProgress?: (done: number, total: number) => void): Promise<Map<string, string>>;
//# sourceMappingURL=targetLead.d.ts.map