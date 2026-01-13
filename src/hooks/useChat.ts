import { useState, useCallback, useRef, useEffect } from 'react';
import { Message, Conversation } from '@/types/chat';
import { Source } from '@/types/source';
import { generateTitle } from '@/data/mockResponses';
import { generateQuotesForMessage, generateSourcedResponse } from '@/data/mockSourceContent';

const generateId = () => Math.random().toString(36).substring(2, 15);

const initialConversations: Conversation[] = [];

export const useChat = () => {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<string>('');
  
  // Track crawl intervals per source
  const crawlIntervals = useRef<Map<string, NodeJS.Timeout>>(new Map());

  const activeConversation = conversations.find(c => c.id === activeConversationId) || null;
  
  // Get sources for current conversation
  const currentSources = activeConversation?.sources || [];

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      crawlIntervals.current.forEach(interval => clearInterval(interval));
    };
  }, []);

  const createNewConversation = useCallback(() => {
    // Clear any running crawl intervals
    crawlIntervals.current.forEach(interval => clearInterval(interval));
    crawlIntervals.current.clear();
    
    setActiveConversationId(null);
    setStreamingMessage('');
  }, []);

  const selectConversation = useCallback((id: string) => {
    // Clear intervals from previous conversation
    crawlIntervals.current.forEach(interval => clearInterval(interval));
    crawlIntervals.current.clear();
    
    setActiveConversationId(id);
    setStreamingMessage('');
    
    // Restart crawl simulations for crawling sources in the selected conversation
    const conversation = conversations.find(c => c.id === id);
    if (conversation) {
      conversation.sources
        .filter(s => s.status === 'crawling')
        .forEach(source => {
          startCrawlSimulation(source.id, id);
        });
    }
  }, [conversations]);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      // Clear intervals
      crawlIntervals.current.forEach(interval => clearInterval(interval));
      crawlIntervals.current.clear();
      setActiveConversationId(null);
    }
  }, [activeConversationId]);

  const startCrawlSimulation = useCallback((sourceId: string, conversationId: string) => {
    const interval = setInterval(() => {
      setConversations(prev => {
        const conversation = prev.find(c => c.id === conversationId);
        if (!conversation) {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
          return prev;
        }
        
        const source = conversation.sources.find(s => s.id === sourceId);
        if (!source || source.status !== 'crawling') {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
          return prev;
        }

        const newPagesIndexed = Math.min(source.pagesIndexed + 1, source.totalPages);
        const isComplete = newPagesIndexed >= source.totalPages;

        const updatedPages = source.discoveredPages.map((page, index) => ({
          ...page,
          status: index < newPagesIndexed ? 'indexed' as const : page.status,
        }));

        if (isComplete) {
          clearInterval(interval);
          crawlIntervals.current.delete(sourceId);
        }

        return prev.map(c =>
          c.id === conversationId
            ? {
                ...c,
                sources: c.sources.map(s =>
                  s.id === sourceId
                    ? {
                        ...s,
                        status: isComplete ? 'ready' as const : 'crawling' as const,
                        pagesIndexed: newPagesIndexed,
                        discoveredPages: updatedPages,
                        lastUpdated: isComplete ? new Date() : s.lastUpdated,
                      }
                    : s
                ),
              }
            : c
        );
      });
    }, 300 + Math.random() * 500);

    crawlIntervals.current.set(sourceId, interval);
  }, []);

  const updateConversationSources = useCallback((sources: Source[]) => {
    if (!activeConversationId) return;
    
    setConversations(prev =>
      prev.map(c =>
        c.id === activeConversationId
          ? { ...c, sources, updatedAt: new Date() }
          : c
      )
    );
  }, [activeConversationId]);

  const addSourceToConversation = useCallback((source: Source) => {
    let conversationId = activeConversationId;
    
    if (!conversationId) {
      // Create a new conversation first
      conversationId = generateId();
      const newConversation: Conversation = {
        id: conversationId,
        title: 'New Research',
        messages: [],
        sources: [source],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(conversationId);
    } else {
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId
            ? { ...c, sources: [...c.sources, source], updatedAt: new Date() }
            : c
        )
      );
    }
    
    // Start crawl simulation
    startCrawlSimulation(source.id, conversationId);
    
    return conversationId;
  }, [activeConversationId, startCrawlSimulation]);

  const removeSourceFromConversation = useCallback((sourceId: string) => {
    // Clear interval
    const interval = crawlIntervals.current.get(sourceId);
    if (interval) {
      clearInterval(interval);
      crawlIntervals.current.delete(sourceId);
    }
    
    if (!activeConversationId) return;
    
    setConversations(prev =>
      prev.map(c =>
        c.id === activeConversationId
          ? { ...c, sources: c.sources.filter(s => s.id !== sourceId), updatedAt: new Date() }
          : c
      )
    );
  }, [activeConversationId]);

  const recrawlSource = useCallback((sourceId: string) => {
    if (!activeConversationId) return;
    
    // Clear existing interval
    const existingInterval = crawlIntervals.current.get(sourceId);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    setConversations(prev =>
      prev.map(c =>
        c.id === activeConversationId
          ? {
              ...c,
              sources: c.sources.map(s =>
                s.id === sourceId
                  ? {
                      ...s,
                      status: 'crawling' as const,
                      pagesIndexed: 0,
                      discoveredPages: s.discoveredPages.map(p => ({ ...p, status: 'pending' as const })),
                    }
                  : s
              ),
            }
          : c
      )
    );

    startCrawlSimulation(sourceId, activeConversationId);
  }, [activeConversationId, startCrawlSimulation]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading) return;

    const userMessage: Message = {
      id: generateId(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };

    let conversationId = activeConversationId;
    let conversationSources: Source[] = [];

    if (!conversationId) {
      conversationId = generateId();
      const newConversation: Conversation = {
        id: conversationId,
        title: generateTitle(content),
        messages: [userMessage],
        sources: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setConversations(prev => [newConversation, ...prev]);
      setActiveConversationId(conversationId);
      conversationSources = [];
    } else {
      const conversation = conversations.find(c => c.id === conversationId);
      conversationSources = conversation?.sources || [];
      
      setConversations(prev =>
        prev.map(c =>
          c.id === conversationId
            ? { ...c, messages: [...c.messages, userMessage], updatedAt: new Date() }
            : c
        )
      );
    }

    setIsLoading(true);
    setStreamingMessage('');

    // Get ready sources for quote generation
    const readySources = conversationSources.filter(s => s.status === 'ready');
    const crawlingSources = conversationSources.filter(s => s.status === 'crawling');

    // Generate response based on sources
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

    const assistantMessage: Message = {
      id: generateId(),
      role: 'assistant',
      content: fullResponse,
      timestamp: new Date(),
      quotes,
      sourcesUsed,
    };

    setConversations(prev =>
      prev.map(c =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, assistantMessage], updatedAt: new Date() }
          : c
      )
    );

    setStreamingMessage('');
    setIsLoading(false);
  }, [activeConversationId, isLoading, conversations]);

  return {
    conversations,
    activeConversation,
    activeConversationId,
    currentSources,
    isLoading,
    streamingMessage,
    createNewConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    addSourceToConversation,
    removeSourceFromConversation,
    recrawlSource,
    updateConversationSources,
  };
};
