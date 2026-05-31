import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConversations, useCreateConversation, useDeleteConversation, useUpdateConversation, useDeleteAllConversations, DELETE_ALL_CONVERSATIONS_EVENT } from './useConversations';
import { useMessages, useCreateMessage, useUpdateMessage } from './useMessages';
import { messagesApi } from '@/lib/db/messages';
import { useConversationSources, useAddSourceToConversation, useRemoveSourceFromConversation, useCheckExistingSource } from './useConversationSources';
import { recrawlSource as recrawlSourceApi } from '@/lib/db/recrawl';
import { crawlJobsApi } from '@/lib/db';
import {
  LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE,
  PAGE_EDGES_FOR_CONVERSATION,
  PAGE_GRAPH_EDGES_FOR_CONVERSATION,
  PAGES_FOR_CONVERSATION,
  SOURCES_FOR_CONVERSATION,
  CURRENT_CRAWL_JOB_BY_SOURCE,
  LATEST_MAIN_CRAWL_JOB_BY_SOURCES,
  COUNT_OF_DISCOVERED_LINKS_BY_SOURCE,
  COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
  ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE,
  ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION,
} from '@/lib/queryKeys';
import { useSourceWithData } from './useSourceWithData';
import { useRealtimeCrawlUpdates } from './useRealtimeCrawlUpdates';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Conversation as DBConversation, Message as DBMessage, MessageQuote } from '@/lib/db/types';
import type { Conversation, Message, ThoughtProcess } from '@/types/chat';
import type { Source } from '@/types/source';
import { deriveTitleFromUrl } from '@/lib/utils';
import { isAddPagePipelineComplete } from '@/lib/crawlJobProgress';
import { generateTitle } from '@/data/mockResponses';
import { generateQuotesForMessage, generateSourcedResponse } from '@/data/mockSourceContent';
import { consumeRagStream } from '@/lib/consumeRagStream';
import { toast } from 'sonner';

const RAG_INCOMPLETE_MSG =
  'This project runs on Supabase with a per-request time limit for Edge Functions (wall-clock cap on how long one invocation may run). Your question needed more retrieval steps than that limit allows, so the stream closed before the assistant finished. Any partial progress may still be saved—try a narrower question or run again.';


const dbConversationToUI = (db: DBConversation & { dynamic_mode?: boolean }, messages: DBMessage[], sources: Source[]): Conversation => ({
  id: db.id,
  title: db.title,
  messages: messages.map(dbMessageToUI),
  sources,
  dynamicMode: db.dynamic_mode ?? true,
  createdAt: new Date(db.created_at),
  updatedAt: new Date(db.updated_at),
});

type DbQuoteRow = {
  id: string;
  page_id: string;
  snippet: string;
  page_title: string;
  page_path: string;
  domain: string;
  citation_order?: number | null;
  context_before?: string | null;
  context_after?: string | null;
  pages?: { source_id: string } | null;
};

/** Align quote array index with [N] markers in message content (citation_order is 1-based). */
function sortQuotesByCitationOrder(quotes: DbQuoteRow[]): DbQuoteRow[] {
  return [...quotes].sort((a, b) => {
    const ao = a.citation_order;
    const bo = b.citation_order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return 0;
  });
}

const mapQuoteDbToUI = (q: DbQuoteRow): MessageQuote => ({
  id: q.id,
  sourceId: q.pages?.source_id ?? '',
  pageId: q.page_id,
  snippet: q.snippet,
  pageTitle: q.page_title ?? '',
  pagePath: q.page_path ?? '',
  domain: q.domain ?? '',
  ...(q.context_before ? { contextBefore: q.context_before } : {}),
  ...(q.context_after ? { contextAfter: q.context_after } : {}),
});

