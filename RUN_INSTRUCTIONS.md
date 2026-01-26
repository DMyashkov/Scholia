# Step 1.5: Run Instructions

## Prerequisites

1. ✅ Database migrations run (001, 002, 003, 004, 005)
2. ✅ Realtime enabled for `crawl_jobs`, `pages`, `page_edges` tables
3. ✅ Supabase credentials configured

## Step-by-Step Setup

### 1. Run Database Migrations

In Supabase SQL Editor, run these in order:
- `supabase/migrations/004_update_crawl_jobs_schema.sql`
- `supabase/migrations/005_update_page_edges_schema.sql`

### 2. Configure Worker Environment

Create `worker/.env`:
```env
SUPABASE_URL=https://joknhyopvvdsljfjertr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
CRAWL_INTERVAL_MS=5000
MAX_CONCURRENT_JOBS=3
```

**Get service role key:**
- Supabase Dashboard → Settings → API
- Copy "service_role" key (NOT publishable key - this is secret!)

### 3. Install Worker Dependencies

```bash
cd worker
npm install
cd ..
```

### 4. Start the Worker

```bash
# From project root
npm run worker:crawl

# Or from worker directory
cd worker
npm run crawl
```

You should see:
```
🚀 Scholia Crawler Worker starting...
📊 Polling interval: 5000ms
⚙️  Max concurrent jobs: 3
```

### 5. Start the SPA

In a **separate terminal**:
```bash
npm run dev
```

### 6. Test End-to-End

1. **Open app** in browser (http://localhost:8080)
2. **Sign in** (or use as guest - data won't persist)
3. **Create conversation** (or use existing)
4. **Click "+ Add source"**
5. **Enter URL**: `https://example.com`
6. **Select depth**: Shallow (5 pages)
7. **Click "Add"**

### 7. Watch It Work

**In Worker Console:**
```
✅ Claimed job: <job-id> for source: <source-id>
🕷️  Starting crawl for source <source-id>: https://example.com (max: 5 pages)
📄 Fetching [1/5]: https://example.com
✅ Indexed [1/5]: Example Domain (X links, Y total edges)
📄 Fetching [2/5]: https://example.com/...
...
🎉 Crawl complete: 5 pages indexed, X discovered, Y edges
```

**In Browser:**
- Source chip shows progress: `0/5` → `1/5` → `2/5` ... → `5/5`
- Sidebar stats update: Discovered, Indexed, Links
- Graph nodes appear progressively
- Graph edges appear as pages are linked
- Debug panel (dev mode) shows live job status

**In Browser Console:**
```
🔔 Setting up realtime subscriptions for 1 source(s)
📊 Crawl job update: {status: 'running', indexed_count: 1, ...}
📄 New page: {id: '...', title: '...', ...}
🔗 New edge: {from_url: '...', to_url: '...', ...}
```

**In Supabase Dashboard:**
- `crawl_jobs` table: Status changes `queued` → `running` → `completed`
- `pages` table: Rows appear one by one
- `page_edges` table: Rows appear as links are discovered

## Troubleshooting

### Worker not picking up jobs?
- ✅ Check worker is running
- ✅ Verify `SUPABASE_SERVICE_ROLE_KEY` is correct (not publishable key)
- ✅ Check worker console for errors
- ✅ Verify job status is 'queued' in database

### UI not updating?
- ✅ Check Realtime is enabled for tables
- ✅ Check browser console for subscription errors
- ✅ Verify Supabase connection
- ✅ Check network tab for WebSocket connection

### Pages not appearing?
- ✅ Check worker logs for errors
- ✅ Verify source URL is accessible
- ✅ Check robots.txt isn't blocking
- ✅ Verify pages are being inserted in database

### Graph not updating?
- ✅ Check browser console for realtime events
- ✅ Verify edges are being created in database
- ✅ Check that pages have URLs (for edge matching)

## Expected Timeline

For `https://example.com` with shallow depth (5 pages):
- **0-5s**: Job created, worker claims it
- **5-15s**: First page indexed
- **15-30s**: All 5 pages indexed
- **30s**: Crawl complete, source status = 'ready'

## Success Criteria

✅ Worker claims jobs atomically  
✅ Progress updates in real-time  
✅ Pages appear in database as crawled  
✅ Edges created for discovered links  
✅ UI updates without refresh  
✅ Graph shows nodes/edges progressively  
✅ Source chips show live progress  
✅ Sidebar stats update in real-time  

## Next Steps

Once this works, you're ready for:
- Step 2: Embeddings and RAG
- Step 3: Real AI integration
