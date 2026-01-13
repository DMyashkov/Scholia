import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ChatArea } from '@/components/ChatArea';
import { useChat } from '@/hooks/useChat';
import { useAuthContext } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { Source, CrawlDepth } from '@/types/source';
import { generateMockPages } from '@/data/mockSourceContent';
import { cn } from '@/lib/utils';

const generateId = () => Math.random().toString(36).substring(2, 15);

const extractDomain = (url: string): string => {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    return parsed.hostname.replace('www.', '');
  } catch {
    return url;
  }
};

const getTotalPagesForDepth = (depth: CrawlDepth): number => {
  switch (depth) {
    case 'shallow': return 5;
    case 'medium': return 15;
    case 'deep': return 35;
  }
};

const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 400;
const DEFAULT_SIDEBAR_WIDTH = 280;

const Index = () => {
  const { user, loading } = useAuthContext();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  
  const {
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
  } = useChat();

  // Toggle with animation
  const handleToggleSidebar = useCallback(() => {
    setSidebarOpen(prev => !prev);
  }, []);

  // Resize handlers - no animation during drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  const handleAddSource = useCallback((
    url: string,
    depth: CrawlDepth,
    options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }
  ) => {
    const domain = extractDomain(url);
    const totalPages = getTotalPagesForDepth(depth);
    const id = generateId();

    const discoveredPages = generateMockPages(domain, 'crawling');
    
    while (discoveredPages.length < totalPages) {
      discoveredPages.push({
        id: `${domain}-page-${discoveredPages.length}`,
        title: `Page ${discoveredPages.length + 1}`,
        path: `/page-${discoveredPages.length + 1}`,
        status: 'pending',
      });
    }

    const newSource: Source = {
      id,
      url: url.startsWith('http') ? url : `https://${url}`,
      domain,
      status: 'crawling',
      crawlDepth: depth,
      includeSubpages: options.includeSubpages,
      includePdfs: options.includePdfs,
      sameDomainOnly: options.sameDomainOnly,
      pagesIndexed: 0,
      totalPages,
      lastUpdated: new Date(),
      discoveredPages,
    };

    addSourceToConversation(newSource);
  }, [addSourceToConversation]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      {/* Sidebar container - animate only when not resizing */}
      <div 
        className={cn(
          "shrink-0 border-r border-border overflow-hidden relative",
          !isResizing && "transition-[width] duration-300 ease-out"
        )}
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="h-full" style={{ width: sidebarWidth }}>
          <Sidebar
            conversations={conversations}
            activeConversationId={activeConversationId}
            isOpen={sidebarOpen}
            onToggle={handleToggleSidebar}
            onNewChat={createNewConversation}
            onSelectConversation={selectConversation}
            onDeleteConversation={deleteConversation}
            currentSources={currentSources}
          />
        </div>
        
        {/* Resize handle */}
        {sidebarOpen && (
          <div
            className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-10"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>
      
      {/* Main Content */}
      <div className="flex-1 min-w-0">
        <ChatArea
          conversation={activeConversation}
          sources={currentSources}
          isLoading={isLoading}
          streamingMessage={streamingMessage}
          onSendMessage={sendMessage}
          onAddSource={handleAddSource}
          onRemoveSource={removeSourceFromConversation}
          onRecrawlSource={recrawlSource}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={handleToggleSidebar}
          showSignIn={!user}
          onSignIn={() => navigate('/auth')}
        />
      </div>
    </div>
  );
};

export default Index;
