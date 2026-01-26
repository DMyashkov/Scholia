# Quick Start Guide

## Running Everything

### Option 1: Run Both Together (Recommended for Development)

From the project root:
```bash
npm run dev:all
```

This starts:
- **SPA** (React app) on http://localhost:8080
- **Worker** (crawler) in the same terminal

Press `Ctrl+C` to stop both.

### Option 2: Run Separately (Better for Debugging)

**Terminal 1 - SPA:**
```bash
npm run dev
```

**Terminal 2 - Worker:**
```bash
npm run worker:crawl
```

## Testing the System

1. **Open app**: http://localhost:8080
2. **Sign in** (or use as guest)
3. **Create conversation** (or use existing)
4. **Add source**:
   - Click "+ Add source"
   - URL: `https://example.com`
   - Depth: Shallow (5 pages)
   - Click "Add"

5. **Watch it work**:
   - **Worker terminal**: Shows job claimed, pages crawling
   - **Browser**: Source chip shows progress (0/5 → 1/5 → ...)
   - **Sidebar**: Stats update (Discovered, Indexed, Links)
   - **Graph**: Nodes and edges appear progressively
   - **Console**: Realtime subscription events

## What You Should See

### Worker Terminal:
```
✅ Claimed job: <job-id> for source: <source-id>
🕷️  Starting crawl for source <source-id>: https://example.com (max: 5 pages)
📄 Fetching [1/5]: https://example.com
✅ Indexed [1/5]: Example Domain (X links, Y total edges)
...
🎉 Crawl complete: 5 pages indexed, X discovered, Y edges
```

### Browser Console:
```
🔔 Setting up realtime subscriptions for 1 source(s)
📊 Crawl job update: {status: 'running', indexed_count: 1, ...}
📄 New page: {id: '...', title: '...', ...}
🔗 New edge: {from_url: '...', to_url: '...', ...}
```

### UI:
- Source chip: Progress ring animates, shows "1/5", "2/5", etc.
- Sidebar stats: Numbers update in real-time
- Graph: New nodes appear, edges connect them
- Debug panel (dev mode): Shows job status

## Troubleshooting

**Worker not picking up jobs?**
- Check worker is running
- Verify `.env` file has correct service role key
- Check worker console for errors

**UI not updating?**
- Check browser console for errors
- Verify Realtime is enabled in Supabase
- Check network tab for WebSocket connection

**No pages appearing?**
- Check worker logs for fetch errors
- Verify source URL is accessible
- Check robots.txt isn't blocking

## Production Deployment

For production, you'll want to:
- Run worker as a service (PM2, systemd, Docker, etc.)
- Or use serverless functions
- Keep worker running 24/7 to process jobs

For now, running manually is fine for development!
