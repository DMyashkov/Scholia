

import { corsHeaders } from './config.ts';
import { runRag } from './run.ts';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  let terminalEmitted = false;
  const emit = async (obj: unknown) => {
    const rec = obj as Record<string, unknown>;
    if (rec?.done === true || rec?.error != null) terminalEmitted = true;
    await writer.write(encoder.encode(JSON.stringify(obj) + '\n'));
  };

  const log = (phase: string, detail?: Record<string, unknown>) => {
    console.log(`[RAG] ${phase}`, detail ? JSON.stringify(detail) : '');
  };

  const startTs = Date.now();
  const heartbeatMs = 12_000;
  let pingCount = 0;
  const heartbeat = setInterval(() => {
    pingCount++;
    void emit({ ping: Date.now(), elapsed: Date.now() - startTs, n: pingCount }).catch(() => {
      clearInterval(heartbeat);
    });
  }, heartbeatMs);

  (async () => {
    try {
      await runRag(req, emit, log);
    } catch (e) {
      const err = e as Error;
      console.error('[RAG] error', err?.message ?? e);
      try {
        await emit({ error: err?.message ?? String(e) });
      } catch (emitErr) {
        console.error('[RAG] failed to emit error', emitErr);
      }
    } finally {
      clearInterval(heartbeat);
      if (!terminalEmitted) {
        try {
          await emit({
            error:
              'Response ended before completion: Supabase Edge Functions on this project’s plan have a maximum continuous runtime per request, and this run exceeded that limit (or the connection closed). Partial progress may be saved—retry with a narrower question or check function logs in the Supabase dashboard.',
          });
        } catch (emitErr) {
          console.error('[RAG] failed to emit incomplete error', emitErr);
        }
      }
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});