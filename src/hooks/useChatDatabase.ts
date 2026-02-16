import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConversations, useCreateConversation, useDeleteConversation, useUpdateConversation, useDeleteAllConversations, DELETE_ALL_CONVERSATIONS_EVENT } from './useConversations';
import { useMessages, useCreateMessage, useUpdateMessage } from './useMessages';
import { useConversationSources, useAddSourceToConversation, useRemoveSourceFromConversation, useCheckExistingSource } from './useConversationSources';
import { recrawlSource as recrawlSourceApi } from '@/lib/db/recrawl';
import { useSourceWithData } from './useSourceWithData';
import { useRealtimeCrawlUpdates } from './useRealtimeCrawlUpdates';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Conversation as DBConversation, Message as DBMessage } from '@/lib/db/types';
import type { Conversation, Message } from '@/types/chat';
import type { Source } from '@/types/source';
import { deriveTitleFromUrl } from '@/lib/utils';
import { generateTitle } from '@/data/mockResponses';
import { generateQuotesForMessage, generateSourcedResponse } from '@/data/mockSourceContent';

// Convert database types to UI types
const dbConversationToUI = (db: DBConversation & { dynamic_mode?: boolean }, messages: DBMessage[], sources: Source[]): Conversation => ({
  id: db.id,
  title: db.title,
  messages: messages.map(dbMessageToUI),
  sources,
  dynamicMode: db.dynamic_mode ?? true,
  createdAt: new Date(db.created_at),
  updatedAt: new Date(db.updated_at),
});

const dbMessageToUI = (db: DBMessage): Message => {
  const extended = db as DBMessage & {
    quotes?: { id: string; sourceId: string; pageId: string; snippet: string; pageTitle: string; pagePath: string; domain: string; contextBefore?: string; contextAfter?: string }[];
    suggested_pages?: { url: string; title: string; contextSnippet: string; sourceId: string; promptedByQuestion?: string; fromPageTitle?: string }[];
    follows_message_id?: string | null;
    indexed_page_display?: string | null;
  };
  const quotes = extended.quotes ?? [];
  return {
    id: db.id,
    role: db.role,
    content: db.content,
    timestamp: new Date(db.created_at),
    quotes: quotes as Message['quotes'],
    sourcesUsed: [...new Set(quotes.map((q) => q.sourceId))],
    wasMultiStep: db.was_multi_step ?? false,
    suggestedPages: extended.suggested_pages,
    followsMessageId: extended.follows_message_id ?? undefined,
    indexedPageDisplay: extended.indexed_page_display ?? undefined,
  };
};

// Helper component to load sources with data
// We'll use this in the component tree instead

const getFunctionsUrl = () => {
  const url = import.meta.env.SUPABASE_URL || '';
  return url ? `${url.replace(/\/$/, '')}/functions/v1` : '';
};

