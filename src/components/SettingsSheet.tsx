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
import { getCopyIncludeEvidence, setCopyIncludeEvidence, COPY_SETTING_CHANGED } from '@/lib/copySettings';
import { useDeleteAllConversations } from '@/hooks/useConversations';
import { useState, useEffect } from 'react';
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
  const [includeEvidence, setIncludeEvidence] = useState(getCopyIncludeEvidence);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const deleteAllMutation = useDeleteAllConversations();

  useEffect(() => {
    setIncludeEvidence(getCopyIncludeEvidence());
  }, [open]);

  useEffect(() => {
    const handler = (e: CustomEvent<boolean>) => setIncludeEvidence(e.detail);
    window.addEventListener(COPY_SETTING_CHANGED, handler as EventListener);
    return () => window.removeEventListener(COPY_SETTING_CHANGED, handler as EventListener);
  }, []);

  const handleWithEvidence = () => {
    setCopyIncludeEvidence(true);
    setIncludeEvidence(true);
  };

  const handleWithoutEvidence = () => {
    setCopyIncludeEvidence(false);
    setIncludeEvidence(false);
  };

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
