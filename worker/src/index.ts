import { claimJob, processCrawlJob } from './crawler';

const CRAWL_INTERVAL_MS = parseInt(process.env.CRAWL_INTERVAL_MS || '5000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);

console.log('🚀 Scholia Crawler Worker starting...');
console.log(`📊 Polling interval: ${CRAWL_INTERVAL_MS}ms`);
console.log(`⚙️  Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`);

let activeJobs = new Set<string>();

async function main() {
  let pollCount = 0;
  while (true) {
    try {
      // Only claim new jobs if we have capacity
      while (activeJobs.size < MAX_CONCURRENT_JOBS) {
        const job = await claimJob();
        
        if (!job) {
          // Log occasionally when no jobs found
          if (pollCount % 10 === 0) {
            console.log(`🔍 No queued jobs found (poll #${pollCount})`);
          }
          break; // No jobs available
        }

        // Process job asynchronously
        activeJobs.add(job.id);
        console.log(`🚀 Starting job ${job.id.substring(0, 8)}... (conversation: ${job.conversation_id?.substring(0, 8) || 'NULL'}...)`);
        processCrawlJob(job.id)
          .then(() => {
            activeJobs.delete(job.id);
            console.log(`✅ Job ${job.id.substring(0, 8)}... completed, active jobs: ${activeJobs.size}`);
          })
          .catch((error) => {
            activeJobs.delete(job.id);
            console.error(`❌ Job ${job.id.substring(0, 8)}... failed:`, error);
          });
      }

      if (activeJobs.size > 0) {
        console.log(`🔄 ${activeJobs.size} job(s) in progress...`);
      }

      pollCount++;
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, CRAWL_INTERVAL_MS));
    } catch (error) {
      console.error('❌ Error in main loop:', error);
      // Wait a bit longer on error
      await new Promise(resolve => setTimeout(resolve, CRAWL_INTERVAL_MS * 2));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down gracefully...');
  process.exit(0);
});

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
