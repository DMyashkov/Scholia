import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
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
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Settings, Trash2 } from 'lucide-react';
import { useCopyIncludeEvidence } from '@/hooks/useCopyIncludeEvidence';
import { useSuggestedPageCandidates } from '@/hooks/useSuggestedPageCandidates';
import { useDeleteAllConversations } from '@/hooks/useConversations';
import { useState } from 'react';
import { toast } from 'sonner';

export const SettingsSheet = ({
  trigger,
  open,
  onOpenChange,
}: {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  const { copyIncludeEvidence: includeEvidence, setCopyIncludeEvidence } = useCopyIncludeEvidence();
  const { suggestedPageCandidates, setSuggestedPageCandidates } = useSuggestedPageCandidates();
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const deleteAllMutation = useDeleteAllConversations();

  const handleWithEvidence = () => setCopyIncludeEvidence(true);
  const handleWithoutEvidence = () => setCopyIncludeEvidence(false);

  const handleDeleteAll = async () => {
    try {
      await deleteAllMutation.mutateAsync();
      setDeleteAllOpen(false);
      onOpenChange?.(false);
      toast.success('All conversations deleted');
    } catch (err) {
      toast.error('Failed to delete conversations', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger && <SheetTrigger asChild>{trigger}</SheetTrigger>}
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <Label>Default copy format</Label>
            <p className="text-sm text-muted-foreground">
              When copying assistant messages, which format to use by default.
            </p>
            <div className="flex gap-2">
              <Button
                variant={includeEvidence ? 'default' : 'outline'}
                size="sm"
                onClick={handleWithEvidence}
              >
                With evidence
              </Button>
              <Button
                variant={!includeEvidence ? 'default' : 'outline'}
                size="sm"
                onClick={handleWithoutEvidence}
              >
                Without evidence
              </Button>
            </div>
          </div>
          <div className="space-y-2 pt-4 border-t border-border">
            <Label>Dynamic mode: suggested page candidates</Label>
            <p className="text-sm text-muted-foreground">
              How many candidate pages the assistant sees when suggesting a new page to add (5 or 10).
            </p>
            <div className="flex gap-2">
              <Button
                variant={suggestedPageCandidates === 5 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSuggestedPageCandidates(5)}
              >
                5
              </Button>
              <Button
                variant={suggestedPageCandidates === 10 ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSuggestedPageCandidates(10)}
              >
                10
              </Button>
            </div>
          </div>
          <div className="space-y-2 pt-4 border-t border-border">
            <Label>Data</Label>
            <p className="text-sm text-muted-foreground">
              Delete all conversations for this profile. This cannot be undone.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setDeleteAllOpen(true)}
              disabled={deleteAllMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete all conversations
            </Button>
          </div>
        </div>
        <AlertDialog open={deleteAllOpen} onOpenChange={setDeleteAllOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all conversations?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all your conversations. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAllMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDeleteAll(); }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteAllMutation.isPending ? 'Deleting…' : 'Delete all'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
};
