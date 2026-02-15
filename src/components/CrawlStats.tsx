import { cn } from '@/lib/utils';

interface CrawlStatsProps {
  pagesDiscovered: number;
  pagesIndexed: number;
  targetPages: number;
  connectionsFound: number;
  isCrawling: boolean;
}

export const CrawlStats = ({ 
  pagesDiscovered, 
  pagesIndexed, 
  targetPages,
  connectionsFound,
  isCrawling,
}: CrawlStatsProps) => {
  const progressPercent = targetPages > 0 ? Math.min(100, (pagesIndexed / targetPages) * 100) : 0;
  return (
    <div className="space-y-3">
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <StatItem 
          label="Discovered" 
          value={pagesDiscovered}
          highlight={isCrawling}
        />
        <StatItem 
          label="Indexed" 
          value={pagesIndexed}
          highlight={isCrawling}
        />
        <StatItem 
          label="Links" 
          value={connectionsFound}
        />
      </div>
      
      {/* Crawling activity indicator - same formula as SidebarCrawlPanel: indexed/target */}
      {isCrawling && targetPages > 0 && (
        <div className="relative h-0.5 bg-border/30 rounded-full overflow-hidden">
          <div 
            className="absolute inset-y-0 left-0 bg-primary/60 rounded-full animate-crawl-progress"
            style={{ width: `${progressPercent}%` }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-primary/30 to-transparent animate-shimmer" />
        </div>
      )}
    </div>
  );
};

interface StatItemProps {
  label: string;
  value: number;
  highlight?: boolean;
}

const StatItem = ({ label, value, highlight }: StatItemProps) => {
  return (
    <div className="text-center p-2 rounded-md bg-background/30 border border-border/30">
      <div className={cn(
        'text-sm font-mono font-semibold transition-colors duration-300',
        highlight ? 'text-primary' : 'text-foreground'
      )}>
        {value}
      </div>
      <div className="text-[9px] text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
};
