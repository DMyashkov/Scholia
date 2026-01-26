import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MessageSquare } from 'lucide-react';
import type { ExistingConversationInfo } from '@/hooks/useConversationSources';

interface InheritSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingConversations: ExistingConversationInfo[];
  onInherit: (conversationId: string) => void;
  onCreateNew: () => void;
}

export const InheritSourceDialog = ({
  open,
  onOpenChange,
  existingConversations,
  onInherit,
  onCreateNew,
}: InheritSourceDialogProps) => {
  if (existingConversations.length === 0) {
    return null;
  }

  const handleInherit = (conversationId: string) => {
    onInherit(conversationId);
    onOpenChange(false);
  };

  const handleCreateNew = () => {
    onCreateNew();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Source already exists</AlertDialogTitle>
          <AlertDialogDescription>
            This source has already been crawled in another conversation. Would you like to inherit the existing crawl data, or create a new crawl?
          </AlertDialogDescription>
        </AlertDialogHeader>
        
        <div className="space-y-2 py-4">
          {existingConversations.map((item) => (
            <button
              key={item.conversationId}
              onClick={() => handleInherit(item.conversationId)}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 transition-colors text-left"
            >
              <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.conversation.title}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(item.conversation.created_at).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>

        <AlertDialogFooter className="flex-col sm:flex-row gap-2">
          <AlertDialogCancel onClick={handleCreateNew} className="w-full sm:w-auto">
            Create new crawl
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