const dbMessageToUI = (db: DBMessage): Message => {
  const extended = db as DBMessage & {
    quotes?: DbQuoteRow[] | null;
    suggested_page?: { url: string; title: string; snippet: string; sourceId: string; promptedByQuestion?: string; fromPageTitle?: string } | null;
    follows_message_id?: string | null;
    scraped_page_display?: string | null;
    thought_process?: Message['thoughtProcess'] | null;
  };
  const quotesDb = sortQuotesByCitationOrder(extended.quotes ?? []);
  const quotes = quotesDb.map(mapQuoteDbToUI) as Message['quotes'];
  return {
    id: db.id,
    role: db.role,
    content: db.content,
    timestamp: new Date(db.created_at),
    quotes,
    sourcesUsed: [...new Set(quotes.map((q) => q.sourceId))],
    wasMultiStep: db.was_multi_step ?? false,
    suggestedPage: extended.suggested_page ?? undefined,
    followsMessageId: extended.follows_message_id ?? undefined,
    scrapedPageDisplay: extended.scraped_page_display ?? undefined,
    thoughtProcess: extended.thought_process ?? undefined,
  };
};




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
  const [liveThoughtProcess, setLiveThoughtProcess] = useState<ThoughtProcess | null>(null);
  const [ragStreamError, setRagStreamError] = useState<string | null>(null);

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

  const sourceIds = useMemo(() => 
    conversationSourcesData.map(cs => cs.source.id),
    [conversationSourcesData]
  );

  useRealtimeCrawlUpdates(activeConversationId, sourceIds, user?.id ?? null);

  const activeConversationSources: Source[] = conversationSourcesData.map(cs => {
    const db = cs.source;
    return {
      id: db.id,
      initial_url: db.initial_url,
      domain: db.domain,
      status: 'crawling' as const, 
      crawlDepth: db.crawl_depth,
      suggestionMode: (db as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface',
      sameDomainOnly: db.same_domain_only,
      pagesIndexed: 0, 
      totalPages: 0, 
      lastUpdated: new Date(db.updated_at),
      discoveredPages: [], 
    };
  });

  
  const conversations: Conversation[] = dbConversations.map(dbConv => {
    const convMessages = dbMessages.filter(m => m.conversation_id === dbConv.id);
    
    
    
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
      if (activeConversationId === id) {
        setActiveConversationId(null);
      }
      
      
      await deleteConversationMutation.mutateAsync(id);
    } catch (error) {
      console.error('Error deleting conversation:', error);
      throw error; 
    }
  }, [activeConversationId, deleteConversationMutation]);

  const addSourceToConversation = useCallback(async (
    source: Source,
    conversationId?: string
  ) => {
    const targetConvId = conversationId || activeConversationId;
    let finalConvId = targetConvId;
    
    if (!finalConvId) {
      
      const title = deriveTitleFromUrl(source.initial_url) || 'New Research';
      const newConv = await createConversationMutation.mutateAsync(title);
      finalConvId = newConv.id;
      setActiveConversationId(newConv.id);
    }

    const dbSource = await addSourceMutation.mutateAsync({
      conversationId: finalConvId,
      sourceData: {
        conversation_id: finalConvId,
        initial_url: source.initial_url,
        domain: source.domain,
        crawl_depth: source.crawlDepth,
        suggestion_mode: source.suggestionMode ?? 'surface',
        same_domain_only: source.sameDomainOnly,
      },
    });

    
    const suggestionMode: Source['suggestionMode'] = (dbSource as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface';
    return {
      id: dbSource.id,
      initial_url: dbSource.initial_url,
      domain: dbSource.domain,
      status: 'crawling' as const,
      crawlDepth: dbSource.crawl_depth,
      suggestionMode,
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
    await recrawlSourceApi(activeConversationId, sourceId);
    queryClient.invalidateQueries({ queryKey: [SOURCES_FOR_CONVERSATION, activeConversationId] });
    queryClient.invalidateQueries({ queryKey: [PAGES_FOR_CONVERSATION, activeConversationId] });
    queryClient.invalidateQueries({ queryKey: [PAGE_EDGES_FOR_CONVERSATION, activeConversationId] });
    queryClient.invalidateQueries({ queryKey: [LATEST_MAIN_CRAWL_JOB_BY_SOURCES] });
    queryClient.invalidateQueries({ queryKey: [CURRENT_CRAWL_JOB_BY_SOURCE, sourceId] });
    queryClient.invalidateQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, activeConversationId] });
    queryClient.invalidateQueries({ queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, activeConversationId] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        (q.queryKey[0] === COUNT_OF_DISCOVERED_LINKS_BY_SOURCE || q.queryKey[0] === ENCODED_COUNT_OF_DISCOVERED_LINKS_BY_SOURCE),
    });
    
    await queryClient.refetchQueries({ queryKey: [LATEST_MAIN_CRAWL_JOB_BY_SOURCES] });
    await queryClient.refetchQueries({ queryKey: [CURRENT_CRAWL_JOB_BY_SOURCE, sourceId] });
  }, [activeConversationId, queryClient]);

  const updateDynamicMode = useCallback(async (conversationId: string, dynamicMode: boolean) => {
    await updateConversationMutation.mutateAsync({ id: conversationId, dynamic_mode: dynamicMode });
  }, [updateConversationMutation]);

  const addPageToSource = useCallback(async (conversationId: string, sourceId: string, url: string) => {
    const functionsUrl = getFunctionsUrl();
    if (!functionsUrl) {
      console.error('[addPageToSource] Functions URL not configured');
      throw new Error('Functions URL not configured');
    }
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${functionsUrl}/add-page`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ conversationId, sourceId, url }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      let err: { error?: string } = {};
      try {
        err = JSON.parse(errBody);
      } catch {
        err = { error: errBody || `HTTP ${res.status}` };
      }
      throw new Error(err?.error ?? `Failed to add page: ${res.status}`);
    }
    const data = await res.json();

    
    if (data?.page) {
      queryClient.invalidateQueries({ queryKey: [LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE, conversationId, sourceId] });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: [PAGES_FOR_CONVERSATION, conversationId] });
      queryClient.invalidateQueries({ queryKey: [PAGE_EDGES_FOR_CONVERSATION, conversationId] });
      queryClient.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          q.queryKey[0] === PAGE_GRAPH_EDGES_FOR_CONVERSATION &&
          q.queryKey[1] === conversationId,
      });
      queryClient.invalidateQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
      queryClient.invalidateQueries({ queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: [PAGES_FOR_CONVERSATION, conversationId] }),
        queryClient.refetchQueries({
          predicate: (q) =>
            Array.isArray(q.queryKey) &&
            q.queryKey[0] === PAGE_GRAPH_EDGES_FOR_CONVERSATION &&
            q.queryKey[1] === conversationId,
        }),
      ]);
      return data;
    }

    
    const jobId = data?.jobId;
    if (!jobId) {
      throw new Error('Invalid response: missing page or jobId');
    }
    const pollMs = 800;
    const maxAttempts = 180; 
    let finalJob: Awaited<ReturnType<typeof crawlJobsApi.get>> | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      finalJob = await crawlJobsApi.get(jobId);
      if (!finalJob) continue;
      if (finalJob.status === 'failed') {
        throw new Error(finalJob.error_message ?? 'Add page failed');
      }
      if (isAddPagePipelineComplete(finalJob)) break;
    }
    if (finalJob?.status === 'failed') {
      throw new Error(finalJob.error_message ?? 'Add page failed');
    }
    if (finalJob && !isAddPagePipelineComplete(finalJob)) {
      throw new Error('Add page timed out while encoding discovered links');
    }

    queryClient.invalidateQueries({ queryKey: [LATEST_ADD_PAGE_JOB_BY_CONVERSATION_AND_SOURCE, conversationId, sourceId] });
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    queryClient.invalidateQueries({ queryKey: [PAGES_FOR_CONVERSATION, conversationId] });
    queryClient.invalidateQueries({ queryKey: [PAGE_EDGES_FOR_CONVERSATION, conversationId] });
    queryClient.invalidateQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
    queryClient.invalidateQueries({ queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] });
    await Promise.all([
      queryClient.refetchQueries({ queryKey: [PAGES_FOR_CONVERSATION, conversationId] }),
      queryClient.refetchQueries({ queryKey: [PAGE_EDGES_FOR_CONVERSATION, conversationId] }),
      queryClient.refetchQueries({ queryKey: [COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] }),
      queryClient.refetchQueries({ queryKey: [ENCODED_COUNTS_OF_DISCOVERED_LINKS_BY_CONVERSATION, conversationId] }),
    ]);
    return { page: {}, message: 'Page added' };
  }, [queryClient]);

  const addPageAndContinueResponse = useCallback(async (
    conversationId: string,
    sourceId: string,
    url: string,
    messageId: string,
    userMessage: string,
    scrapedPageDisplay?: string,
  ) => {
    const functionsUrl = getFunctionsUrl();
    if (!functionsUrl) throw new Error('Functions URL not configured');

    
    await updateMessageMutation.mutateAsync({
      id: messageId,
      conversationId,
      updates: { suggested_page: null },
    });

    await addPageToSource(conversationId, sourceId, url);
    await new Promise((r) => setTimeout(r, 500));

    setIsLoading(true);
    setStreamingMessage('');
    setRagStepProgress([]);
    setLiveThoughtProcess(null);
    setRagStreamError(null);

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
          userMessage: userMessage.trim(),
          appendToMessageId: messageId,
          scrapedPageDisplay: scrapedPageDisplay ?? undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const outcome = await consumeRagStream(res.body, {
        onThoughtProcess: setLiveThoughtProcess,
        onPlan: (slots) => setLiveThoughtProcess((prev) => ({ ...prev, slots, steps: prev?.steps ?? [] })),
        onStepProgress: setRagStepProgress,
        onDone: () => {
          setLiveThoughtProcess(null);
          setRagStreamError(null);
          queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        },
        onError: (msg) => {
          throw new Error(msg);
        },
      });
      if (outcome === 'incomplete') {
        setRagStreamError(RAG_INCOMPLETE_MSG);
        toast.error('Assistant stopped early', { description: RAG_INCOMPLETE_MSG });
        queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      } else if (outcome === 'done') {
        queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed';
      setRagStreamError(msg);
      toast.error('Assistant error', { description: msg });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } finally {
      setIsLoading(false);
    }
  }, [queryClient, addPageToSource, updateMessageMutation]);

  const sendMessage = useCallback(async (content: string, _options?: { unfoldMode?: 'unfold' | 'direct' }) => {
    if (!content.trim() || isLoading) {
      return;
    }

    let conversationId = activeConversationId;
    let conversationSources: Source[] = [];

    
    if (!conversationId) {
      const title = generateTitle(content);
      const newConv = await createConversationMutation.mutateAsync(title);
      conversationId = newConv.id;
      setActiveConversationId(conversationId);
      conversationSources = [];
    } else {
      conversationSources = currentSources;
    }

    
    const userMsg = await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'user',
      content: content.trim(),
      was_multi_step: false,
    });

    setIsLoading(true);
    setStreamingMessage('');
    setRagStepProgress([]);
    setLiveThoughtProcess(null);
    setRagStreamError(null);

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
            rootMessageId: userMsg.id,
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
          const outcome = await consumeRagStream(res.body, {
            onThoughtProcess: setLiveThoughtProcess,
            onPlan: (slots) => setLiveThoughtProcess({ slots, steps: [] }),
            onStepProgress: setRagStepProgress,
            onDone: (event) => {
              setLiveThoughtProcess(null);
              setRagStreamError(null);
              queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
              if (typeof event.suggestedTitle === 'string') {
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
              }
            },
            onError: (msg) => {
              ragFailed = true;
              ragError = msg;
            },
          });
          if (outcome === 'done') {
            setIsLoading(false);
            return;
          }
          if (outcome === 'incomplete') {
            ragFailed = true;
            ragError = RAG_INCOMPLETE_MSG;
            setRagStreamError(RAG_INCOMPLETE_MSG);
            toast.error('Assistant stopped early', { description: RAG_INCOMPLETE_MSG });
            queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
          } else if (outcome === 'error' && ragError) {
            setRagStreamError(ragError);
            toast.error('Assistant error', { description: ragError });
            queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
          }
          if (!ragFailed) {
            setIsLoading(false);
            return;
          }
        }
      } catch (e) {
        ragFailed = true;
        ragError = e instanceof Error ? e.message : 'Network or request failed';
        setRagStreamError(ragError);
        toast.error('Assistant error', { description: ragError });
        console.error('[chat-with-rag]', ragError);
      }
    }

    if (ragFailed && hasSources) {
      const rawError = ragError ?? '';
      const lower = rawError.toLowerCase();
      let friendlyError: string;
      if (lower.includes('signal') && lower.includes('aborted')) {
        friendlyError = 'The request timed out — the assistant took too long to respond. Try again, or simplify your question.';
      } else if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network error')) {
        friendlyError = 'Network error — could not reach the server. Check your connection and try again.';
      } else if (rawError) {
        friendlyError = rawError;
      } else {
        friendlyError = "The assistant couldn't finish. Make sure the crawl has finished and chunks are indexed, then try again.";
      }
      await createMessageMutation.mutateAsync({
        conversation_id: conversationId,
        role: 'assistant',
        content: `__error__:${friendlyError}`,
        was_multi_step: false,
      });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      setStreamingMessage('');
      setIsLoading(false);
      return;
    }

    const fullResponse = generateSourcedResponse(
      content,
      readySources.length > 0,
      crawlingSources.length > 0,
    );

    const words = fullResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 20));
      setStreamingMessage((prev) => prev + (i === 0 ? '' : ' ') + words[i]);
    }

    await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'assistant',
      content: fullResponse,
      was_multi_step: false,
    });

    setStreamingMessage('');
    setIsLoading(false);
  }, [activeConversationId, isLoading, currentSources, createConversationMutation, createMessageMutation, queryClient]);

  const editAndResendMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!activeConversationId) return;
    await messagesApi.deleteFrom(activeConversationId, messageId);
    await queryClient.refetchQueries({ queryKey: ['messages', activeConversationId] });
    await sendMessage(newContent);
  }, [activeConversationId, queryClient, sendMessage]);

  return {
    conversations,
    activeConversation,
    activeConversationId,
    currentSources,
    isLoading: isLoading || conversationsLoading,
    streamingMessage,
    ragStepProgress,
    liveThoughtProcess,
    ragStreamError,
    createNewConversation,
    selectConversation,
    deleteConversation,
    sendMessage,
    editAndResendMessage,
    addSourceToConversation,
    removeSourceFromConversation,
    recrawlSource,
    updateDynamicMode,
    addPageToSource,
    addPageAndContinueResponse,
  };
};