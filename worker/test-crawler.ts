/**
 * Test script to create a crawl job and test the crawler
 * Run: npm run test:crawl
 */

import { supabase } from './src/db';

async function testCrawler() {
  console.log('🧪 Creating test crawl job...\n');

  try {
    // Create or get a test source
    // You can change this to any Wikipedia article or other site
    const testUrl = 'https://en.wikipedia.org/wiki/Joe_Biden';
    const domain = 'en.wikipedia.org';
    
    // Check if source exists
    const { data: existingSources } = await supabase
      .from('sources')
      .select('*')
      .eq('url', testUrl)
      .limit(1);
    
    let source;
    if (existingSources && existingSources.length > 0) {
      source = existingSources[0];
      console.log(`✅ Using existing source: ${source.id}`);
    } else {
      console.log('📝 Creating test source...');
      const { data: newSource, error: sourceError } = await supabase
        .from('sources')
        .insert({
          url: testUrl,
          domain: domain,
          crawl_depth: 'medium', // 15 pages
          same_domain_only: true,
        })
        .select()
        .single();
      
      if (sourceError) throw sourceError;
      source = newSource;
      console.log(`✅ Created source: ${source.id}`);
    }

    // Create a crawl job
    console.log('\n📋 Creating crawl job...');
    const { data: job, error: jobError } = await supabase
      .from('crawl_jobs')
      .insert({
        source_id: source.id,
        status: 'queued',
        indexed_count: 0,
        discovered_count: 0,
        total_pages: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        last_activity_at: null,
      })
      .select()
      .single();
    
    if (jobError) throw jobError;

    console.log(`✅ Created crawl job: ${job.id}`);
    console.log(`\n🚀 The worker should pick this up automatically!`);
    console.log(`\n📊 Watch the worker logs to see the crawl progress.`);
    console.log(`\n💡 To check job status, run:`);
    console.log(`   SELECT * FROM crawl_jobs WHERE id = '${job.id}';`);
    console.log(`\n💡 To check pages, run:`);
    console.log(`   SELECT * FROM pages WHERE source_id = '${source.id}';`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testCrawler();
