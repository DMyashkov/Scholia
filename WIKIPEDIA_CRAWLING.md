# Wikipedia Crawling Guide

## How the Crawler Works with Wikipedia

The crawler **will work** with Wikipedia articles! Here's how:

### 1. **Link Extraction**
- The crawler finds all `<a href>` links on the page
- Wikipedia uses relative URLs like `/wiki/President_of_the_United_States`
- These are automatically resolved to full URLs: `https://en.wikipedia.org/wiki/President_of_the_United_States`

### 2. **BFS (Breadth-First Search)**
- Starts from your seed URL (e.g., `https://en.wikipedia.org/wiki/Joe_Biden`)
- Extracts all links from that page
- Adds them to a queue
- Follows links one by one, up to your max pages limit

### 3. **What Gets Crawled**
When you start from `https://en.wikipedia.org/wiki/Joe_Biden`:
- ✅ It will find links like "president of the United States" → `/wiki/President_of_the_United_States`
- ✅ It will find links like "Delaware" → `/wiki/Delaware`
- ✅ It will follow these links and crawl those pages
- ✅ It will continue following links from those pages (up to depth 2)

### 4. **Graph Updates**
- Each new page discovered creates a **node** in the graph
- Each link between pages creates an **edge** in the graph
- The graph updates **in real-time** as pages are crawled
- You'll see nodes appear dynamically as the crawler discovers new pages

### 5. **Domain Filtering**
With `same_domain_only: true`:
- ✅ `en.wikipedia.org/wiki/...` links are allowed
- ✅ `wikipedia.org/wiki/...` links are allowed (parent domain)
- ❌ `fr.wikipedia.org/wiki/...` links are filtered (different subdomain)
- ❌ External links are filtered

## Testing with Wikipedia

### Quick Test Command

**Terminal 1 - Start worker:**
```bash
cd worker
npm run crawl
```

**Terminal 2 - Create test job:**
```bash
cd worker
npm run test:crawl
```

The test script is already configured to use `https://en.wikipedia.org/wiki/Joe_Biden`!

### What You'll See

In the worker logs:
```
📄 Fetching [1/15]: https://en.wikipedia.org/wiki/Joe_Biden
🔍 Extracting links from https://en.wikipedia.org/wiki/Joe_Biden...
📊 Link extraction summary: 500+ total, 200+ added, ...
➕ Queued: https://en.wikipedia.org/wiki/President_of_the_United_States
➕ Queued: https://en.wikipedia.org/wiki/Delaware
📄 Fetching [2/15]: https://en.wikipedia.org/wiki/President_of_the_United_States
...
```

In the browser:
- Graph nodes appear as pages are discovered
- Edges connect pages that link to each other
- Stats update in real-time

## Customizing the Test

Edit `worker/test-crawler.ts`:
```typescript
const testUrl = 'https://en.wikipedia.org/wiki/Joe_Biden';  // Change this
const domain = 'en.wikipedia.org';                          // And this
const crawl_depth = 'medium';  // 'shallow' (5), 'medium' (15), 'deep' (35)
```

## Notes

- Wikipedia has **many** links per page (often 200+)
- The crawler will find the most relevant article links
- It follows links in BFS order (breadth-first, not depth-first)
- Maximum depth is 2 levels (seed → linked pages → their linked pages)
- Pages are normalized (removes fragments, query params, trailing slashes)
