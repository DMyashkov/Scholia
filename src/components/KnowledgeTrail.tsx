import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface KnowledgeTrailSource {
  id: string;
  domain: string;
}

interface KnowledgeTrailProps {
  sources: KnowledgeTrailSource[];
  onSourceClick: (sourceId: string) => void;
}

export const KnowledgeTrail = ({ sources, onSourceClick }: KnowledgeTrailProps) => {
  if (sources.length === 0) return null;

  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border/30">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
        Sources
      </span>
      
      <div className="flex items-center">
        {sources.map((source, index) => (
          <TooltipProvider key={source.id} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onSourceClick(source.id)}
                  className="flex items-center group"
                >
                  {/* Connecting line */}
                  {index > 0 && (
                    <div className="w-4 h-px bg-border/40 group-hover:bg-primary/30 transition-colors" />
                  )}
                  
                  {/* Source pill */}
                  <div className={cn(
                    'flex items-center gap-1 px-2 py-0.5 rounded-full',
                    'bg-secondary/60 border border-border/30',
                    'hover:bg-secondary hover:border-primary/30',
                    'transition-all duration-200',
                    'text-[10px] font-medium text-muted-foreground',
                    'hover:text-foreground'
                  )}>
                    <span className="text-primary/80 font-semibold">
                      {source.domain.charAt(0).toUpperCase()}
                    </span>
                    <span className="max-w-[60px] truncate">
                      {source.domain.split('.')[0]}
                    </span>
                  </div>
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{source.domain}</p>
                <p className="text-muted-foreground">Click to view source</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>
    </div>
  );
};
