// Edge Function: queue add-page job for worker (worker fetches, indexes, reports progress)

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let supabaseClient: ReturnType<typeof createClient> | undefined;

  try {
    const body = (await req.json()) as { conversationId?: string; sourceId?: string; url?: string };
    const { conversationId, sourceId, url } = body;
    console.log('[add-page] request', { conversationId, sourceId, url });

    if (!conversationId || !sourceId || !url?.trim()) {
      return new Response(
        JSON.stringify({ error: 'conversationId, sourceId, and url required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const authHeader = req.headers.get('Authorization');
    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      global: { headers: authHeader ? { Authorization: authHeader } : {} },
    });
    const supabase = supabaseClient;

    // Normalize URL (matches worker addPageProcessor)
    let s = (url || '').trim();
    const hashIdx = s.indexOf('#');
    if (hashIdx >= 0) s = s.slice(0, hashIdx);
    const qIdx = s.indexOf('?');
    if (qIdx >= 0) s = s.slice(0, qIdx);
    s = s.trim();
    s = s.replace(/^(https?:\/\/)+/i, '');
    s = 'https://' + s;
    let normalizedUrl = s;
    try {
      const u = new URL(s);
      u.hash = '';
      u.search = '';
      if (u.pathname.endsWith('/') && u.pathname !== '/') u.pathname = u.pathname.slice(0, -1);
      normalizedUrl = u.toString();
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if page already exists
    const { data: existing } = await supabase
      .from('pages')
      .select('id, url, title, path')
      .eq('conversation_id', conversationId)
      .eq('source_id', sourceId)
      .eq('url', normalizedUrl)
      .maybeSingle();

    if (existing) {
      console.log('[add-page] page already exists', existing.id);
      return new Response(
        JSON.stringify({ page: existing, message: 'Page already in graph' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create add_page_job with status queued – worker will process and report progress
    const { data: job, error: jobErr } = await supabase
      .from('add_page_jobs')
      .insert({
        conversation_id: conversationId,
        source_id: sourceId,
        url: normalizedUrl,
        status: 'queued',
      })
      .select('id')
      .single();

    if (jobErr) {
      console.error('[add-page] failed to create job:', jobErr.message);
      return new Response(
        JSON.stringify({ error: jobErr.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[add-page] job queued', job.id);
    return new Response(
      JSON.stringify({
        jobId: job.id,
        status: 'queued',
        message: 'Processing in worker',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('[add-page] unhandled error:', e);
    const errMsg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
