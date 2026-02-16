import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Conversation } from '@/types/chat';
import { PanelLeft } from 'lucide-react';
import { Quote, Source, CrawlDepth } from '@/types/source';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { ChatInput, type DisableReason } from './ChatInput';
import { useQuery } from '@tanstack/react-query';
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
  onSendMessage: (message: string) => void;
  onAddSource: (url: string, depth: CrawlDepth, options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }) => Promise<Source | null>;
  onRemoveSource: (sourceId: string) => void;
  onRecrawlSource: (sourceId: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar?: () => void;
  showSignIn?: boolean;
  onSignIn?: () => void;
  onDynamicModeChange?: (enabled: boolean) => void;
  onAddSuggestedPage?: (url: string, sourceId: string, questionToReask?: string, messageId?: string, indexedPageDisplay?: string) => Promise<void>;
  addingPageSourceId?: string | null;
}

export const ChatArea = ({
  conversation,
  sources,
  isLoading,
  streamingMessage,
  onSendMessage,
  onAddSource,
  onRemoveSource,
  onRecrawlSource,
  sidebarOpen,
  onToggleSidebar,
  showSignIn,
  onSignIn,
  onDynamicModeChange,
  onAddSuggestedPage,
  addingPageSourceId,
}: ChatAreaProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [addSourcePromptMessage, setAddSourcePromptMessage] = useState<string | null>(null);

  const sourceIds = useMemo(() => sources.map(s => s.id), [sources]);
  const { data: crawlJobsData = [] } = useQuery({
    queryKey: ['crawl-jobs-for-sources', sourceIds],
    queryFn: async () => {
      const jobs = await Promise.all(sourceIds.map(id => crawlJobsApi.listBySource(id)));
      return jobs.flat();
    },
    enabled: sourceIds.length > 0,
    refetchInterval: (q) => {
      const jobs = (q.state.data ?? []) as { status?: string }[];
      const anyActive = jobs.some(j => ['queued', 'running', 'indexing'].includes(j?.status ?? ''));
      return anyActive ? 2000 : false;
    },
  });

  const crawlJobMap = useMemo(() => {
    const map = new Map<string, (typeof crawlJobsData)[0]>();
    crawlJobsData.forEach(job => {
      const existing = map.get(job.source_id);
      if (!existing || new Date(job.created_at) > new Date(existing.created_at)) {
        map.set(job.source_id, job);
      }
    });
    return map;
  }, [crawlJobsData]);

  const hasReadySource = useMemo(() => {
    if (sources.length === 0) return false;
    return sources.some(s => {
      const job = crawlJobMap.get(s.id);
      return job?.status === 'completed';
    });
  }, [sources, crawlJobMap]);

  const { isDisabled: inputDisabled, disableReason } = useMemo((): { isDisabled: boolean; disableReason: DisableReason } => {
    if (sources.length === 0) return { isDisabled: true, disableReason: 'no_sources' };
    if (isLoading) return { isDisabled: true, disableReason: 'loading' };
    if (addingPageSourceId) return { isDisabled: true, disableReason: 'adding_page' };
    if (!hasReadySource) return { isDisabled: true, disableReason: 'processing' };
    return { isDisabled: false, disableReason: null };
  }, [sources.length, isLoading, addingPageSourceId, hasReadySource]);

  const handleRequestAddSource = useCallback(() => {
    setAddSourcePromptMessage('Add source first');
    setAddSourceOpen(true);
  }, []);

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

  const handleAddSource = async (url: string, depth: CrawlDepth, options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }) => {
    const added = await onAddSource(url, depth, options);
    if (added) {
      setAddSourceOpen(false);
      setSelectedSourceId(added.id);
      setSourceDrawerOpen(true);
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
          onAddSource={() => { setAddSourcePromptMessage(null); setAddSourceOpen(true); }}
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
                <TypingIndicator minimal={!!addingPageSourceId} />
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
          <WelcomeScreen onAddSource={() => { setAddSourcePromptMessage(null); setAddSourceOpen(true); }} hasSources={sources.length > 0} />
          {addingPageSourceId && (
            <div className="px-4">
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
