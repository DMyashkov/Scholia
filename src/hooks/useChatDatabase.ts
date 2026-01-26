import { useState, useCallback, useMemo } from 'react';
import { useConversations, useCreateConversation, useDeleteConversation, useUpdateConversation } from './useConversations';
import { useMessages, useCreateMessage } from './useMessages';
import { useConversationSources, useAddSourceToConversation, useRemoveSourceFromConversation, useCheckExistingSource } from './useConversationSources';
import { useSourceWithData } from './useSourceWithData';
import { useRealtimeCrawlUpdates } from './useRealtimeCrawlUpdates';
import { useAuthContext } from '@/contexts/AuthContext';
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

const dbMessageToUI = (db: DBMessage): Message => ({
  id: db.id,
  role: db.role,
  content: db.content,
  timestamp: new Date(db.created_at),
  // Quotes and sourcesUsed will be added when we implement citations
  quotes: [],
  sourcesUsed: [],
});

// Helper component to load sources with data
// We'll use this in the component tree instead

export const useChatDatabase = () => {
  const { user } = useAuthContext();
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

    // Add source to conversation (always creates new crawl, no sharing)
    await addSourceMutation.mutateAsync({
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
    const userMessage = await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'user',
      content: content.trim(),
    });

    setIsLoading(true);
    setStreamingMessage('');

    // Get ready sources for quote generation
    const readySources = conversationSources.filter(s => s.status === 'ready');
    const crawlingSources = conversationSources.filter(s => s.status === 'crawling');

    // Generate response (still using mock for now - will replace with real AI later)
    const fullResponse = generateSourcedResponse(
      content,
      readySources.length > 0,
      crawlingSources.length > 0
    );

    // Generate quotes if we have ready sources
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

    const sourcesUsed = [...new Set(quotes.map(q => q.sourceId))];

    // Simulate streaming
    const words = fullResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 20));
      setStreamingMessage(prev => prev + (i === 0 ? '' : ' ') + words[i]);
    }

    // Create assistant message
    await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'assistant',
      content: fullResponse,
    });

    setStreamingMessage('');
    setIsLoading(false);
  }, [activeConversationId, isLoading, currentSources, createConversationMutation, createMessageMutation]);

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
