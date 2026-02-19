// Supabase Edge Function: chat-with-rag
// Evidence-First Iterative RAG: plan -> loop (retrieve, extract+decide) -> finalize.
// Streams NDJSON: plan, step, done | clarify | error.
/// <reference path="./deno_types.d.ts" />

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { corsHeaders } from './config.ts';
import {
  MATCH_CHUNKS_PER_QUERY,
  MAX_ITERATIONS,
  MAX_SUBQUERIES_PER_ITER,
  MAX_TOTAL_SUBQUERIES,
  MAX_EXPANSIONS,
  STAGNATION_THRESHOLD,
  INCLUDE_FILL_STATUS_BY_SLOT,
} from './config.ts';
import type { ChunkRow, PageRow, SourceRow } from './types.ts';
import type { PlanResult, PlanSlot, PlanSubquery } from './types.ts';
import { callPlan } from './plan.ts';
import { callExtractAndDecide, insertClaims } from './loop.ts';
import type { SlotRow } from './loop.ts';
import { doRetrieveAndCreateQuotes } from './retrieve.ts';
import {
  chunkShape,
  createQuoteFromChunk,
  replaceCitationPlaceholders,
  attachQuotesToMessage,
  buildQuotesOut,
  updateQuoteContextFromPage,
} from './quotes.ts';
import { slotCompleteness, overallCompleteness } from './completeness.ts';
import type { SlotForCompleteness } from './completeness.ts';
import { doExpandCorpus, type SuggestedPage } from './expand.ts';
import { getLastMessages } from './chat.ts';

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

  const log = (phase: string, detail?: Record<string, unknown>) => {
    if (detail != null) {
      console.log('[RAG]', phase, JSON.stringify(detail));
    } else {
      console.log('[RAG]', phase);
    }
  };

  const run = async () => {
  try {
      log('start');
    const body = (await req.json()) as {
      conversationId: string;
      userMessage: string;
        rootMessageId?: string;
      appendToMessageId?: string;
        scrapedPageDisplay?: string;
    };
      const { conversationId, userMessage, rootMessageId: bodyRootMessageId, appendToMessageId, scrapedPageDisplay } = body;

    if (!conversationId || !userMessage?.trim()) {
        log('error', { reason: 'conversationId and userMessage required' });
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

      const { data: conv } = await supabase
        .from('conversations')
        .select('owner_id, dynamic_mode')
        .eq('id', conversationId)
        .single();
      if (!conv) {
        await emit({ error: 'Conversation not found' });
        return;
      }
      const ownerId = (conv as { owner_id?: string }).owner_id ?? user.id;
      const dynamicMode = (conv as { dynamic_mode?: boolean }).dynamic_mode !== false;

    const { data: sources } = await supabase
      .from('sources')
      .select('id')
      .eq('conversation_id', conversationId);
      const sourceIds = (sources ?? []).map((s: { id: string }) => s.id);
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
        log('no-pages', { pagesError: !!pagesError, pageCount: pages?.length ?? 0 });
      const content = !pages?.length
        ? "I don't have any indexed sources for this conversation yet. Add a source and run a crawl, then ask again."
        : "I couldn't load the source pages. Please try again.";
      const { data: inserted, error: insertErr } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content,
          owner_id: ownerId,
      }).select('*');
      if (insertErr || !inserted?.length) {
          await emit({ error: insertErr?.message ?? 'Failed to save message' });
          return;
        }
        await emit({ done: true, message: inserted[0], quotes: [] });
        return;
    }

    const pageIds = pages.map((p) => p.id);
      const pageById = new Map<string, PageRow>(pages.map((p) => [p.id, p]));
      const { data: sourceRows } = await supabase
        .from('sources')
        .select('id, domain')
        .in('id', [...new Set(pages.map((p) => p.source_id))]);
      const sourceById = new Map<string, SourceRow>(((sourceRows || []) as SourceRow[]).map((s) => [s.id, s]));
      const sourceDomainByPageId = new Map<string, string>();
      for (const p of pages) {
        const src = sourceById.get(p.source_id);
        sourceDomainByPageId.set(p.id, src?.domain ?? (p.url ? new URL(p.url).hostname : ''));
      }

      const { data: leadChunks = [] } = await supabase.rpc('get_lead_chunks', { match_page_ids: pageIds });
    const leadList = (leadChunks || []) as ChunkRow[];

      // Resolve root message id
      let rootMessageId: string;
      if (appendToMessageId) {
        const { data: assistantMsg } = await supabase
          .from('messages')
          .select('id, created_at')
          .eq('id', appendToMessageId)
          .single();
        if (!assistantMsg) {
          await emit({ error: 'appendToMessageId message not found' });
          return;
        }
        const prevCreated = (assistantMsg as { created_at?: string }).created_at;
        const { data: prevList } = await supabase
          .from('messages')
          .select('id')
          .eq('conversation_id', conversationId)
          .lt('created_at', prevCreated ?? new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1);
        const prev = (prevList ?? []) as { id: string }[];
        if (!prev.length) {
          await emit({ error: 'Could not resolve root message for append' });
          return;
        }
        rootMessageId = prev[0].id;
      } else if (bodyRootMessageId) {
        rootMessageId = bodyRootMessageId;
      } else {
        const { data: insertedUser } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'user',
            content: userMessage.trim(),
            owner_id: ownerId,
          })
          .select('id')
          .single();
        if (!insertedUser?.id) {
          await emit({ error: 'Failed to create user message' });
          return;
        }
        rootMessageId = insertedUser.id;
      }

      type SlotDb = { id: string; name: string; type: string; description?: string | null; required: boolean; depends_on_slot_id?: string | null };
      type SubqueryDb = { id: string; reasoning_step_id: string; slot_id: string; query_text: string };
      type StepDb = { id: string; iteration_number: number; action: string; why?: string | null; completeness_score?: number | null };

      let slots: SlotDb[] = [];
      let slotIdByName: Map<string, string> = new Map();
      let planResult: PlanResult | null = null;
      let expansionCount = appendToMessageId ? 1 : 0;

      if (appendToMessageId) {
        const { data: slotRows } = await supabase
          .from('slots')
          .select('id, name, type, description, required, depends_on_slot_id')
          .eq('root_message_id', rootMessageId);
        slots = (slotRows ?? []) as SlotDb[];
        slotIdByName = new Map(slots.map((s) => [s.name, s.id]));
        const { data: firstStep } = await supabase
          .from('reasoning_steps')
          .select('id')
          .eq('root_message_id', rootMessageId)
          .eq('action', 'retrieve')
          .order('iteration_number', { ascending: true })
          .limit(1)
          .single();
        if (firstStep?.id) {
          const { data: subq } = await supabase
            .from('reasoning_subqueries')
            .select('id, reasoning_step_id, slot_id, query_text')
            .eq('reasoning_step_id', firstStep.id);
          const subqueries = (subq ?? []) as SubqueryDb[];
          const names = new Map(slots.map((s) => [s.id, s.name]));
          const queryTexts = subqueries.map((r) => r.query_text).filter(Boolean);
          planResult = {
            action: 'retrieve',
            why: 'Reusing plan after corpus expansion',
            slots: slots.map((s) => ({
              name: s.name,
              type: s.type as PlanSlot['type'],
              description: s.description ?? undefined,
              required: s.required,
              dependsOn: s.depends_on_slot_id ? slots.find((x) => x.id === s.depends_on_slot_id)?.name : undefined,
            })),
            subqueries: queryTexts.length > 0
              ? subqueries.map((r) => ({ slot: names.get(r.slot_id) ?? '', query: r.query_text }))
              : [{ slot: 'answer', query: userMessage.trim().slice(0, 200) }],
          };
        }
      }

      if (!planResult) {
        log('plan-call');
        planResult = await callPlan(openaiKey, userMessage.trim());
        log('plan-result', { action: planResult.action, slotCount: planResult.slots.length, subqueryCount: planResult.subqueries.length });
        const { data: stepRow, error: stepErr } = await supabase
          .from('reasoning_steps')
          .insert({
            root_message_id: rootMessageId,
            owner_id: ownerId,
            iteration_number: 1,
            action: planResult.action,
            why: planResult.why ?? null,
          })
          .select('id')
          .single();
        if (stepErr || !stepRow?.id) {
          await emit({ error: stepErr?.message ?? 'Failed to create reasoning step' });
          return;
        }
        const stepId = stepRow.id;
        const slotInserts = planResult.slots.map((s) => ({
          root_message_id: rootMessageId,
          owner_id: ownerId,
          name: s.name,
          type: s.type,
          description: s.description ?? null,
          required: s.required !== false,
          depends_on_slot_id: null as string | null,
        }));
        for (let i = 0; i < planResult.slots.length; i++) {
          const s = planResult.slots[i];
          const depId = s.dependsOn ? planResult.slots.find((x) => x.name === s.dependsOn)?.name : undefined;
          (slotInserts[i] as { depends_on_slot_id?: string | null }).depends_on_slot_id = null;
        }
        const { data: insertedSlots } = await supabase.from('slots').insert(slotInserts).select('id, name');
        const insertedSlotsList = (insertedSlots ?? []) as { id: string; name: string }[];
        slotIdByName = new Map(insertedSlotsList.map((s) => [s.name, s.id]));
        const depByName = new Map(planResult.slots.filter((s) => s.dependsOn).map((s) => [s.name, s.dependsOn!]));
        for (const row of insertedSlotsList) {
          const dep = depByName.get(row.name);
          if (dep) {
            const depId = slotIdByName.get(dep);
            if (depId) await supabase.from('slots').update({ depends_on_slot_id: depId }).eq('id', row.id);
          }
        }
        slots = (await supabase.from('slots').select('id, name, type, description, required, depends_on_slot_id').eq('root_message_id', rootMessageId))
          .data as SlotDb[] ?? [];
        slotIdByName = new Map(slots.map((s) => [s.name, s.id]));
        for (const q of planResult.subqueries) {
          const sid = slotIdByName.get(q.slot);
          if (sid) {
            await supabase.from('reasoning_subqueries').insert({
              reasoning_step_id: stepId,
              slot_id: sid,
              owner_id: ownerId,
              query_text: q.query,
            });
          }
        }
        await emit({ plan: { action: planResult.action, why: planResult.why, slots: planResult.slots, subqueries: planResult.subqueries } });
        const initialThought = {
          slots: (planResult.slots ?? []).map((s) => {
            const o: { name: string; type: string; description?: string } = { name: s.name, type: s.type };
            if (s.description) o.description = s.description;
            return o;
          }),
          steps: [],
        };
        await emit({ thoughtProcess: initialThought });
      }

      const slotRowsForExtract: SlotRow[] = slots.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        description: s.description ?? undefined,
        depends_on_slot_id: s.depends_on_slot_id ?? undefined,
      }));

      let totalSubqueriesRun = 0;
      let iteration = 0;
      let lastStepId: string | null = null;
      type ThoughtStep = {
        iter: number;
        action: string;
        why?: string;
        subqueries?: { slot: string; query: string }[];
        chunksPerSubquery?: number[];
        quotesFound?: number;
        claims?: unknown[];
        completeness?: number;
        fillStatusBySlot?: Record<string, string>;
        /** One-after-the-other narrative statements for this step (retrieve, extract, fill). */
        statements?: string[];
        /** After this step: answer | retrieve | expand_corpus | clarify */
        nextAction?: string;
      };
      let thoughtProcess: {
        slots: { name: string; type: string; description?: string }[];
        planReason?: string;
        steps: ThoughtStep[];
        iterationCount?: number;
        hardStopReason?: string;
        completeness?: number;
        expandCorpusReason?: string;
        clarifyQuestions?: string[];
        extractionGaps?: string[];
        partialAnswerNote?: string;
      } = {
        slots: (planResult?.slots ?? []).map((s) => {
          const o: { name: string; type: string; description?: string } = { name: s.name, type: s.type };
          if (s.description) o.description = s.description;
          return o;
        }),
        planReason: appendToMessageId
          ? 'Same question, with the new page in the corpus.'
          : (planResult?.why ?? undefined),
        steps: [],
      };

      const getSlotItemCountBySlotId = async (): Promise<Map<string, number>> => {
        const { data: items } = await supabase
          .from('slot_items')
          .select('slot_id')
          .in('slot_id', slots.map((s) => s.id));
        const countBySlot = new Map<string, number>();
        for (const s of slots) countBySlot.set(s.id, 0);
        for (const row of (items ?? []) as { slot_id: string }[]) {
          countBySlot.set(row.slot_id, (countBySlot.get(row.slot_id) ?? 0) + 1);
        }
        return countBySlot;
      };

      const getCurrentSlotItemsSummary = async (): Promise<string> => {
        const { data: items } = await supabase
          .from('slot_items')
          .select('slot_id, key, value_json')
          .in('slot_id', slots.map((s) => s.id));
        const bySlot = new Map<string, { key: string | null; value: unknown }[]>();
        for (const row of (items ?? []) as { slot_id: string; key: string | null; value_json: unknown }[]) {
          const list = bySlot.get(row.slot_id) ?? [];
          list.push({ key: row.key, value: row.value_json });
          bySlot.set(row.slot_id, list);
        }
        const names = new Map(slots.map((s) => [s.id, s.name]));
        const lines: string[] = [];
        for (const [slotId, list] of bySlot) {
          const name = names.get(slotId) ?? slotId;
          lines.push(`${name}: ${list.map((x) => (x.key ? `${x.key}=${JSON.stringify(x.value)}` : JSON.stringify(x.value))).join(', ')}`);
        }
        return lines.length ? lines.join('\n') : '';
      };

      let prevSlotItemCount = 0;
      let done = false;
      let finalAnswer: string | undefined;
      let quoteIdsOrdered: string[] = [];
      let validQuoteIds = new Set<string>();
      let lastExtractResult: { next_action: string; why?: string; final_answer?: string; subqueries?: { slot: string; query: string }[]; extractionGaps?: string[]; cited_snippets?: Record<string, string> } | null = null;
      const extractionGapsAccumulated: string[] = [];

      if (thoughtProcess.slots.length > 0) {
        await emit({ thoughtProcess: { ...thoughtProcess } });
      }

      while (!done && iteration < MAX_ITERATIONS) {
        iteration++;
        const stepList = (await supabase
          .from('reasoning_steps')
          .select('id, iteration_number, action')
          .eq('root_message_id', rootMessageId)
          .order('iteration_number', { ascending: true })).data as StepDb[] ?? [];
        const retrieveStep = stepList.find((s) => s.action === 'retrieve' && s.iteration_number === iteration);
        let currentStepId: string;
        let subqueryTexts: string[];

        if (retrieveStep) {
          currentStepId = retrieveStep.id;
          const { data: sq } = await supabase
            .from('reasoning_subqueries')
            .select('query_text, slot_id')
            .eq('reasoning_step_id', currentStepId);
          const sqRows = (sq ?? []) as { query_text: string; slot_id: string }[];
          subqueryTexts = sqRows.map((r) => r.query_text).filter(Boolean);
        } else {
          const { data: newStep } = await supabase
            .from('reasoning_steps')
            .insert({
              root_message_id: rootMessageId,
              owner_id: ownerId,
              iteration_number: iteration,
              action: 'retrieve',
              why: lastExtractResult?.why ?? null,
            })
            .select('id')
            .single();
          if (!newStep?.id) break;
          currentStepId = newStep.id;
          const nextSubs = lastExtractResult?.subqueries?.length
            ? lastExtractResult.subqueries
            : [{ slot: 'answer', query: userMessage.trim().slice(0, 200) }];
          const capped = nextSubs.slice(0, MAX_SUBQUERIES_PER_ITER);
          for (const q of capped) {
            const sid = slotIdByName.get(q.slot);
            if (sid) await supabase.from('reasoning_subqueries').insert({ reasoning_step_id: currentStepId, slot_id: sid, owner_id: ownerId, query_text: q.query });
          }
          const { data: sq } = await supabase.from('reasoning_subqueries').select('query_text, slot_id').eq('reasoning_step_id', currentStepId);
          const sqRows = (sq ?? []) as { query_text: string; slot_id: string }[];
          subqueryTexts = sqRows.map((r) => r.query_text).filter(Boolean);
        }

        const subqueriesToRun = subqueryTexts.slice(0, Math.min(MAX_SUBQUERIES_PER_ITER, MAX_TOTAL_SUBQUERIES - totalSubqueriesRun));
        if (subqueriesToRun.length === 0) break;

        totalSubqueriesRun += subqueriesToRun.length;
        lastStepId = currentStepId;

        log('retrieve-start', { iteration, subqueryCount: subqueriesToRun.length });
        const { chunks: retrievedChunks, quoteIds: newQuoteIds, chunksPerSubquery } = await doRetrieveAndCreateQuotes(
          supabase,
          openaiKey,
          pageIds,
          subqueriesToRun,
          pageById,
          sourceDomainByPageId,
          currentStepId,
          ownerId,
        );
        log('retrieve-done', { quotesCreated: newQuoteIds.length, chunksPerSubquery });

        for (const c of leadList) {
          const page = pageById.get(c.page_id);
          if (!page) continue;
          const domain = sourceDomainByPageId.get(c.page_id) ?? '';
          const id = await createQuoteFromChunk(supabase, {
            chunk: c,
            page,
            domain,
            retrievedInReasoningStepId: currentStepId,
            ownerId,
          });
          if (id) newQuoteIds.push(id);
        }

        type QuoteRow = { id: string; snippet: string };
        const allQuotesForRoot: QuoteRow[] = await (async (): Promise<QuoteRow[]> => {
          const { data: steps } = await supabase.from('reasoning_steps').select('id').eq('root_message_id', rootMessageId);
          const stepIds = (steps ?? []).map((s: { id: string }) => s.id);
          if (stepIds.length === 0) return [];
          const { data: qrows } = await supabase
            .from('quotes')
            .select('id, snippet')
            .in('retrieved_in_reasoning_step_id', stepIds);
          return (qrows ?? []) as QuoteRow[];
        })();
        validQuoteIds = new Set(allQuotesForRoot.map((q) => q.id));
        const quotesForExtract = allQuotesForRoot.map((q) => ({ id: q.id, snippet: q.snippet }));

        const currentSummary = await getCurrentSlotItemsSummary();
        log('extract-call', { iteration, quoteCount: quotesForExtract.length });
        const extractResult = await callExtractAndDecide(openaiKey, slotRowsForExtract, quotesForExtract, currentSummary, userMessage.trim(), dynamicMode);
        lastExtractResult = extractResult;
        if (extractResult.extractionGaps?.length) {
          extractionGapsAccumulated.push(...extractResult.extractionGaps);
        }

        log('extract-done', {
          iteration,
          next_action: extractResult.next_action,
          claimsCount: extractResult.claims.length,
          why: extractResult.why,
          extractionGaps: extractResult.extractionGaps,
        });

        await insertClaims(supabase, { slotIdByName, claims: extractResult.claims, ownerId });

        const slotItemCountBySlotId = await getSlotItemCountBySlotId();
        const slotsForCompleteness: SlotForCompleteness[] = slots.map((s) => ({
          id: s.id,
          type: s.type as SlotForCompleteness['type'],
          required: s.required,
          depends_on_slot_id: s.depends_on_slot_id ?? null,
        }));
        const completeness = overallCompleteness(slotsForCompleteness, slotItemCountBySlotId);

        await supabase
          .from('reasoning_steps')
          .update({ completeness_score: completeness, why: extractResult.why ?? undefined })
          .eq('id', currentStepId);

        let fillStatusBySlot: Record<string, string> | undefined;
        if (INCLUDE_FILL_STATUS_BY_SLOT) {
          fillStatusBySlot = {};
          for (const slot of slots) {
            const score = slotCompleteness(
              { id: slot.id, type: slot.type as SlotForCompleteness['type'], required: slot.required, depends_on_slot_id: slot.depends_on_slot_id ?? null },
              slotItemCountBySlotId,
            );
            const count = slotItemCountBySlotId.get(slot.id) ?? 0;
            fillStatusBySlot[slot.name] = score >= 1 ? 'filled' : count > 0 ? 'partial' : 'missing';
          }
        }

        const { data: subqRows } = await supabase
          .from('reasoning_subqueries')
          .select('query_text, slot_id')
          .eq('reasoning_step_id', currentStepId);
        const subqueriesWithSlot: { slot: string; query: string }[] = ((subqRows ?? []) as { query_text: string; slot_id: string }[]).map((r) => ({
          slot: slots.find((s) => s.id === r.slot_id)?.name ?? '',
          query: r.query_text,
        }));

        const subqueriesForStep = subqueriesWithSlot.length ? subqueriesWithSlot : subqueriesToRun.map((q) => ({ slot: '', query: q }));
        const stepStatements: string[] = [];
        stepStatements.push(`Retrieved ${newQuoteIds.length} quotes from this step.`);
        stepStatements.push(extractResult.why ?? 'Extract');
        stepStatements.push(`Achieved ${Math.round((completeness ?? 0) * 100)}% completeness.`);
        if (INCLUDE_FILL_STATUS_BY_SLOT && fillStatusBySlot && Object.keys(fillStatusBySlot).length > 0) {
          stepStatements.push(`Fill: ${Object.entries(fillStatusBySlot).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
        }
        const stepEntry: ThoughtStep = {
          iter: iteration,
          action: 'retrieve',
          why: extractResult.why,
          subqueries: subqueriesForStep,
          chunksPerSubquery: chunksPerSubquery?.length ? chunksPerSubquery : undefined,
          quotesFound: newQuoteIds.length,
          claims: extractResult.claims,
          completeness,
          fillStatusBySlot: INCLUDE_FILL_STATUS_BY_SLOT ? fillStatusBySlot : undefined,
          statements: stepStatements,
          nextAction: extractResult.next_action,
        };
        thoughtProcess.steps.push(stepEntry);
        if (extractionGapsAccumulated.length > 0) {
          thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
        }
        await emit({ thoughtProcess: { ...thoughtProcess } });

        await emit({
          step: iteration,
          totalSteps: MAX_ITERATIONS,
          iter: iteration,
          action: extractResult.next_action,
          label: extractResult.next_action === 'answer' ? 'Answering' : extractResult.next_action === 'retrieve' ? 'Retrieving again' : extractResult.next_action,
          why: extractResult.why,
          quotesFound: newQuoteIds.length,
          claims: extractResult.claims,
          completeness,
          fillStatusBySlot: INCLUDE_FILL_STATUS_BY_SLOT ? fillStatusBySlot : undefined,
        });

        const currentSlotItemCount = Array.from(slotItemCountBySlotId.values()).reduce((a, b) => a + b, 0);
        const stagnation = iteration > 1 && (currentSlotItemCount - prevSlotItemCount) <= STAGNATION_THRESHOLD;
        const zeroCompletenessGiveUp = completeness === 0 && iteration >= 1;
        prevSlotItemCount = currentSlotItemCount;

        if (extractResult.next_action === 'answer' && (extractResult.final_answer ?? '').trim().length > 0) {
          finalAnswer = extractResult.final_answer;
          done = true;
          break;
        }
        if (extractResult.next_action === 'clarify') {
          log('clarify', { why: extractResult.why });
          const questions = extractResult.questions?.length ? extractResult.questions : [extractResult.why ?? 'Could you clarify?'];
          const content = typeof questions === 'object' && Array.isArray(questions)
            ? questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
            : String(questions);
          thoughtProcess.clarifyQuestions = Array.isArray(questions) ? questions : [content];
          await emit({ thoughtProcess: { ...thoughtProcess } });
          const { data: clarifyMsg, error: clarifyErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
              content: 'I need a bit more detail to answer well:\n\n' + content,
          owner_id: ownerId,
              thought_process: { ...thoughtProcess, clarifyQuestions: questions },
            })
            .select('*')
            .single();
          if (!clarifyErr && clarifyMsg) {
            await emit({ clarify: true, questions: Array.isArray(questions) ? questions : [content] });
            await emit({ done: true, message: clarifyMsg, quotes: [] });
          } else {
            await emit({ error: clarifyErr?.message ?? 'Failed to save clarify message' });
          }
        return;
      }
        if (extractResult.next_action === 'expand_corpus') {
          log('expand_corpus', { why: extractResult.why, expansionCount });
          if (expansionCount >= MAX_EXPANSIONS) {
            thoughtProcess.hardStopReason = `Max expansions (${MAX_EXPANSIONS}) reached`;
            if (INCLUDE_FILL_STATUS_BY_SLOT && fillStatusBySlot) {
              const missing = Object.entries(fillStatusBySlot).filter(([, v]) => v === 'missing' || v === 'partial').map(([k, v]) => `${k} (${v})`);
              if (missing.length) {
                thoughtProcess.partialAnswerNote = completeness === 0
                  ? 'No evidence found for the requested slots.'
                  : `Answered with partial completeness; missing or partial: ${missing.join(', ')}`;
              }
            }
            if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
            finalAnswer = extractResult.final_answer ?? "I've hit the limit for suggesting new pages. You can add more sources and ask again.";
            done = true;
            break;
          }
          let suggestedPage: SuggestedPage | null = null;
          if (dynamicMode && sourceIds.length > 0) {
            suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMessage.trim(), subqueryTexts.slice(0, 3));
            if (suggestedPage) log('expand-suggested', { url: suggestedPage.url });
          }
          thoughtProcess.expandCorpusReason = extractResult.why;
          if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
          await emit({ thoughtProcess: { ...thoughtProcess } });
          const stubContent = suggestedPage
            ? "Consider adding the suggested page below, then I can answer with the full picture."
            : "I couldn't find enough in the current pages. Add more sources if you have them.";
          const { data: stubMsg, error: stubErr } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          role: 'assistant',
              content: stubContent,
          owner_id: ownerId,
              suggested_page: suggestedPage ?? undefined,
              thought_process: { ...thoughtProcess, expandCorpusReason: extractResult.why, planReason: thoughtProcess.planReason },
            })
        .select('*')
        .single();
          if (stubErr || !stubMsg) {
            await emit({ error: stubErr?.message ?? 'Failed to save stub message' });
            return;
          }
          await emit({ done: true, message: stubMsg, quotes: [], suggestedPage: suggestedPage ?? undefined, thoughtProcess });
          return;
        }
        if (extractResult.next_action === 'retrieve') {
          if (totalSubqueriesRun >= MAX_TOTAL_SUBQUERIES || stagnation || zeroCompletenessGiveUp) {
            thoughtProcess.hardStopReason = totalSubqueriesRun >= MAX_TOTAL_SUBQUERIES
              ? `Max total subqueries (${MAX_TOTAL_SUBQUERIES})`
              : zeroCompletenessGiveUp
                ? 'No evidence found (0% completeness)'
                : 'No new claims (stagnation)';
            log('hard-stop', { reason: thoughtProcess.hardStopReason });
            if (INCLUDE_FILL_STATUS_BY_SLOT && fillStatusBySlot) {
              const missing = Object.entries(fillStatusBySlot).filter(([, v]) => v === 'missing' || v === 'partial').map(([k, v]) => `${k} (${v})`);
              if (missing.length) {
                thoughtProcess.partialAnswerNote = completeness === 0
                  ? 'No evidence found for the requested slots.'
                  : `Answered with partial completeness; missing or partial: ${missing.join(', ')}`;
              }
            }
            if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
            const lastCompleteness = thoughtProcess.steps[thoughtProcess.steps.length - 1]?.completeness ?? 0;
            if (dynamicMode && sourceIds.length > 0) {
              thoughtProcess.expandCorpusReason = thoughtProcess.hardStopReason + '; suggesting a page to add.';
              await emit({ thoughtProcess: { ...thoughtProcess } });
              const suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMessage.trim(), subqueryTexts.slice(0, 3));
              if (suggestedPage) log('expand-suggested-on-stagnation', { url: suggestedPage.url });
              const stagnationModelMessage = (lastExtractResult?.final_answer ?? lastExtractResult?.why ?? '').trim();
              const stubContent = stagnationModelMessage.length > 0
                ? stagnationModelMessage
                : suggestedPage
                  ? "I didn't find any evidence in the current sources for that. Consider adding the suggested page below, then ask again."
                  : "I didn't find any evidence in the current sources for that. You could try adding more sources or rephrasing.";
              const { data: stubMsg, error: stubErr } = await supabase
                .from('messages')
                .insert({
                  conversation_id: conversationId,
                  role: 'assistant',
                  content: stubContent,
                  owner_id: ownerId,
                  suggested_page: suggestedPage ?? undefined,
                  thought_process: { ...thoughtProcess, expandCorpusReason: thoughtProcess.expandCorpusReason },
                })
                .select('*')
                .single();
              if (stubErr || !stubMsg) {
                await emit({ error: stubErr?.message ?? 'Failed to save stub message' });
                return;
              }
              await emit({ done: true, message: stubMsg, quotes: [], suggestedPage: suggestedPage ?? undefined, thoughtProcess });
              return;
            }
            const noEvidenceMessage = "I didn't find any evidence in the current sources for that. You could try adding more sources or rephrasing.";
            finalAnswer = (lastCompleteness > 0 && (lastExtractResult?.final_answer ?? '').trim().length > 0)
              ? lastExtractResult!.final_answer
              : noEvidenceMessage;
            done = true;
            break;
          }
        }
      }

      if (!done && iteration >= MAX_ITERATIONS) {
        thoughtProcess.hardStopReason = `Max iterations (${MAX_ITERATIONS})`;
        log('hard-stop', { reason: thoughtProcess.hardStopReason });
        const lastStep = thoughtProcess.steps[thoughtProcess.steps.length - 1];
        const fillStatus = lastStep?.fillStatusBySlot;
        const lastCompletenessForNote = lastStep?.completeness ?? 0;
        if (INCLUDE_FILL_STATUS_BY_SLOT && fillStatus) {
          const missing = Object.entries(fillStatus).filter(([, v]) => v === 'missing' || v === 'partial').map(([k, v]) => `${k} (${v})`);
          if (missing.length) {
            thoughtProcess.partialAnswerNote = lastCompletenessForNote === 0
              ? 'No evidence found for the requested slots.'
              : `Answered with partial completeness; missing or partial: ${missing.join(', ')}`;
          }
        }
        if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
        const lastCompleteness = lastStep?.completeness ?? 0;
        const noEvidenceMessage = "I didn't find any evidence in the current sources for that. You could try adding more sources or rephrasing.";
        finalAnswer = (lastCompleteness === 0 || (lastExtractResult?.final_answer ?? '').trim().length === 0)
          ? noEvidenceMessage
          : (lastExtractResult?.final_answer ?? "I've reached the iteration limit. Here's the best answer I can give from the evidence so far.");
      }

      if (finalAnswer != null && finalAnswer.length > 0) {
        const { content, quoteIdsOrdered: ordered } = replaceCitationPlaceholders(finalAnswer, validQuoteIds);
        quoteIdsOrdered = ordered;

        const { data: assistantRow, error: msgErr } = await supabase
          .from('messages')
          .insert({
            conversation_id: conversationId,
            role: 'assistant',
            content,
            owner_id: ownerId,
            was_multi_step: iteration > 1,
            follows_message_id: appendToMessageId ?? null,
            scraped_page_display: scrapedPageDisplay ?? null,
            thought_process: {
              ...thoughtProcess,
              iterationCount: iteration,
              completeness: thoughtProcess.steps[thoughtProcess.steps.length - 1]?.completeness,
              ...(extractionGapsAccumulated.length > 0 ? { extractionGaps: extractionGapsAccumulated } : {}),
              ...(thoughtProcess.partialAnswerNote ? { partialAnswerNote: thoughtProcess.partialAnswerNote } : {}),
            },
          })
          .select('*')
          .single();

        if (msgErr || !assistantRow) {
          await emit({ error: msgErr?.message ?? 'Failed to save assistant message' });
          return;
        }

        if (appendToMessageId) {
          await supabase.from('messages').update({ suggested_page: null }).eq('id', appendToMessageId);
        }

        if (quoteIdsOrdered.length > 0) {
          await attachQuotesToMessage(supabase, assistantRow.id, quoteIdsOrdered);
          // Apply model-cited verbatim snippets (like pre–Unfold v2) so the displayed quote is the exact passage the model cited
          const citedSnippets = lastExtractResult?.cited_snippets;
          if (citedSnippets && typeof citedSnippets === 'object') {
            for (const quoteId of quoteIdsOrdered) {
              const snippet = citedSnippets[quoteId];
              if (typeof snippet === 'string' && snippet.trim().length > 0) {
                await supabase.from('quotes').update({ snippet: snippet.trim() }).eq('id', quoteId);
              }
            }
          }
        }

        const quotedPageIds = await (async () => {
          const { data: qlist } = await supabase.from('quotes').select('page_id').eq('message_id', assistantRow.id);
          return [...new Set((qlist ?? []).map((q: { page_id: string }) => q.page_id))];
        })();
        const { data: pagesWithContent = [] } = await supabase.from('pages').select('id, content').in('id', quotedPageIds);
        const pageContentById = new Map((pagesWithContent as { id: string; content: string | null }[]).map((p) => [p.id, p.content ?? '']));
        const { data: quoteRows } = await supabase
          .from('quotes')
          .select('id, page_id, snippet, page_title, page_path, domain, page_url, context_before, context_after')
          .eq('message_id', assistantRow.id)
          .order('citation_order', { ascending: true });
        const quoteRowsList = (quoteRows ?? []) as { id: string; page_id: string; snippet: string }[];
        for (const q of quoteRowsList) {
          const pageContent = pageContentById.get(q.page_id);
          if (pageContent) {
            await updateQuoteContextFromPage(supabase, q.id, q.snippet, pageContent);
          }
        }
        const quotesForOut = quoteRowsList.map((q) => ({ snippet: q.snippet, pageId: q.page_id }));
        const quotesOut = buildQuotesOut(conversationId, quotesForOut, pageById, sourceById, pageContentById);

        const isFirstMessage = !appendToMessageId && (await getLastMessages(supabase, conversationId)).length <= 1;
        let suggestedTitle: string | undefined;
        if (isFirstMessage) {
          const titleRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
              model: 'gpt-4o-mini',
      messages: [
                { role: 'user', content: `Suggest a 3-6 word title for this conversation. Reply with only the title, no quotes.\n\nUser: ${userMessage.trim().slice(0, 200)}` },
      ],
              max_tokens: 20,
    }),
  });
          if (titleRes.ok) {
            const j = (await titleRes.json()) as { choices?: { message?: { content?: string } }[] };
            const t = j.choices?.[0]?.message?.content?.trim().slice(0, 80);
            if (t) {
              suggestedTitle = t;
              await supabase.from('conversations').update({ title: suggestedTitle }).eq('id', conversationId);
            }
          }
        }

        log('answer-done', { iteration, completeness: thoughtProcess.completeness });
        await emit({
          done: true,
          message: assistantRow,
          quotes: quotesOut,
          thoughtProcess: {
            ...thoughtProcess,
            iterationCount: iteration,
            ...(extractionGapsAccumulated.length > 0 ? { extractionGaps: extractionGapsAccumulated } : {}),
            ...(thoughtProcess.partialAnswerNote ? { partialAnswerNote: thoughtProcess.partialAnswerNote } : {}),
          },
          ...(suggestedTitle ? { suggestedTitle } : {}),
        });
      }
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
