import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Conversation, ThoughtProcess } from '@/types/chat';
import { PanelLeft } from 'lucide-react';
import { Quote, Source, CrawlDepth } from '@/types/source';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { ThoughtProcessView } from './ThoughtProcessView';
import { ChatInput, type DisableReason } from './ChatInput';
import { useQuery } from '@tanstack/react-query';
import { LATEST_MAIN_CRAWL_JOB_BY_SOURCES } from '@/lib/queryKeys';
import { crawlJobsApi } from '@/lib/db';
import { WelcomeScreen } from './WelcomeScreen';
import { SourcesBar } from './SourcesBar';
import { AddSourceModal } from './AddSourceModal';
import { SourceDrawer } from './SourceDrawer';
import { SourcePreviewDrawer } from './SourcePreviewDrawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';

interface ChatAreaProps {
  conversation: Conversation | null;
  sources: Source[];
  isLoading: boolean;
  streamingMessage: string;
  ragStepProgress?: Array<{ current: number; total: number; label: string }>;
  liveThoughtProcess?: ThoughtProcess | null;
  onSendMessage: (message: string, options?: { unfoldMode?: 'unfold' | 'direct' }) => void;
  onAddSource: (url: string, depth: CrawlDepth, options: { sameDomainOnly: boolean; suggestionMode?: 'surface' | 'dive' }) => Promise<Source | null>;
  onRemoveSource: (sourceId: string) => void;
  onRecrawlSource: (sourceId: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar?: () => void;
  showSignIn?: boolean;
  onSignIn?: () => void;
  /** Called when a guest tries to add a source or start a conversation */
  onGuestRequired?: () => void;
  onDynamicModeChange?: (enabled: boolean) => void;
  onAddSuggestedPage?: (url: string, sourceId: string, questionToReask?: string, messageId?: string, scrapedPageDisplay?: string) => Promise<void>;
  addingPageSourceId?: string | null;
}

export const ChatArea = ({
  conversation,
  sources,
  isLoading,
  streamingMessage,
  ragStepProgress = [],
  liveThoughtProcess = null,
  onSendMessage,
  onAddSource,
  onRemoveSource,
  onRecrawlSource,
  sidebarOpen,
  onToggleSidebar,
  showSignIn,
  onSignIn,
  onGuestRequired,
  onDynamicModeChange,
  onAddSuggestedPage,
  addingPageSourceId,
}: ChatAreaProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourcePromptMessage, setAddSourcePromptMessage] = useState<string | null>(null);

  const sourceIds = useMemo(() => sources.map(s => s.id), [sources]);
  const sourceIdsKey = useMemo(() => sourceIds.slice().sort().join(','), [sourceIds.join(',')]);
  const conversationId = conversation?.id ?? null;
  const { data: mainCrawlJobs = [] } = useQuery({
    queryKey: [LATEST_MAIN_CRAWL_JOB_BY_SOURCES, sourceIdsKey],
    queryFn: async () => {
      if (!conversationId || sourceIds.length === 0) return [];
      return crawlJobsApi.listLatestMainBySources(sourceIds, conversationId);
    },
    enabled: sourceIds.length > 0 && !!conversationId,
  });

  const mainCrawlJobMap = useMemo(() => {
    const map = new Map<string, (typeof mainCrawlJobs)[0]>();
    mainCrawlJobs.forEach(job => map.set(job.source_id, job));
    return map;
  }, [mainCrawlJobs]);

  const hasReadySource = useMemo(() => {
    if (sources.length === 0) return false;
    return sources.some(s => {
      const job = mainCrawlJobMap.get(s.id);
      return job?.status === 'completed';
    });
  }, [sources, mainCrawlJobMap]);

  // Auto-remove sources that failed on initial add (0 pages) - unblocks conversation
  const failedInitialSourceIds = useMemo(() => {
    return sources.filter(s => {
      const job = mainCrawlJobMap.get(s.id);
      return job?.status === 'failed' && (job.indexed_count ?? 0) === 0;
    }).map(s => s.id);
  }, [sources, mainCrawlJobMap]);

  useEffect(() => {
    if (failedInitialSourceIds.length === 0) return;
    failedInitialSourceIds.forEach(sourceId => {
      onRemoveSource(sourceId);
    });
    // Toast once per batch
    toast.error('Source failed to load and was removed. Try adding it again.');
  }, [failedInitialSourceIds, onRemoveSource]);

  const { isDisabled: inputDisabled, disableReason } = useMemo((): { isDisabled: boolean; disableReason: DisableReason } => {
    if (sources.length === 0) return { isDisabled: true, disableReason: 'no_sources' };
    if (isLoading) return { isDisabled: true, disableReason: 'loading' };
    if (addingPageSourceId) return { isDisabled: true, disableReason: 'adding_page' };
    if (!hasReadySource) return { isDisabled: true, disableReason: 'processing' };
    return { isDisabled: false, disableReason: null };
  }, [sources.length, isLoading, addingPageSourceId, hasReadySource]);

  const openAddSourceModal = useCallback((promptMessage: string | null) => {
    if (showSignIn && onGuestRequired) {
      onGuestRequired();
      return;
    }
    setAddSourcePromptMessage(promptMessage);
    setAddSourceOpen(true);
  }, [showSignIn, onGuestRequired]);

  const handleRequestAddSource = useCallback(() => {
    openAddSourceModal('Add source first');
  }, [openAddSourceModal]);

