/**
 * Debug panel to show crawl job status and realtime updates
 * Only visible in development mode
 */

import { useConversationSources } from '@/hooks/useConversationSources';
import { useCrawlJob } from '@/hooks/useCrawlJobs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CrawlDebugPanelProps {
  conversationId: string | null;
  className?: string;
}

// Separate component to use hook properly
function SourceDebugItem({ sourceId, domain }: { sourceId: string; domain: string }) {
  const { data: job } = useCrawlJob(sourceId);
  
  return (
    <div className="p-2 bg-muted rounded">
      <div className="font-semibold">{domain}</div>
      {job ? (
        <div className="space-y-1 mt-1 text-[10px]">
          <div>Status: <span className="font-mono">{job.status}</span></div>
          <div>Scraped: <span className="font-mono">{job.indexed_count ?? 0}</span></div>
          <div>Discovered: <span className="font-mono">{(job as { discovered_count?: number }).discovered_count ?? 0}</span></div>
          {job.last_activity_at && (
            <div>Last Activity: <span className="font-mono text-[9px]">{new Date(job.last_activity_at).toLocaleTimeString()}</span></div>
          )}
        </div>
      ) : (
        <div className="text-muted-foreground text-[10px] mt-1">No crawl job</div>
      )}
    </div>
  );
}

export function CrawlDebugPanel({ conversationId, className }: CrawlDebugPanelProps) {
  const { data: sources = [] } = useConversationSources(conversationId);
  
  if (!conversationId || sources.length === 0) {
    return null;
  }

  // Only show in development
  if (import.meta.env.PROD) {
    return null;
  }

  return (
    <Card className={cn('border-dashed border-2', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs">🐛 Crawl Debug</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {sources.map(cs => (
          <SourceDebugItem 
            key={cs.source.id} 
            sourceId={cs.source.id} 
            domain={cs.source.domain}
          />
        ))}
      </CardContent>
    </Card>
  );
}
