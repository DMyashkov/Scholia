import { Plus, MessageSquare, Trash2, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Conversation } from '@/types/chat';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { UserMenu } from '@/components/UserMenu';
import { SidebarCrawlPanel } from '@/components/SidebarCrawlPanel';
import { cn } from '@/lib/utils';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  currentSources?: import('@/types/source').Source[];
}

export const Sidebar = ({
  conversations,
  activeConversationId,
  isOpen,
  onToggle,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  currentSources = [],
}: SidebarProps) => {
  const groupedConversations = {
    today: conversations.filter(c => {
      const today = new Date();
      return c.updatedAt.toDateString() === today.toDateString();
    }),
    yesterday: conversations.filter(c => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return c.updatedAt.toDateString() === yesterday.toDateString();
    }),
    older: conversations.filter(c => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return c.updatedAt < yesterday;
    }),
  };

  return (
    <>
      {/* Toggle button when sidebar is closed - simple immediate transition */}
      {!isOpen && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="fixed left-4 top-[18px] z-50 text-muted-foreground hover:text-foreground hover:bg-secondary"
          aria-label="Open sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </Button>
      )}

      {/* Sidebar content - uses opacity/visibility for smooth transitions */}
      <aside
        className={cn(
          'h-full bg-card flex flex-col overflow-hidden transition-opacity duration-200',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className="text-muted-foreground hover:text-foreground hover:bg-secondary transition-none"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-5 w-5 transition-none" />
          </Button>
          <Button
            onClick={onNewChat}
            className="bg-primary text-primary-foreground hover:bg-primary/90 gap-2"
          >
            <Plus className="h-4 w-4" />
            New chat
          </Button>
        </div>

        {/* Conversations list */}
        <ScrollArea className="flex-1 px-2 py-4 scrollbar-thin">
          {groupedConversations.today.length > 0 && (
            <div className="mb-4">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Today
              </p>
              {groupedConversations.today.map(conversation => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation.id)}
                />
              ))}
            </div>
          )}

          {groupedConversations.yesterday.length > 0 && (
            <div className="mb-4">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Yesterday
              </p>
              {groupedConversations.yesterday.map(conversation => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation.id)}
                />
              ))}
            </div>
          )}

          {groupedConversations.older.length > 0 && (
            <div className="mb-4">
              <p className="px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Previous
              </p>
              {groupedConversations.older.map(conversation => (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === activeConversationId}
                  onSelect={() => onSelectConversation(conversation.id)}
                  onDelete={() => onDeleteConversation(conversation.id)}
                />
              ))}
            </div>
          )}

          {conversations.length === 0 && (
            <p className="px-3 py-8 text-sm text-muted-foreground text-center">
              No conversations yet
            </p>
          )}
        </ScrollArea>

        {/* Crawl Panel - shows when there are sources */}
        <SidebarCrawlPanel sources={currentSources} />

        {/* Footer with User Menu */}
        <UserMenu />
      </aside>
    </>
  );
};

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

const ConversationItem = ({
  conversation,
  isActive,
  onSelect,
  onDelete,
}: ConversationItemProps) => {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors',
        isActive
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
      )}
      onClick={onSelect}
    >
      <MessageSquare className="h-4 w-4 shrink-0" />
      <span className="flex-1 truncate text-sm">{conversation.title}</span>
      {/* Source favicons - stacked with overflow */}
      {conversation.sources && conversation.sources.length > 0 && (
        <div className="flex items-center -space-x-1.5 shrink-0">
          {conversation.sources.slice(0, 3).map((source, i) => (
            <div 
              key={source.id}
              className="w-4 h-4 rounded-full bg-secondary border border-background flex items-center justify-center overflow-hidden"
              style={{ zIndex: 3 - i }}
            >
              {source.favicon ? (
                <img src={source.favicon} alt="" className="w-3 h-3" />
              ) : (
                <span className="text-[8px] font-medium text-muted-foreground uppercase">
                  {source.domain.charAt(0)}
                </span>
              )}
            </div>
          ))}
          {conversation.sources.length > 3 && (
            <div 
              className="w-4 h-4 rounded-full bg-muted border border-background flex items-center justify-center"
              style={{ zIndex: 0 }}
            >
              <span className="text-[7px] font-medium text-muted-foreground">
                +{conversation.sources.length - 3}
              </span>
            </div>
          )}
        </div>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
};
