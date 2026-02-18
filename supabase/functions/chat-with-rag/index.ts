// Supabase Edge Function: chat-with-rag
// Embeds user message, retrieves relevant chunks, calls OpenAI Chat, creates assistant message + citations.
// Supports 2-round retrieval for complex questions. Streams step progress as NDJSON.
/// <reference path="./deno_types.d.ts" />

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from './config.ts';
import {
  MATCH_CHUNKS_PER_QUERY,
  MATCH_CHUNKS_PER_QUERY_ROUND2,
} from './config.ts';
import type { ChunkRow, PageRow, SourceRow } from './types.ts';
import { decomposeAndReformulate, runExtraction, buildRound2Queries } from './decompose.ts';
import { doRetrieve } from './retrieve.ts';
import { chat, getLastMessages } from './chat.ts';
import { chunkShape, buildQuotesOut } from './quotes.ts';
import { indicatesCantAnswer } from './utils.ts';
import { trySuggestPage, type SuggestedPage } from './suggestion.ts';

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

  const run = async () => {
    try {
      const body = (await req.json()) as {
        conversationId: string;
        userMessage: string;
        appendToMessageId?: string;
        indexedPageDisplay?: string;
        unfoldMode?: 'auto' | 'unfold' | 'direct';
      };
      const { conversationId, userMessage, appendToMessageId, indexedPageDisplay, unfoldMode = 'auto' } = body;

      if (!conversationId || !userMessage?.trim()) {
        await emit({ error: 'conversationId and userMessage required' });
        return;
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const openaiKey = Deno.env.get('OPENAI_API_KEY');
      if (!openaiKey) {
        await emit({ error: 'OPENAI_API_KEY secret not configured' });
        return;
      }

      const authHeader = req.headers.get('Authorization');
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: authHeader ? { Authorization: authHeader } : {} },
      }) as SupabaseClient;

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        await emit({ error: 'Authentication required' });
        return;
      }

      const { data: sources } = await supabase
        .from('sources')
        .select('id')
        .eq('conversation_id', conversationId);
      const sourceIds = (sources ?? []).map((s) => s.id);
      const { data: pagesData, error: pagesError } =
        sourceIds.length > 0
          ? await supabase
              .from('pages')
              .select('id, source_id, title, path, url')
              .in('source_id', sourceIds)
              .eq('status', 'indexed')
          : { data: [] as PageRow[], error: null };
      const pages = (pagesData ?? []) as PageRow[];

      if (pagesError || !pages?.length) {
        const content = !pages?.length
          ? "I don't have any indexed sources for this conversation yet. Add a source and run a crawl, then ask again."
          : "I couldn't load the source pages. Please try again.";
        const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content,
        }).select('*');
        if (insertErr || !inserted?.length) {
          await emit({ error: insertErr?.message ?? 'Failed to save message' });
          return;
        }
        await emit({ done: true, message: inserted[0], quotes: [] });
        return;
      }

      const pageIds = pages.map((p) => p.id);
      const { data: leadChunks = [] } = await supabase.rpc('get_lead_chunks', { match_page_ids: pageIds });
      const leadList = (leadChunks || []) as ChunkRow[];
      const leadIds = new Set(leadList.map((c) => c.id));

      // Decomposition
      let decomposeResult;
      try {
        decomposeResult = await decomposeAndReformulate(openaiKey, userMessage.trim());
      } catch (e) {
        console.warn('[RAG decomposition] failed:', e);
        decomposeResult = { queries: [userMessage.trim()] };
      }

      let { queries: searchQueries, needsSecondRound, round2 } = decomposeResult;

      if (unfoldMode === 'direct') {
        needsSecondRound = false;
        round2 = undefined;
        console.log('[RAG-2ROUND] unfoldMode=direct: forcing single round');
      } else if (unfoldMode === 'unfold') {
        needsSecondRound = true;
        if (!round2) {
          round2 = {
            extractionPrompt: 'Extract key entities, topics, or items from the context that are relevant to answering the question. Output JSON: {"items": ["...", ...]}',
            queryInstructions: 'For each item, create a search query combining the item with the question to find supporting details.',
          };
          console.log('[RAG-2ROUND] unfoldMode=unfold: using generic round2 fallback');
        }
      }

      const totalSteps = needsSecondRound && round2 ? 3 : 2;
      console.log('[RAG-2ROUND] decomposition:', { unfoldMode, needsSecondRound, hasRound2: !!round2, queriesCount: searchQueries.length });

      await emit({ step: 1, totalSteps, label: 'Gathering context' });

      const cappedMatch = await doRetrieve(supabase, openaiKey, pageIds, searchQueries);
      const combined: ChunkRow[] = [...leadList, ...cappedMatch.filter((c) => !leadIds.has(c.id))];
      let didSecondRound = false;

      if (needsSecondRound && round2 && combined.length > 0) {
        didSecondRound = true;
        console.log('[RAG-2ROUND] entering round 2');
        await emit({ step: 2, totalSteps, label: 'Extracting...' });

        const contextStr = combined.map(chunkShape).join('\n\n---\n\n');
        let extracted: Record<string, unknown> = {};
        try {
          extracted = await runExtraction(openaiKey, contextStr, round2.extractionPrompt);
        } catch (e) {
          console.warn('[RAG-2ROUND] extraction failed:', e);
        }

        const extractedKeys = Object.keys(extracted);
        console.log('[RAG-2ROUND] extraction:', { keyCount: extractedKeys.length, keys: extractedKeys });

        if (extractedKeys.length > 0) {
          const round2Queries = await buildRound2Queries(openaiKey, userMessage.trim(), extracted, round2.queryInstructions);
          console.log('[RAG-2ROUND] round2Queries:', round2Queries.length, round2Queries);
          if (round2Queries.length > 0) {
            const round2Match = await doRetrieve(supabase, openaiKey, pageIds, round2Queries, MATCH_CHUNKS_PER_QUERY_ROUND2);
            const existingIds = new Set(combined.map((c) => c.id));
            for (const c of round2Match) {
              if (!existingIds.has(c.id)) {
                combined.push(c);
                existingIds.add(c.id);
              }
            }
          }
        } else {
          console.log('[RAG-2ROUND] skipped: extraction empty');
        }
      } else {
        if (needsSecondRound && !round2) console.log('[RAG-2ROUND] skipped: no round2 config');
        if (needsSecondRound && combined.length === 0) console.log('[RAG-2ROUND] skipped: no chunks');
      }

      console.log('[RAG-2ROUND] didSecondRound:', didSecondRound);
      await emit({ step: totalSteps, totalSteps, label: 'Answering' });

      if (combined.length === 0) {
        const noChunksMessage = "I don't have indexed source content to cite yet. The crawl may have finished but chunking/embeddings may still be running. Please try again in a moment.";
        const { data: inserted } = await supabase.from('messages').insert({
          conversation_id: conversationId,
          role: 'assistant',
          content: noChunksMessage,
        }).select('*');
        await emit({ done: true, message: inserted?.[0] ?? { content: noChunksMessage }, quotes: [] });
        return;
      }

      const context = combined.map(chunkShape).join('\n\n---\n\n');
      const lastMessages = await getLastMessages(supabase, conversationId);
      const isFirstMessage = !appendToMessageId && lastMessages.length === 1;
      console.log('[RAG-TITLE] isFirstMessage=', isFirstMessage, 'lastMessages.length=', lastMessages.length, 'appendToMessageId=', appendToMessageId);

      const chatResult = await chat(openaiKey, context, lastMessages, userMessage.trim(), combined, isFirstMessage);

      const pageById = new Map<string, PageRow>(pages.map((p) => [p.id, p]));
      const { data: sourceRows } = await supabase
        .from('sources')
        .select('id, domain')
        .in('id', [...new Set(pages.map((p) => p.source_id))]);
      const sourceById = new Map<string, SourceRow>(((sourceRows || []) as SourceRow[]).map((s) => [s.id, s]));

      const quotedPageIds = [...new Set(chatResult.quotes.map((q) => q.pageId))];
      const { data: pagesWithContent = [] } = await supabase
        .from('pages')
        .select('id, content')
        .in('id', quotedPageIds);
      const pageContentById = new Map((pagesWithContent as { id: string; content: string | null }[]).map((p) => [p.id, p.content ?? '']));

      const quotesOut = buildQuotesOut(conversationId, chatResult.quotes, pageById, sourceById, pageContentById);

      const { data: conv } = await supabase
        .from('conversations')
        .select('owner_id, dynamic_mode')
        .eq('id', conversationId)
        .single();
      if (!conv) {
        await emit({ error: 'Conversation not found' });
        return;
      }
      const ownerId = conv.owner_id;

      let logReason = '1 round';
      if (didSecondRound) logReason = '2 rounds (decomposition + extraction + round2 queries)';
      else if (decomposeResult?.needsSecondRound && !decomposeResult?.round2) logReason = 'decomposition said needsSecondRound but no round2 config';
      else if (decomposeResult?.needsSecondRound) logReason = 'decomposition said needsSecondRound but round 2 skipped (extraction empty or no queries)';

      let assistantRow: Record<string, unknown>;

      if (appendToMessageId) {
        await supabase.from('messages').update({ suggested_page: null }).eq('id', appendToMessageId);
        console.log('[RAG-2ROUND] inserting follow-up message:', { follows: appendToMessageId, indexedPageDisplay });
        const { data: insertedMsg, error: msgInsertErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: chatResult.content,
            owner_id: ownerId,
            was_multi_step: didSecondRound,
            follows_message_id: appendToMessageId,
            indexed_page_display: indexedPageDisplay ?? null,
          })
          .select('*');
        assistantRow = insertedMsg?.[0] as Record<string, unknown>;
        if (msgInsertErr || !assistantRow) {
          console.error('[RAG-2ROUND] follow-up message insert failed:', msgInsertErr);
          await emit({ error: msgInsertErr?.message ?? 'Failed to save message' });
          return;
        }
      } else {
        console.log('[RAG-2ROUND] inserting message:', { was_multi_step: didSecondRound, reason: logReason });
        const { data: insertedMsg, error: msgInsertErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content: chatResult.content,
            owner_id: ownerId,
            was_multi_step: didSecondRound,
          })
          .select('*');
        assistantRow = insertedMsg?.[0] as Record<string, unknown>;
        if (msgInsertErr || !assistantRow) {
          console.error('[RAG-2ROUND] message insert failed:', msgInsertErr);
          await emit({ error: msgInsertErr?.message ?? 'Failed to save message' });
          return;
        }
        const { data: updated } = await supabase
          .from('messages')
          .update({ was_multi_step: didSecondRound })
          .eq('id', assistantRow.id)
          .select('*')
          .single();
        if (updated) assistantRow = updated as Record<string, unknown>;
        console.log('[RAG-2ROUND] message inserted:', { id: assistantRow?.id });
      }

      if (quotesOut.length > 0) {
        for (const q of quotesOut) {
          await supabase.from('quotes').insert({
            message_id: assistantRow.id,
            page_id: q.pageId,
            snippet: q.snippet,
            page_title: q.pageTitle ?? '',
            page_path: q.pagePath ?? '',
            domain: q.domain ?? '',
            page_url: q.pageUrl ?? null,
            context_before: q.contextBefore ?? null,
            context_after: q.contextAfter ?? null,
            owner_id: ownerId,
          });
        }
      }

      // Page suggestion
      let suggestedPage: SuggestedPage | null = null;
      const cantAnswer = indicatesCantAnswer(chatResult.content);
      const dynamicMode = (conv as { dynamic_mode?: boolean } | null)?.dynamic_mode !== false;
      console.log('[RAG-SUGGEST] evaluating', JSON.stringify({ appendToMessageId, cantAnswer, dynamicMode, conversationId }));

      if (!appendToMessageId && cantAnswer && dynamicMode) {
        const { data: convSources } = await supabase.from('sources').select('id').eq('conversation_id', conversationId);
        const allSourceIds = (convSources ?? []).map((s: { id: string }) => s.id);
        if (allSourceIds.length > 0) {
          try {
            suggestedPage = await trySuggestPage(supabase, openaiKey, conversationId, userMessage.trim(), searchQueries, allSourceIds, unfoldMode);
          } catch (e) {
            console.warn('[RAG-SUGGEST] match_discovered_links failed:', e);
          }
        }
      }

      if (suggestedPage) {
        await supabase.from('messages').update({ suggested_page: suggestedPage as Record<string, unknown> }).eq('id', assistantRow.id);
      }

      let suggestedTitle: string | undefined;
      if (isFirstMessage && chatResult.title && typeof chatResult.title === 'string') {
        const t = String(chatResult.title).trim().slice(0, 80);
        if (t.length > 0) {
          suggestedTitle = t;
          const { data: convBefore } = await supabase.from('conversations').select('title').eq('id', conversationId).single();
          const previousTitle = (convBefore as { title?: string } | null)?.title ?? '(unknown)';
          const { error: updateErr } = await supabase.from('conversations').update({ title: suggestedTitle }).eq('id', conversationId);
          console.log('[RAG-TITLE] AI suggested title:', JSON.stringify(suggestedTitle), '| previous:', JSON.stringify(previousTitle), '| swapped:', previousTitle !== suggestedTitle, '| updateErr:', updateErr?.message ?? 'none');
        }
      } else if (isFirstMessage) {
        console.log('[RAG-TITLE] First message but no title from AI; chatResult.title=', chatResult.title, '(type:', typeof chatResult.title, ')');
      }

      await emit({ done: true, message: assistantRow, quotes: quotesOut, suggestedPage: suggestedPage ?? undefined, ...(suggestedTitle ? { suggestedTitle } : {}) });
    } catch (e) {
      console.error(e);
      await emit({ error: (e as Error).message });
    } finally {
      await writer.close();
    }
  };

  run();

  return new Response(stream.readable, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});
