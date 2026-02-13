import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConversations, useCreateConversation, useDeleteConversation, useUpdateConversation } from './useConversations';
import { useMessages, useCreateMessage } from './useMessages';
import { useConversationSources, useAddSourceToConversation, useRemoveSourceFromConversation, useCheckExistingSource } from './useConversationSources';
import { useSourceWithData } from './useSourceWithData';
import { useRealtimeCrawlUpdates } from './useRealtimeCrawlUpdates';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Conversation as DBConversation, Message as DBMessage } from '@/lib/db/types';
import type { Conversation, Message } from '@/types/chat';
import type { Source } from '@/types/source';
import { generateTitle } from '@/data/mockResponses';
import { generateQuotesForMessage, generateSourcedResponse } from '@/data/mockSourceContent';

// Convert database types to UI types
const dbConversationToUI = (db: DBConversation, messages: DBMessage[], sources: Source[]): Conversation => ({
  id: db.id,
  title: db.title,
  messages: messages.map(dbMessageToUI),
  sources,
  createdAt: new Date(db.created_at),
  updatedAt: new Date(db.updated_at),
});

const dbMessageToUI = (db: DBMessage): Message => {
  const quotes = (db as DBMessage & { quotes?: { id: string; sourceId: string; pageId: string; snippet: string; pageTitle: string; pagePath: string; domain: string; contextBefore?: string; contextAfter?: string }[] }).quotes ?? [];
  return {
    id: db.id,
    role: db.role,
    content: db.content,
    timestamp: new Date(db.created_at),
    quotes: quotes as Message['quotes'],
    sourcesUsed: [...new Set(quotes.map((q) => q.sourceId))],
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

  // Database hooks
  const { data: dbConversations = [], isLoading: conversationsLoading } = useConversations();
  const createConversationMutation = useCreateConversation();
  const deleteConversationMutation = useDeleteConversation();
  const updateConversationMutation = useUpdateConversation();

  const { data: dbMessages = [] } = useMessages(activeConversationId);
  const createMessageMutation = useCreateMessage();

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
  const currentSources = activeConversation?.sources || [];

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
      // Create conversation first
      const newConv = await createConversationMutation.mutateAsync();
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
    // This will be handled by creating a new crawl job
    // For now, we'll just trigger a re-crawl by updating the source
    // The worker will handle the actual crawling
    if (!activeConversationId) return;
    // TODO: Implement recrawl logic (create new crawl job)
  }, [activeConversationId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

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
        if (res.ok) {
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
          setStreamingMessage('');
          setIsLoading(false);
          return;
        }
        ragFailed = true;
        try {
          const body = await res.json();
          ragError = body?.error ?? body?.message ?? `HTTP ${res.status}`;
        } catch {
          ragError = `HTTP ${res.status}`;
        }
        console.error('[chat-with-rag]', res.status, ragError);
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
    createNewConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    addSourceToConversation,
    removeSourceFromConversation,
    recrawlSource,
  };
};