export const useChatDatabase = () => {
  const { user } = useAuthContext();
  const queryClient = useQueryClient();
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  const [ragStepProgress, setRagStepProgress] = useState<Array<{ current: number; total: number; label: string }>>([]);

  // Database hooks
  const { data: dbConversations = [], isLoading: conversationsLoading } = useConversations();
  const createConversationMutation = useCreateConversation();
  const deleteConversationMutation = useDeleteConversation();

  useEffect(() => {
    const handler = () => setActiveConversationId(null);
    window.addEventListener(DELETE_ALL_CONVERSATIONS_EVENT, handler);
    return () => window.removeEventListener(DELETE_ALL_CONVERSATIONS_EVENT, handler);
  }, []);
  const updateConversationMutation = useUpdateConversation();

  const { data: dbMessages = [] } = useMessages(activeConversationId);
  const createMessageMutation = useCreateMessage();
  const updateMessageMutation = useUpdateMessage();

  const { data: conversationSourcesData = [] } = useConversationSources(activeConversationId);
  const addSourceMutation = useAddSourceToConversation();
  const removeSourceMutation = useRemoveSourceFromConversation();
  const checkExistingSourceMutation = useCheckExistingSource();

  // Get source IDs for realtime subscriptions
  const sourceIds = useMemo(() => 
    conversationSourcesData.map(cs => cs.source.id),
    [conversationSourcesData]
  );

  // Set up realtime subscriptions for crawl updates
  useRealtimeCrawlUpdates(activeConversationId, sourceIds);

  // Load sources with full data (pages, crawl jobs)
  // Note: We can't use hooks in a map, so we'll create a component that uses the hook
  // For now, create sources with minimal data - the UI components will load full data
  // Default to 'crawling' status since a crawl job should be created when source is added
  const activeConversationSources: Source[] = conversationSourcesData.map(cs => {
    const db = cs.source;
    return {
      id: db.id,
      url: db.url,
      domain: db.domain,
      favicon: db.favicon || undefined,
      status: 'crawling' as const, // Default to crawling - SidebarCrawlPanel will update based on actual crawl job
      crawlDepth: db.crawl_depth,
      includeSubpages: db.include_subpages,
      includePdfs: db.include_pdfs,
      sameDomainOnly: db.same_domain_only,
      pagesIndexed: 0, // Will be updated by realtime
      totalPages: 0, // Will be updated by realtime
      lastUpdated: new Date(db.updated_at),
      discoveredPages: [], // Will be loaded by usePages hook in components
    };
  });

  // Convert to UI format
  const conversations: Conversation[] = dbConversations.map(dbConv => {
    const convMessages = dbMessages.filter(m => m.conversation_id === dbConv.id);
    
    // Get sources for this specific conversation
    // Only populate sources for active conversation (others will be empty)
    const convSources = dbConv.id === activeConversationId
      ? activeConversationSources
      : [];
    
    return dbConversationToUI(dbConv, convMessages, convSources);
  });

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;
  const currentSources = useMemo(
    () => activeConversation?.sources || [],
    [activeConversation?.sources]
  );

  const createNewConversation = useCallback(() => {
    setActiveConversationId(null);
    setStreamingMessage('');
  }, []);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setStreamingMessage('');
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    try {
      // Clear active conversation first if it's the one being deleted
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      
      // Delete the conversation
      await deleteConversationMutation.mutateAsync(id);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw error; // Re-throw so UI can handle it
    }
  }, [activeConversationId, deleteConversationMutation]);

  const addSourceToConversation = useCallback(async (
    source: Source,
    conversationId?: string
  ) => {
    const targetConvId = conversationId || activeConversationId;
    let finalConvId = targetConvId;
    
    if (!finalConvId) {
      // Create conversation first with title from first source
      const title = deriveTitleFromUrl(source.url) || 'New Research';
      const newConv = await createConversationMutation.mutateAsync(title);
      finalConvId = newConv.id;
      setActiveConversationId(newConv.id);
    }

    const dbSource = await addSourceMutation.mutateAsync({
      conversationId: finalConvId,
      sourceData: {
        url: source.url,
        domain: source.domain,
        favicon: source.favicon,
        crawl_depth: source.crawlDepth,
        include_subpages: source.includeSubpages,
        include_pdfs: source.includePdfs,
        same_domain_only: source.sameDomainOnly,
      },
    });

    // Map db source to UI Source for the caller (e.g. to select and open drawer).
    return {
      id: dbSource.id,
      url: dbSource.url,
      domain: dbSource.domain,
      favicon: dbSource.favicon ?? undefined,
      status: 'crawling' as const,
      crawlDepth: dbSource.crawl_depth,
      includeSubpages: dbSource.include_subpages,
      includePdfs: dbSource.include_pdfs,
      sameDomainOnly: dbSource.same_domain_only,
      pagesIndexed: 0,
      totalPages: 0,
      lastUpdated: new Date(dbSource.updated_at),
      discoveredPages: [],
    };
  }, [activeConversationId, createConversationMutation, addSourceMutation]);

  const removeSourceFromConversation = useCallback(async (sourceId: string) => {
    if (!activeConversationId) return;
    await removeSourceMutation.mutateAsync({
      conversationId: activeConversationId,
      sourceId,
    });
  }, [activeConversationId, removeSourceMutation]);

  const recrawlSource = useCallback(async (sourceId: string) => {
    if (!activeConversationId) return;
    console.log('[recrawl] useChatDatabase: calling recrawl API', { activeConversationId: activeConversationId.slice(0, 8), sourceId: sourceId.slice(0, 8) });
    await recrawlSourceApi(activeConversationId, sourceId);
    console.log('[recrawl] useChatDatabase: API done, invalidating + refetching queries');
    queryClient.invalidateQueries({ queryKey: ['conversation-sources', activeConversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-pages', activeConversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-page-edges', activeConversationId] });
    queryClient.invalidateQueries({ queryKey: ['crawl-jobs-for-sources'] });
    queryClient.invalidateQueries({ queryKey: ['crawl-job', sourceId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', activeConversationId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-encoded-counts', activeConversationId] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        (q.queryKey[0] === 'discovered-links-count' || q.queryKey[0] === 'discovered-links-encoded-count'),
    });
    // Force immediate refetch of crawl jobs so UI updates right away
    await queryClient.refetchQueries({ queryKey: ['crawl-jobs-for-sources'] });
    await queryClient.refetchQueries({ queryKey: ['crawl-job', sourceId] });
    console.log('[recrawl] useChatDatabase: refetch complete');
  }, [activeConversationId, queryClient]);

  const updateDynamicMode = useCallback(async (conversationId: string, dynamicMode: boolean) => {
    await updateConversationMutation.mutateAsync({ id: conversationId, dynamic_mode: dynamicMode });
  }, [updateConversationMutation]);

  const addPageToSource = useCallback(async (conversationId: string, sourceId: string, url: string) => {
    const functionsUrl = getFunctionsUrl();
    console.log('[addPageToSource] start', { conversationId, sourceId, url, functionsUrl });
    if (!functionsUrl) {
      console.error('[addPageToSource] Functions URL not configured');
      throw new Error('Functions URL not configured');
    }
    const { data: { session } } = await supabase.auth.getSession();
    console.log('[addPageToSource] auth:', { hasSession: !!session?.access_token });
    const res = await fetch(`${functionsUrl}/add-page`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ conversationId, sourceId, url }),
    });
    console.log('[addPageToSource] fetch response', { status: res.status, ok: res.ok });
    if (!res.ok) {
      const errBody = await res.text();
      let err: { error?: string } = {};
      try {
        err = JSON.parse(errBody);
      } catch {
        err = { error: errBody || `HTTP ${res.status}` };
      }
      console.error('[addPageToSource] fetch failed', { status: res.status, body: errBody });
      throw new Error(err?.error ?? `Failed to add page: ${res.status}`);
    }
    const data = await res.json();
    const dl = data?.discoveredLinks;
    console.log('[addPageToSource] success', data?.page ? { pageId: data.page.id?.slice(0, 8), discoveredLinks: dl ?? 'N/A' } : data);
    if (dl) console.log('[addPageToSource] discovered_links:', dl.extracted, 'extracted,', dl.new, 'new (overlap =', dl.extracted - dl.new, 'already in graph)');
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-pages', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-page-edges', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', conversationId] });
    // Refetch pages/edges so UI and RAG caller have latest before re-asking
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['conversation-pages', conversationId] }),
      queryClient.refetchQueries({ queryKey: ['conversation-page-edges', conversationId] }),
      queryClient.refetchQueries({ queryKey: ['discovered-links-counts', conversationId] }),
    ]);
    return data;
  }, [queryClient]);

  const addPageAndContinueResponse = useCallback(async (
    conversationId: string,
    sourceId: string,
    url: string,
    messageId: string,
    userMessage: string,
    indexedPageDisplay?: string
  ) => {
    const functionsUrl = getFunctionsUrl();
    if (!functionsUrl) throw new Error('Functions URL not configured');

    // Clear suggested_pages immediately so the card disappears (persists on reload)
    await updateMessageMutation.mutateAsync({
      id: messageId,
      conversationId,
      updates: { suggested_pages: null },
    });

    await addPageToSource(conversationId, sourceId, url);
    await new Promise((r) => setTimeout(r, 500));

    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${functionsUrl}/chat-with-rag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        conversationId,
        userMessage: userMessage.trim(),
        appendToMessageId: messageId,
        indexedPageDisplay: indexedPageDisplay ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
    }
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            if (event.error) throw new Error(String(event.error));
            if (event.done === true) {
              queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
              return;
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue;
            throw e;
          }
        }
      }
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer) as Record<string, unknown>;
          if (event.done === true) {
            queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
            return;
          }
          if (event.error) throw new Error(String(event.error));
        } catch {
          /* ignore */
        }
      }
    }
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
  }, [queryClient, addPageToSource, updateMessageMutation]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) {
      console.log('[sendMessage] early return', { hasContent: !!content?.trim(), isLoading });
      return;
    }

    let conversationId = activeConversationId;
    let conversationSources: Source[] = [];

    // Create conversation if needed
    if (!conversationId) {
      const title = generateTitle(content);
      const newConv = await createConversationMutation.mutateAsync(title);
      conversationId = newConv.id;
      setActiveConversationId(conversationId);
      conversationSources = [];
    } else {
      conversationSources = currentSources;
    }

    // Create user message
    await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'user',
      content: content.trim(),
    });

    setIsLoading(true);
    setStreamingMessage('');
    setRagStepProgress([]);

    const readySources = conversationSources.filter(s => s.status === 'ready');
    const crawlingSources = conversationSources.filter(s => s.status === 'crawling');
    const hasSources = conversationSources.length > 0;
    const functionsUrl = getFunctionsUrl();

    let ragFailed = false;
    let ragError: string | null = null;
    if (hasSources && functionsUrl) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`${functionsUrl}/chat-with-rag`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            conversationId,
            userMessage: content.trim(),
          }),
        });
        if (!res.ok) {
          ragFailed = true;
          try {
            const body = await res.json();
            ragError = body?.error ?? body?.message ?? `HTTP ${res.status}`;
          } catch {
            ragError = `HTTP ${res.status}`;
          }
          console.error('[chat-with-rag]', res.status, ragError);
        } else {
          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          const steps: { current: number; total: number; label: string }[] = [];
          if (reader) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                  if (!line.trim()) continue;
                  try {
                    const event = JSON.parse(line) as Record<string, unknown>;
                    if (event.step != null && event.label && event.totalSteps != null) {
                      const current = Number(event.step);
                      const total = Number(event.totalSteps);
                      const label = String(event.label);
                      const idx = steps.findIndex(s => s.current === current);
                      if (idx >= 0) {
                        steps[idx] = { current, total, label };
                      } else {
                        steps.push({ current, total, label });
                        steps.sort((a, b) => a.current - b.current);
                      }
                      setRagStepProgress([...steps]);
                    }
                    if (event.done === true && event.message) {
                      const ev = event as { suggestedTitle?: string };
                      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                      if (ev.suggestedTitle) {
                        console.log('[chat] RAG returned suggestedTitle:', JSON.stringify(ev.suggestedTitle), '| invalidating conversations to refresh sidebar');
                        queryClient.invalidateQueries({ queryKey: ['conversations'] });
                      } else {
                        console.log('[chat] RAG done event received with no suggestedTitle (first-message title update skipped or not first message)');
                      }
                      setIsLoading(false);
                      return;
                    }
                    if (event.error) {
                      ragFailed = true;
                      ragError = String(event.error);
                      break;
                    }
                  } catch {
                    // ignore parse errors for malformed lines
                  }
                }
              }
              if (buffer.trim()) {
                try {
                  const event = JSON.parse(buffer) as Record<string, unknown> & { suggestedTitle?: string };
                  if (event.done === true && event.message) {
                    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                    if (event.suggestedTitle) {
                      console.log('[chat] RAG returned suggestedTitle (buffer):', JSON.stringify(event.suggestedTitle), '| invalidating conversations to refresh sidebar');
                      queryClient.invalidateQueries({ queryKey: ['conversations'] });
                    } else {
                      console.log('[chat] RAG done event (buffer) with no suggestedTitle');
                    }
                    setIsLoading(false);
                    return;
                  }
                  if (event.error) {
                    ragFailed = true;
                    ragError = String(event.error);
                  }
                } catch {
                  /* ignore */
                }
              }
            } finally {
              // No cleanup needed
            }
          } else {
            queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
          }
          if (ragFailed && ragError) {
            // Fall through to fallback
          } else {
            setIsLoading(false);
            return;
          }
        }
      } catch (e) {
        ragFailed = true;
        ragError = e instanceof Error ? e.message : 'Network or request failed';
        console.error('[chat-with-rag]', ragError);
      }
    }

    // Fallback: mock response (or clear error when RAG was tried but failed)
    const fullResponse = ragFailed && hasSources
      ? (ragError
          ? `The assistant couldn't answer: **${ragError}** — Check that the crawl finished, chunks are indexed, and the Edge Function has the \`OPENAI_API_KEY\` secret set.`
          : "The assistant couldn't answer right now. Make sure the crawl has finished and chunks are indexed (check the source drawer), then try again.")
      : generateSourcedResponse(
          content,
          readySources.length > 0,
          crawlingSources.length > 0
        );

    const quotes = readySources.length > 0
      ? generateQuotesForMessage(
          content,
          readySources.map(s => ({
            id: s.id,
            domain: s.domain,
            pages: s.discoveredPages,
          }))
        )
      : [];

    const words = fullResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 20));
      setStreamingMessage(prev => prev + (i === 0 ? '' : ' ') + words[i]);
    }

    await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'assistant',
      content: fullResponse,
      ...(quotes.length > 0 ? { quotes } : {}),
    });

    setStreamingMessage('');
    setIsLoading(false);
  }, [activeConversationId, isLoading, currentSources, createConversationMutation, createMessageMutation, queryClient]);

  return {
    conversations,
    activeConversation,
    activeConversationId,
    currentSources,
    isLoading: isLoading || conversationsLoading,
    streamingMessage,
    ragStepProgress,
    createNewConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    addSourceToConversation,
    removeSourceFromConversation,
    recrawlSource,
    updateDynamicMode,
    addPageToSource,
    addPageAndContinueResponse,
  };
};
