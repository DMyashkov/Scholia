/**
 * Sources are now one-to-many with conversations (sources.conversation_id).
 * This module provides backward-compatible API that proxies to sources.
 * @deprecated Prefer sourcesApi.listByConversation, sourcesApi.create, sourcesApi.delete directly.
 */
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
    const existingJobs = await crawlJobsApi.listBySource(sourceId);
    const activeJob = existingJobs.find((j) => j.status === 'queued' || j.status === 'running');
    if (!activeJob) {
      await crawlJobsApi.create({
        source_id: sourceId,
        conversation_id: conversationId,
        status: 'queued',
        pages_indexed: 0,
        indexed_count: 0,
        discovered_count: 0,
        links_count: 0,
        total_pages: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        last_activity_at: null,
      });
    }
    return { id: sourceId, conversation_id: conversationId, source_id: sourceId } as { id: string; conversation_id: string; source_id: string };
  },

  async remove(conversationId: string, sourceId: string) {
    await sourcesApi.delete(sourceId);
  },
};
