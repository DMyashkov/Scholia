import { useRef, useEffect, useState, useCallback } from 'react';
import { Conversation } from '@/types/chat';
import { Quote, Source, CrawlDepth } from '@/types/source';
import { ChatMessage, TypingIndicator } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { WelcomeScreen } from './WelcomeScreen';
import { SourcesBar } from './SourcesBar';
import { AddSourceModal } from './AddSourceModal';
import { SourceDrawer } from './SourceDrawer';
import { SourcePreviewDrawer } from './SourcePreviewDrawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { PanelLeft } from 'lucide-react';

interface ChatAreaProps {
  conversation: Conversation | null;
  sources: Source[];
  isLoading: boolean;
  streamingMessage: string;
  onSendMessage: (message: string) => void;
  onAddSource: (url: string, depth: CrawlDepth, options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }) => void;
  onRemoveSource: (sourceId: string) => void;
  onRecrawlSource: (sourceId: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar?: () => void;
  showSignIn?: boolean;
  onSignIn?: () => void;
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
}: ChatAreaProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
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

  const handleAddSource = (url: string, depth: CrawlDepth, options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }) => {
    onAddSource(url, depth, options);
    setAddSourceOpen(false);
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
          onAddSource={() => setAddSourceOpen(true)}
          onSourceClick={handleSourceChipClick}
          recentlyUsedSourceIds={recentlyUsedSourceIds}
          showSignIn={showSignIn}
          onSignIn={onSignIn}
          className={!sidebarOpen ? 'pl-0' : undefined}
        />
      </div>

      {hasMessages ? (
        <>
          <ScrollArea className="flex-1 scrollbar-thin" ref={scrollRef}>
            <div className="pb-4">
              {conversation.messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  sources={sourcesList}
                  onQuoteClick={handleQuoteClick}
                  onSourceClick={handleKnowledgeTrailClick}
                />
              ))}
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
              {isLoading && !streamingMessage && <TypingIndicator />}
            </div>
          </ScrollArea>
          <ChatInput onSendMessage={onSendMessage} isLoading={isLoading} />
        </>
      ) : (
        <>
          <WelcomeScreen onExampleClick={onSendMessage} />
          <ChatInput onSendMessage={onSendMessage} isLoading={isLoading} />
        </>
      )}

      {/* Modals and Drawers */}
      <AddSourceModal
        open={addSourceOpen}
        onOpenChange={setAddSourceOpen}
        onAddSource={handleAddSource}
      />

      <SourceDrawer
        source={selectedSource}
        open={sourceDrawerOpen}
        onOpenChange={setSourceDrawerOpen}
        onRecrawl={onRecrawlSource}
        onRemove={handleRemoveSource}
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
