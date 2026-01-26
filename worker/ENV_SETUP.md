# Worker Environment Variables Setup

## Create the .env file

Create a file named `.env` in the `worker/` directory with the following:

```env
SUPABASE_URL=https://joknhyopvvdsljfjertr.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## How to Get Your Service Role Key

1. Go to your Supabase Dashboard: https://supabase.com/dashboard
2. Select your project
3. Go to **Settings** → **API**
4. Scroll down to **Project API keys**
5. Find the **"service_role"** key (NOT the publishable key!)
6. Click the eye icon to reveal it
7. Copy the entire key (it's a long JWT token)

**⚠️ IMPORTANT:** 
- The service_role key is **SECRET** - never commit it to git
- It has full database access (bypasses RLS)
- Only use it in the worker (backend), never in the frontend

## Complete .env File Example

```env
# Supabase Configuration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Optional: Crawler Settings (you can omit these to use defaults)
CRAWL_INTERVAL_MS=5000
MAX_CONCURRENT_JOBS=3
```

## Optional Variables

- `CRAWL_INTERVAL_MS` - How often to poll for new jobs (default: 5000ms = 5 seconds)
- `MAX_CONCURRENT_JOBS` - Max jobs to process at once (default: 3)

## File Location

The `.env` file should be in:
```
/Users/myashkov/Documents/Projects/Scholia/worker/.env
```

## Verify It Works

After creating the `.env` file, start the worker:
```bash
cd worker
npm run crawl
```

If you see:
```
🚀 Scholia Crawler Worker starting...
📊 Polling interval: 5000ms
⚙️  Max concurrent jobs: 3
```

Then it's working! ✅

If you see an error about missing environment variables, double-check:
- File is named exactly `.env` (not `.env.local` or `.env.example`)
- File is in the `worker/` directory
- No quotes around the values
- No extra spaces
