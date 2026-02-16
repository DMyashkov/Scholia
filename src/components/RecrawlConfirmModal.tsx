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

interface RecrawlConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  sourceLabel?: string;
  isRecrawling?: boolean;
}

export function RecrawlConfirmModal({
  open,
  onOpenChange,
  onConfirm,
  sourceLabel = 'this source',
  isRecrawling = false,
}: RecrawlConfirmModalProps) {
  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    await onConfirm();
    onOpenChange(false);
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recrawl {sourceLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will clear the current graph and start a fresh crawl. Recrawling consumes credits.
            Are you sure you want to continue?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRecrawling}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isRecrawling}>
            {isRecrawling ? 'Recrawling…' : 'Recrawl'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
