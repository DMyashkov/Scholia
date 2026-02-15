import { useState } from 'react';
import { CrawlDepth } from '@/types/source';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Globe, Layers, Database, Zap } from 'lucide-react';

interface AddSourceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddSource: (
    url: string,
    depth: CrawlDepth,
    options: { includeSubpages: boolean; includePdfs: boolean; sameDomainOnly: boolean }
  ) => void;
}

const crawlDepthOptions: { value: CrawlDepth; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'shallow', label: 'Shallow', description: '~5 pages, fastest', icon: <Globe className="h-4 w-4" /> },
  { value: 'medium', label: 'Medium', description: '~15 pages, recommended', icon: <Layers className="h-4 w-4" /> },
  { value: 'deep', label: 'Deep', description: '~35 pages, thorough', icon: <Database className="h-4 w-4" /> },
];

const dynamicOption = { value: 'dynamic' as const, label: 'Dynamic', description: '1 page, suggest more on demand', icon: <Zap className="h-4 w-4" /> };

export const AddSourceModal = ({ open, onOpenChange, onAddSource }: AddSourceModalProps) => {
  const [url, setUrl] = useState('');
  const [depth, setDepth] = useState<CrawlDepth>('dynamic');
  const [sameDomainOnly, setSameDomainOnly] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    onAddSource(url.trim(), depth, {
      includeSubpages: true,
      includePdfs: false,
      sameDomainOnly,
    });

    // Reset form
    setUrl('');
    setDepth('dynamic');
    setSameDomainOnly(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-serif">Add Source</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Index a website to enable evidence-backed citations
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">
          {/* URL Input */}
          <div className="space-y-2">
            <Label htmlFor="url" className="text-sm font-medium">
              Starting URL
            </Label>
            <Input
              id="url"
              type="text"
              placeholder="https://docs.example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="bg-background border-border focus:ring-primary"
            />
          </div>

          {/* Crawl Depth */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Crawl Depth</Label>
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {crawlDepthOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDepth(option.value)}
                    className={cn(
                      'flex flex-col items-center gap-2 p-3 rounded-lg border transition-all',
                      depth === option.value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background/50 text-muted-foreground hover:border-border/80 hover:bg-background'
                    )}
                  >
                    <div className={cn(
                      'p-2 rounded-md',
                      depth === option.value ? 'bg-primary/20 text-primary' : 'bg-secondary'
                    )}>
                      {option.icon}
                    </div>
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-[10px] text-muted-foreground">{option.description}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDepth(dynamicOption.value)}
                className={cn(
                  'w-full flex items-center gap-3 p-3 rounded-lg border transition-all',
                  depth === dynamicOption.value
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border bg-background/50 text-muted-foreground hover:border-border/80 hover:bg-background'
                )}
              >
                <div className={cn(
                  'p-2 rounded-md shrink-0',
                  depth === dynamicOption.value ? 'bg-primary/20 text-primary' : 'bg-secondary'
                )}>
                  {dynamicOption.icon}
                </div>
                <div className="text-left">
                  <span className="text-sm font-medium">{dynamicOption.label}</span>
                  <span className="text-[10px] text-muted-foreground block">{dynamicOption.description}</span>
                </div>
              </button>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Options</Label>
            <div className="flex items-center justify-between bg-background/50 rounded-lg p-3 border border-border/50">
              <div className="space-y-0.5">
                <Label htmlFor="domain" className="text-sm font-normal cursor-pointer">
                  Same domain only
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  Stay within the original domain (recommended)
                </p>
              </div>
              <Switch
                id="domain"
                checked={sameDomainOnly}
                onCheckedChange={setSameDomainOnly}
              />
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!url.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Add source
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
