





import { corsHeaders } from './config.ts';
import { runRag } from './run.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();

  const emit = async (obj: unknown) => {
    await writer.write(encoder.encode(JSON.stringify(obj) + '\n'));
  };

  const log = (_phase: string, _detail?: Record<string, unknown>) => {};

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