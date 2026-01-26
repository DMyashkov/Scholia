# Database Setup & Next Steps

## ✅ Step 0 Complete: Foundation

This document outlines what has been implemented and what comes next.

## What's Been Implemented

### 1. Database Schema (`supabase/migrations/`)
- ✅ Complete schema with all tables (conversations, messages, sources, crawl_jobs, pages, page_edges, chunks, citations)
- ✅ RLS policies for user data isolation
- ✅ Triggers for auto-setting `owner_id` and `updated_at`
- ✅ Indexes for performance
- ✅ Guest mode support (null `owner_id`)

### 2. TypeScript Data Layer (`src/lib/db/`)
- ✅ Type definitions for all database entities
- ✅ API client functions for all CRUD operations:
  - `conversationsApi` - List, get, create, update, delete conversations
  - `messagesApi` - List, create, delete messages
  - `sourcesApi` - List, get, create, update, delete sources
  - `conversationSourcesApi` - Add/remove sources from conversations (auto-creates crawl jobs)
  - `crawlJobsApi` - List, get, create, update crawl jobs
  - `pagesApi` - List pages by source or conversation
  - `pageEdgesApi` - List edges by source or conversation

### 3. React Query Hooks (`src/hooks/`)
- ✅ `useConversations` - List all conversations
- ✅ `useConversation` - Get single conversation
- ✅ `useCreateConversation` - Create new conversation
- ✅ `useUpdateConversation` - Rename conversation
- ✅ `useDeleteConversation` - Delete conversation
- ✅ `useMessages` - List messages for a conversation
- ✅ `useCreateMessage` - Create a message
- ✅ `useConversationSources` - List sources for a conversation
- ✅ `useAddSourceToConversation` - Add source (auto-creates crawl job)
- ✅ `useRemoveSourceFromConversation` - Remove source
- ✅ `useCrawlJob` - Get active crawl job with Realtime subscription
- ✅ `useCrawlJobs` - List all crawl jobs for a source
- ✅ `usePages` - List pages for a source
- ✅ `useConversationPages` - List all pages for a conversation
- ✅ `usePageEdges` - List edges for a source
- ✅ `useConversationPageEdges` - List all edges for a conversation

## Setup Instructions

### 1. Run Database Migrations

Execute the SQL migrations in order:
1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_triggers.sql`
3. `supabase/migrations/003_rls_policies.sql`

See `supabase/README.md` for detailed instructions.

### 2. Enable Realtime

In Supabase Dashboard → Database → Replication, enable Realtime for:
- `crawl_jobs` (for live progress updates)
- `pages` (for live page discovery)
- `page_edges` (for live graph updates)

### 3. Optional: Enable pgvector Extension

If you plan to use embeddings:
```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## Next Steps: Step 1 - Crawler Worker

### Architecture Overview

Create a separate Node.js/TypeScript service that:
1. Watches `crawl_jobs` table for jobs with `status = 'queued'`
2. Processes each job:
   - Fetches the source URL
   - Extracts text content
   - Discovers links
   - Respects crawl depth and domain restrictions
   - Updates `crawl_jobs` progress in real-time
   - Inserts `pages` as discovered
   - Inserts `page_edges` for link relationships

### Worker Service Structure

```
scholia-worker/
├── src/
│   ├── index.ts          # Main entry point
│   ├── crawler.ts         # Core crawling logic
│   ├── db.ts              # Supabase client
│   └── types.ts           # Shared types
├── package.json
└── tsconfig.json
```

### Key Implementation Points

1. **Polling or Realtime**: 
   - Option A: Poll `crawl_jobs` table for queued jobs
   - Option B: Use Supabase Realtime to listen for new crawl jobs

2. **Crawling Logic**:
   - Use `cheerio` or `jsdom` for HTML parsing
   - Use `node-fetch` or `axios` for HTTP requests
   - Respect `robots.txt` (use `robots-parser`)
   - Implement rate limiting
   - Handle errors gracefully (update job status to 'failed')

3. **Progress Updates**:
   - Update `crawl_jobs.pages_indexed` as pages are discovered
   - Update `crawl_jobs.status` to 'running' when started
   - Update `crawl_jobs.status` to 'completed' when done
   - Set `crawl_jobs.total_pages` when crawl is complete

4. **Page Discovery**:
   - Insert into `pages` table with status 'indexed'
   - Extract title, path, and content
   - Insert into `page_edges` for each link found

5. **Error Handling**:
   - Set `crawl_jobs.status` to 'failed' on errors
   - Set `crawl_jobs.error_message` with error details
   - Log errors for debugging

### Example Worker Flow

```typescript
// Pseudo-code
async function processCrawlJob(job: CrawlJob) {
  // Update status to running
  await updateCrawlJob(job.id, { 
    status: 'running',
    started_at: new Date().toISOString()
  });

  const source = await getSource(job.source_id);
  const visited = new Set<string>();
  const queue = [source.url];
  
  while (queue.length > 0 && job.pages_indexed < (source.crawl_depth === 'shallow' ? 5 : 15)) {
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    
    try {
      // Fetch and parse page
      const page = await crawlPage(url, source);
      
      // Insert page
      await insertPage(page);
      
      // Update progress
      await updateCrawlJob(job.id, {
        pages_indexed: visited.size
      });
      
      // Discover links
      const links = extractLinks(page, source);
      for (const link of links) {
        if (!visited.has(link)) {
          queue.push(link);
          // Insert edge
          await insertPageEdge(page.id, link);
        }
      }
    } catch (error) {
      // Handle error
    }
  }
  
  // Mark as completed
  await updateCrawlJob(job.id, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    total_pages: visited.size
  });
}
```

### Dependencies Needed

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.90.1",
    "cheerio": "^1.0.0",
    "node-fetch": "^3.3.2",
    "robots-parser": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.8.0"
  }
}
```

## Integration with UI

The UI hooks are already set up to:
- ✅ Subscribe to `crawl_jobs` updates via Realtime
- ✅ Display pages as they're discovered
- ✅ Show graph edges for visualization
- ✅ Handle both authenticated and guest users

Once the worker is running, the UI will automatically update in real-time as pages are crawled.

## Testing

1. **Test Database Layer**:
   - Create a conversation
   - Add a source
   - Verify crawl job is created
   - Check RLS policies work correctly

2. **Test Hooks**:
   - Use React Query DevTools to inspect queries
   - Verify mutations invalidate correct queries
   - Test Realtime subscriptions

3. **Test Worker** (after Step 1):
   - Create a crawl job manually
   - Verify worker picks it up
   - Check pages are inserted
   - Verify UI updates in real-time

## Notes

- Guest mode: Users without accounts can use the UI, but data won't persist (owner_id = null)
- The current mock hooks (`useChat`, `useSources`) can coexist with the new database hooks
- Gradually migrate UI components to use the new hooks when ready
- The worker should be deployed separately (e.g., on a server, VPS, or serverless function)