  const handleAddSourceOpenChange = useCallback((open: boolean) => {
    setAddSourceOpen(open);
    if (!open) setAddSourcePromptMessage(null);
  }, []);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);

  const selectedSource = sources.find(s => s.id === selectedSourceId) || null;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [conversation?.messages, streamingMessage]);

  const hasMessages = conversation && conversation.messages.length > 0;

  // Get all quotes from the conversation for navigation
  const allQuotes = conversation?.messages.flatMap(m => m.quotes || []) || [];

  // Get recently used source IDs from the last assistant message
  const lastAssistantMessage = conversation?.messages.filter(m => m.role === 'assistant').pop();
  const recentlyUsedSourceIds = lastAssistantMessage?.sourcesUsed || [];

  const handleQuoteClick = (quote: Quote) => {
    setSelectedQuote(quote);
    setPreviewOpen(true);
  };

  const handleSourceChipClick = (sourceId: string) => {
    setSelectedSourceId(sourceId);
    setSourceDrawerOpen(true);
  };

  const handleKnowledgeTrailClick = (sourceId: string) => {
    // Find a quote from this source in the current message
    const quote = allQuotes.find(q => q.sourceId === sourceId);
    if (quote) {
      handleQuoteClick(quote);
    } else {
      handleSourceChipClick(sourceId);
    }
  };

  const handleAddSource = async (url: string, depth: CrawlDepth, options: { sameDomainOnly: boolean }) => {
    const added = await onAddSource(url, depth, options);
    if (added) {
      setAddSourceOpen(false);
      // Keep SourceDrawer closed when starting crawl
    }
    return added;
  };

  const handleRemoveSource = (sourceId: string) => {
    onRemoveSource(sourceId);
    setSourceDrawerOpen(false);
    setSelectedSourceId(null);
  };

  const sourcesList = sources.map(s => ({ id: s.id, domain: s.domain }));

  return (
    <div className="flex flex-col h-full">
      {/* Sources Bar with Sign in - always visible */}
      <div className="flex items-center gap-2">
        {/* Sidebar toggle when closed */}
        {!sidebarOpen && onToggleSidebar && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleSidebar}
            className="ml-4 shrink-0 text-muted-foreground hover:text-foreground hover:bg-secondary"
            aria-label="Open sidebar"
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
        )}
        <SourcesBar
          sources={sources}
          onAddSource={() => openAddSourceModal(null)}
          onSourceClick={handleSourceChipClick}
          recentlyUsedSourceIds={recentlyUsedSourceIds}
          showSignIn={showSignIn}
          onSignIn={onSignIn}
          className={!sidebarOpen ? 'pl-0' : undefined}
          dynamicMode={conversation?.dynamicMode ?? true}
          onDynamicModeChange={(enabled) => conversation && onDynamicModeChange?.(enabled)}
          conversationId={conversation?.id}
          addingPageSourceId={addingPageSourceId}
        />
      </div>

      {hasMessages ? (
        <>
          <ScrollArea className="flex-1 scrollbar-thin" ref={scrollRef}>
            <div className="pb-4">
              {conversation.messages.map((message, i) => {
                // Skip messages that are follow-ups (rendered with their parent)
                if (message.followsMessageId) return null;
                const next = conversation.messages[i + 1];
                const followUp = next?.followsMessageId === message.id ? next : undefined;
                return (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    followUp={followUp}
                    sources={sourcesList}
                    onQuoteClick={handleQuoteClick}
                    onSourceClick={handleKnowledgeTrailClick}
                    onAddSuggestedPage={onAddSuggestedPage}
                    conversationId={conversation.id}
                  />
                );
              })}
              {isLoading && streamingMessage && (
                <ChatMessage
                  message={{
                    id: 'streaming',
                    role: 'assistant',
                    content: streamingMessage,
                    timestamp: new Date(),
                  }}
                  isStreaming
                />
              )}
              {(isLoading && !streamingMessage) || addingPageSourceId ? (
                <TypingIndicator minimal={!!addingPageSourceId} stepLabels={ragStepProgress} />
              ) : null}
              {isLoading && liveThoughtProcess && (liveThoughtProcess.slots?.length || liveThoughtProcess.steps?.length) ? (
                <div className="px-4 pt-2 pb-4">
                  <div className="max-w-3xl mx-auto w-full">
                    <ThoughtProcessView
                      thoughtProcess={liveThoughtProcess}
                      isLive
                      defaultOpen
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </ScrollArea>
          <ChatInput
            onSendMessage={onSendMessage}
            isLoading={isLoading}
            isDisabled={inputDisabled}
            disableReason={disableReason}
            onRequestAddSource={handleRequestAddSource}
          />
        </>
      ) : (
        <>
          <WelcomeScreen onAddSource={() => openAddSourceModal(null)} hasSources={sources.length > 0} />
          {addingPageSourceId && (
            <div className="px-4 pt-3 pb-2">
              <TypingIndicator minimal />
            </div>
          )}
          <ChatInput
            onSendMessage={onSendMessage}
            isLoading={isLoading}
            isDisabled={inputDisabled}
            disableReason={disableReason}
            onRequestAddSource={handleRequestAddSource}
          />
        </>
      )}

      {/* Modals and Drawers */}
      <AddSourceModal
        open={addSourceOpen}
        onOpenChange={handleAddSourceOpenChange}
        onAddSource={handleAddSource}
        promptMessage={addSourcePromptMessage}
      />

      <SourceDrawer
        source={selectedSource}
        allSourceIds={sourceIds}
        conversationId={conversation?.id || null}
        open={sourceDrawerOpen}
        onOpenChange={setSourceDrawerOpen}
        onRecrawl={onRecrawlSource}
        onRemove={handleRemoveSource}
        addingPageSourceId={addingPageSourceId}
      />

      <SourcePreviewDrawer
        quote={selectedQuote}
        allQuotes={allQuotes}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onNavigateQuote={setSelectedQuote}
      />
    </div>
  );
};
