




import { sourcesApi } from './sources';
import { crawlJobsApi } from './crawl-jobs';
import type { Source } from './types';

export const conversationSourcesApi = {
  async list(conversationId: string) {
    const sources = await sourcesApi.listByConversation(conversationId);
    return sources.map((source) => ({
      conversation_id: source.conversation_id,
      source_id: source.id,
      created_at: (source as Source & { created_at?: string }).created_at ?? new Date().toISOString(),
      source,
    }));
  },

  async findConversationsWithSourceUrl(sourceUrl: string, excludeConversationId?: string) {
    return sourcesApi.findConversationsWithUrl(sourceUrl, excludeConversationId);
  },

  async add(conversationId: string, sourceId: string, skipCrawlJob?: boolean) {
    if (skipCrawlJob) return { id: sourceId, conversation_id: conversationId, source_id: sourceId } as { id: string; conversation_id: string; source_id: string };
    await crawlJobsApi.createMainCrawlJobIfNeeded(sourceId);
    return { id: sourceId, conversation_id: conversationId, source_id: sourceId } as { id: string; conversation_id: string; source_id: string };
  },

  async remove(conversationId: string, sourceId: string) {
    await sourcesApi.delete(sourceId);
  },
};