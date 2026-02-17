import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface GuestModeRequiredModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogIn: () => void;
}

export const GuestModeRequiredModal = ({
  open,
  onOpenChange,
  onLogIn,
}: GuestModeRequiredModalProps) => {
  const handleLogIn = () => {
    onOpenChange(false);
    onLogIn();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Guest mode is currently disabled</DialogTitle>
          <DialogDescription>
            Once this is deployed and subscription pricing is implemented, guest mode may be available depending on the
            decided plans. Please sign in to add sources and start conversations.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLogIn}>Log in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
