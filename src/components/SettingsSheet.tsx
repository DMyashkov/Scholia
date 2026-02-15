import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Settings } from 'lucide-react';
import { getCopyIncludeEvidence, setCopyIncludeEvidence, COPY_SETTING_CHANGED } from '@/lib/copySettings';
import { useState, useEffect } from 'react';

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
        </div>
      </SheetContent>
    </Sheet>
  );
};
