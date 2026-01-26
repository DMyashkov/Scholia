# Supabase Database Setup

This directory contains SQL migrations for the Scholia database schema.

## Migration Files

1. **001_initial_schema.sql** - Creates all tables, indexes, and constraints
2. **002_triggers.sql** - Sets up triggers for auto-setting `owner_id` and `updated_at`
3. **003_rls_policies.sql** - Configures Row Level Security (RLS) policies

## Running Migrations

### Option 1: Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Run each migration file in order (001, 002, 003)

### Option 2: Supabase CLI
```bash
# If you have Supabase CLI installed
supabase db push
```

### Option 3: Manual Execution
Copy and paste each migration file's contents into the Supabase SQL Editor and execute.

## Schema Overview

### Core Tables
- `conversations` - User conversations
- `messages` - Chat messages within conversations
- `sources` - Website sources to crawl
- `conversation_sources` - Many-to-many relationship between conversations and sources
- `crawl_jobs` - Tracks crawling progress
- `pages` - Crawled page content
- `page_edges` - Graph relationships between pages
- `chunks` - Text chunks for RAG (stubbed for future use)
- `citations` - Links messages to quotes/chunks (stubbed for future use)

### Key Features
- **RLS Enabled**: All tables have Row Level Security to isolate data per user
- **Guest Mode Support**: Tables allow `owner_id = NULL` for guest users
- **Auto-timestamps**: `created_at` and `updated_at` are automatically managed
- **Auto-owner**: `owner_id` is automatically set from `auth.uid()` on insert

## Important Notes

1. **Vector Extension**: The `chunks` table includes a `VECTOR(1536)` column for embeddings. You may need to enable the `pgvector` extension in Supabase:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```

2. **Realtime**: Make sure Realtime is enabled for tables you want to subscribe to:
   - `crawl_jobs` - For live crawl progress updates
   - `pages` - For live page discovery updates
   - `page_edges` - For live graph updates

   Enable in Supabase Dashboard: Database → Replication → Enable for each table

3. **Indexes**: All foreign keys and commonly queried columns are indexed for performance.

## Next Steps

After running migrations:
1. Enable Realtime for `crawl_jobs`, `pages`, and `page_edges` tables
2. Test the TypeScript client functions in `src/lib/db/`
3. Test the React Query hooks in `src/hooks/`
4. Implement the crawler worker service (Step 1)


