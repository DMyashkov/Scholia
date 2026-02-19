import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConversations, useCreateConversation, useDeleteConversation, useUpdateConversation, useDeleteAllConversations, DELETE_ALL_CONVERSATIONS_EVENT } from './useConversations';
import { useMessages, useCreateMessage, useUpdateMessage } from './useMessages';
import { useConversationSources, useAddSourceToConversation, useRemoveSourceFromConversation, useCheckExistingSource } from './useConversationSources';
import { recrawlSource as recrawlSourceApi } from '@/lib/db/recrawl';
import { crawlJobsApi } from '@/lib/db';
import { useSourceWithData } from './useSourceWithData';
import { useRealtimeCrawlUpdates } from './useRealtimeCrawlUpdates';
import { useAuthContext } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { Conversation as DBConversation, Message as DBMessage, MessageQuote } from '@/lib/db/types';
import type { Conversation, Message, ThoughtProcess } from '@/types/chat';
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

type DbQuoteRow = {
  id: string;
  page_id: string;
  snippet: string;
  page_title: string;
  page_path: string;
  domain: string;
  context_before?: string | null;
  context_after?: string | null;
  pages?: { source_id: string } | null;
};

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
  const quotesDb = extended.quotes ?? [];
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
  const [liveThoughtProcess, setLiveThoughtProcess] = useState<ThoughtProcess | null>(null);

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
      initial_url: db.initial_url,
      domain: db.domain,
      status: 'crawling' as const, // Default to crawling - SidebarCrawlPanel will update based on actual crawl job
      crawlDepth: db.crawl_depth,
      suggestionMode: (db as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface',
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
      const title = deriveTitleFromUrl(source.initial_url) || 'New Research';
      const newConv = await createConversationMutation.mutateAsync(title);
      finalConvId = newConv.id;
      setActiveConversationId(newConv.id);
    }

    const dbSource = await addSourceMutation.mutateAsync({
      conversationId: finalConvId,
      sourceData: {
        initial_url: source.initial_url,
        domain: source.domain,
        crawl_depth: source.crawlDepth,
        suggestion_mode: source.suggestionMode ?? 'surface',
        same_domain_only: source.sameDomainOnly,
      },
    });

    // Map db source to UI Source for the caller (e.g. to select and open drawer).
    return {
      id: dbSource.id,
      initial_url: dbSource.initial_url,
      domain: dbSource.domain,
      status: 'crawling' as const,
      crawlDepth: dbSource.crawl_depth,
      suggestionMode: (dbSource as { suggestion_mode?: string }).suggestion_mode === 'dive' ? 'dive' : 'surface',
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
    queryClient.invalidateQueries({ queryKey: ['crawl-jobs-main-for-sources'] });
    queryClient.invalidateQueries({ queryKey: ['crawl-job', sourceId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', activeConversationId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-encoded-counts', activeConversationId] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        (q.queryKey[0] === 'discovered-links-count' || q.queryKey[0] === 'discovered-links-encoded-count'),
    });
    // Force immediate refetch of crawl jobs so UI updates right away
    await queryClient.refetchQueries({ queryKey: ['crawl-jobs-main-for-sources'] });
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

    // Page already exists – done
    if (data?.page) {
      console.log('[addPageToSource] page already exists', data.page.id?.slice(0, 8));
      queryClient.invalidateQueries({ queryKey: ['add-page-job', conversationId, sourceId] });
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversation-pages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['conversation-page-edges', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['discovered-links-encoded-counts', conversationId] });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['conversation-pages', conversationId] }),
        queryClient.refetchQueries({ queryKey: ['conversation-page-edges', conversationId] }),
        queryClient.refetchQueries({ queryKey: ['discovered-links-counts', conversationId] }),
        queryClient.refetchQueries({ queryKey: ['discovered-links-encoded-counts', conversationId] }),
      ]);
      return data;
    }

    // Job queued – poll until completed or failed (worker processes; Realtime delivers progress)
    const jobId = data?.jobId;
    if (!jobId) {
      throw new Error('Invalid response: missing page or jobId');
    }
    const pollMs = 800;
    const maxAttempts = 180; // ~2.5 min
    let finalJob: Awaited<ReturnType<typeof crawlJobsApi.get>> | null = null;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollMs));
      finalJob = await crawlJobsApi.get(jobId);
      if (!finalJob) continue;
      if (finalJob.status === 'completed') break;
      if (finalJob.status === 'failed') {
        throw new Error(finalJob.error_message ?? 'Add page failed');
      }
    }
    if (finalJob?.status === 'failed') {
      throw new Error(finalJob.error_message ?? 'Add page failed');
    }

    queryClient.invalidateQueries({ queryKey: ['add-page-job', conversationId, sourceId] });
    queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-pages', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['conversation-page-edges', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-counts', conversationId] });
    queryClient.invalidateQueries({ queryKey: ['discovered-links-encoded-counts', conversationId] });
    await Promise.all([
      queryClient.refetchQueries({ queryKey: ['conversation-pages', conversationId] }),
      queryClient.refetchQueries({ queryKey: ['conversation-page-edges', conversationId] }),
      queryClient.refetchQueries({ queryKey: ['discovered-links-counts', conversationId] }),
      queryClient.refetchQueries({ queryKey: ['discovered-links-encoded-counts', conversationId] }),
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

    // Clear suggested_page immediately so the card disappears (persists on reload)
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
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      if (reader) {
        const steps: { current: number; total: number; label: string }[] = [];
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
              if (event.thoughtProcess != null && typeof event.thoughtProcess === 'object') {
                setLiveThoughtProcess(event.thoughtProcess as ThoughtProcess);
              } else if (event.plan != null && typeof event.plan === 'object') {
                const plan = event.plan as { slots?: ThoughtProcess['slots']; subqueries?: unknown[] };
                if (Array.isArray(plan.slots)) {
                  setLiveThoughtProcess((prev) => ({ ...prev, slots: plan.slots, steps: prev?.steps ?? [] }));
                }
              }
              if (event.step != null && event.label && event.totalSteps != null) {
                const current = Number(event.step);
                const total = Number(event.totalSteps);
                const label = String(event.label);
                const idx = steps.findIndex((s) => s.current === current);
                if (idx >= 0) {
                  steps[idx] = { current, total, label };
                } else {
                  steps.push({ current, total, label });
                  steps.sort((a, b) => a.current - b.current);
                }
                setRagStepProgress([...steps]);
              }
              if (event.done === true) {
                setLiveThoughtProcess(null);
                queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
                return;
              }
              if (event.error) {
                setLiveThoughtProcess(null);
                throw new Error(String(event.error));
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
              setLiveThoughtProcess(null);
              queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
              return;
            }
            if (event.error) {
              setLiveThoughtProcess(null);
              throw new Error(String(event.error));
            }
          } catch {
            /* ignore */
          }
        }
        setLiveThoughtProcess(null);
      }
      queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
    } finally {
      setIsLoading(false);
    }
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

    // Create user message (edge function uses its id as rootMessageId for Evidence-First RAG)
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
                    if (event.thoughtProcess != null && typeof event.thoughtProcess === 'object') {
                      setLiveThoughtProcess(event.thoughtProcess as ThoughtProcess);
                    } else if (event.plan != null && typeof event.plan === 'object') {
                      const plan = event.plan as { slots?: ThoughtProcess['slots']; subqueries?: unknown[] };
                      if (Array.isArray(plan.slots)) {
                        setLiveThoughtProcess({ slots: plan.slots, steps: [] });
                      }
                    }
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
                      setLiveThoughtProcess(null);
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
                      setLiveThoughtProcess(null);
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
                    setLiveThoughtProcess(null);
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
                    setLiveThoughtProcess(null);
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

    const words = fullResponse.split(' ');
    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 20));
      setStreamingMessage(prev => prev + (i === 0 ? '' : ' ') + words[i]);
    }

    // Fallback creates message without quotes (quotes table requires valid page_id FKs;
    // mock quotes may have invalid refs)
    await createMessageMutation.mutateAsync({
      conversation_id: conversationId,
      role: 'assistant',
      content: fullResponse,
      was_multi_step: false,
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
    liveThoughtProcess,
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
