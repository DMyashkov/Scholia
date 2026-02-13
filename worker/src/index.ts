import { claimJob, processCrawlJob } from './crawler';

const CRAWL_INTERVAL_MS = parseInt(process.env.CRAWL_INTERVAL_MS || '5000', 10);
const MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || '3', 10);

let activeJobs = new Set<string>();

async function main() {
  while (true) {
    try {
      while (activeJobs.size < MAX_CONCURRENT_JOBS) {
        const job = await claimJob();

        if (!job) break;

        activeJobs.add(job.id);
        processCrawlJob(job.id)
          .then(() => {
            activeJobs.delete(job.id);
          })
          .catch((error) => {
            activeJobs.delete(job.id);
            console.error(`❌ Job ${job.id.substring(0, 8)}... failed:`, error);
          });
      }
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, CRAWL_INTERVAL_MS));
    } catch (error) {
      console.error('❌ Error in main loop:', error);
      // Wait a bit longer on error
      await new Promise(resolve => setTimeout(resolve, CRAWL_INTERVAL_MS * 2));
    }
  }
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
