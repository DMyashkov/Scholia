# What Changed & How to Test

## 📋 Summary

**Nothing was changed** - only **new files were added**. Your existing code continues to work as before. These are foundation files ready for when you want to connect to the database.

## 🆕 New Files Created

### 1. Database Migrations (`supabase/migrations/`)
- `001_initial_schema.sql` - Creates all database tables
- `002_triggers.sql` - Auto-sets owner_id and timestamps
- `003_rls_policies.sql` - Row Level Security policies

### 2. Database Client Layer (`src/lib/db/`)
- `types.ts` - TypeScript types for all database entities
- `conversations.ts` - API for conversation operations
- `messages.ts` - API for message operations
- `sources.ts` - API for source operations
- `conversation-sources.ts` - API for linking sources to conversations
- `crawl-jobs.ts` - API for crawl job tracking
- `pages.ts` - API for pages and graph edges
- `index.ts` - Central export file

### 3. React Query Hooks (`src/hooks/`)
- `useConversations.ts` - Hooks for conversation management
- `useMessages.ts` - Hooks for message operations
- `useConversationSources.ts` - Hooks for source attachment
- `useCrawlJobs.ts` - Hooks for crawl job tracking (with Realtime)
- `usePages.ts` - Hooks for pages and edges

### 4. Documentation
- `supabase/README.md` - Migration instructions
- `DATABASE_SETUP.md` - Setup guide and next steps
- `CHANGES_AND_TESTING.md` - This file

## 🧪 How to Test

### Step 1: Run Database Migrations

1. **Open Supabase Dashboard**
   - Go to your Supabase project: https://supabase.com/dashboard
   - Navigate to **SQL Editor**

2. **Run Migration 1** (Schema)
   - Open `supabase/migrations/001_initial_schema.sql`
   - Copy all contents
   - Paste into SQL Editor
   - Click **Run** (or press Cmd/Ctrl + Enter)
   - ✅ Should see "Success. No rows returned"

3. **Run Migration 2** (Triggers)
   - Open `supabase/migrations/002_triggers.sql`
   - Copy all contents
   - Paste into SQL Editor
   - Click **Run**
   - ✅ Should see "Success. No rows returned"

4. **Run Migration 3** (RLS Policies)
   - Open `supabase/migrations/003_rls_policies.sql`
   - Copy all contents
   - Paste into SQL Editor
   - Click **Run**
   - ✅ Should see "Success. No rows returned"

5. **Verify Tables Created**
   - Go to **Table Editor** in Supabase Dashboard
   - You should see these tables:
     - conversations
     - messages
     - sources
     - conversation_sources
     - crawl_jobs
     - pages
     - page_edges
     - chunks
     - citations

### Step 2: Enable Realtime (Optional but Recommended)

1. Go to **Database** → **Replication** in Supabase Dashboard
2. Enable Realtime for:
   - `crawl_jobs`
   - `pages`
   - `page_edges`

This allows the UI to update in real-time when the crawler runs.

### Step 3: Test the Database Client Functions

Create a simple test file to verify the database layer works:

```typescript
// src/test-db.ts (temporary test file)
import { conversationsApi } from './lib/db/conversations';
import { messagesApi } from './lib/db/messages';
import { sourcesApi } from './lib/db/sources';
import { conversationSourcesApi } from './lib/db/conversation-sources';

async function testDatabase() {
  try {
    // Test 1: Create a conversation
    console.log('Test 1: Creating conversation...');
    const conversation = await conversationsApi.create({
      title: 'Test Conversation'
    });
    console.log('✅ Conversation created:', conversation.id);

    // Test 2: List conversations
    console.log('Test 2: Listing conversations...');
    const conversations = await conversationsApi.list(null); // null = guest mode
    console.log('✅ Conversations:', conversations.length);

    // Test 3: Create a message
    console.log('Test 3: Creating message...');
    const message = await messagesApi.create({
      conversation_id: conversation.id,
      role: 'user',
      content: 'Hello, this is a test message!'
    });
    console.log('✅ Message created:', message.id);

    // Test 4: Create a source
    console.log('Test 4: Creating source...');
    const source = await sourcesApi.create({
      url: 'https://example.com',
      domain: 'example.com',
      crawl_depth: 'shallow',
      include_subpages: true,
      include_pdfs: false,
      same_domain_only: true
    });
    console.log('✅ Source created:', source.id);

    // Test 5: Add source to conversation
    console.log('Test 5: Adding source to conversation...');
    await conversationSourcesApi.add(conversation.id, source.id);
    console.log('✅ Source added to conversation');

    // Test 6: List messages
    console.log('Test 6: Listing messages...');
    const messages = await messagesApi.list(conversation.id);
    console.log('✅ Messages:', messages.length);

    console.log('\n🎉 All tests passed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test
testDatabase();
```

