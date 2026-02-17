export declare function claimAddPageJob(): Promise<{
    id: string;
    conversation_id: string;
    source_id: string;
    url: string;
} | null>;
export declare function processAddPageJob(job: {
    id: string;
    conversation_id: string;
    source_id: string;
    url: string;
}): Promise<void>;
//# sourceMappingURL=addPageProcessor.d.ts.map