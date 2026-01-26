# Scholia Crawler Worker

Node.js service that processes crawl jobs from the database.

## Setup

1. **Install dependencies:**
   ```bash
   cd worker
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and add:
   - `SUPABASE_URL` - Your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` - Your service role key (from Supabase Dashboard → Settings → API)

3. **Run in development:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## How it works

1. Polls `crawl_jobs` table for jobs with `status = 'queued'`
2. Processes each job:
   - Fetches the source URL
   - Extracts text content using Cheerio
   - Discovers links
   - Respects crawl depth and domain restrictions
   - Updates `crawl_jobs` progress in real-time
   - Inserts `pages` as discovered
   - Inserts `page_edges` for link relationships

## Environment Variables

- `SUPABASE_URL` - Supabase project URL (required)
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (required)
- `CRAWL_INTERVAL_MS` - Polling interval in milliseconds (default: 5000)
- `MAX_CONCURRENT_JOBS` - Max jobs to process simultaneously (default: 3)
- `MAX_PAGES_PER_SOURCE` - Max pages per source (default: 100)

## Deployment

You can deploy this worker to:
- A VPS/server (PM2, systemd, etc.)
- Serverless functions (Vercel, AWS Lambda, etc.)
- Docker container
- Any Node.js hosting service

## Notes

- Uses service role key to bypass RLS
- Respects robots.txt
- Rate limits itself (1 second delay between pages)
- Handles errors gracefully
- Updates progress in real-time via Supabase