**To run this test:**
1. Create the file above
2. Import and call it from somewhere (e.g., temporarily in `App.tsx`)
3. Check browser console for results

### Step 4: Test React Query Hooks

You can test the hooks in a React component. Here's an example:

```typescript
// Example: Test component (create temporarily)
import { useConversations } from '@/hooks/useConversations';
import { useCreateConversation } from '@/hooks/useConversations';
import { useMessages } from '@/hooks/useMessages';

function TestDatabaseHooks() {
  const { data: conversations, isLoading } = useConversations();
  const createConversation = useCreateConversation();
  const { data: messages } = useMessages(conversations?.[0]?.id || null);

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <h2>Database Test</h2>
      <p>Conversations: {conversations?.length || 0}</p>
      <button onClick={() => createConversation.mutate()}>
        Create Conversation
      </button>
      {messages && <p>Messages: {messages.length}</p>}
    </div>
  );
}
```

### Step 5: Verify in Supabase Dashboard

1. **Check Table Editor**
   - Go to **Table Editor**
   - Open `conversations` table
   - You should see any test data you created

2. **Check RLS Policies**
   - Go to **Authentication** → **Policies**
   - Verify policies are created for each table

3. **Test with Authenticated User**
   - Sign in to your app
   - Create a conversation
   - Check that `owner_id` is automatically set to your user ID

4. **Test Guest Mode**
   - Sign out
   - Create a conversation
   - Check that `owner_id` is `null`

## 🔍 Quick Verification Checklist

- [ ] All 3 migrations run successfully
- [ ] All 9 tables appear in Table Editor
- [ ] Can create a conversation via API
- [ ] Can create a message via API
- [ ] Can create a source via API
- [ ] Can link source to conversation
- [ ] Crawl job is auto-created when source is added
- [ ] RLS policies prevent cross-user data access
- [ ] Triggers auto-set `owner_id` and `updated_at`
- [ ] React Query hooks work without errors

## 🐛 Troubleshooting

### Error: "relation does not exist"
- Make sure you ran all 3 migrations in order
- Check that you're connected to the correct Supabase project

### Error: "permission denied"
- Check RLS policies are enabled
- Verify you're authenticated (or using null owner_id for guests)
- Check that triggers are set up correctly

### Error: "duplicate key value"
- The `sources` table has a unique constraint on `(owner_id, url)`
- This is intentional - same URL can't be added twice for the same user

### TypeScript Errors
- Make sure all imports are correct
- Check that `@/lib/db` path alias is working
- Run `npm install` to ensure dependencies are installed

## 📝 Next Steps

Once testing is complete:
1. The foundation is ready for the crawler worker
2. You can gradually migrate UI components to use the new hooks
3. The existing mock hooks (`useChat`, `useSources`) can coexist until migration is complete

## 🎯 What's NOT Changed

- ✅ All existing files remain unchanged
- ✅ Existing hooks (`useChat`, `useSources`, etc.) still work
- ✅ UI components continue to work with mocks
- ✅ No breaking changes

The new database layer is ready to use but doesn't interfere with existing functionality.
