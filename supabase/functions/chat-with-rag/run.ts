/**
 * RAG orchestration: load context, run plan+loop, handle clarify/expand_corpus, finalize answer.
 */
/// <reference path="./deno_types.d.ts" />
import type { SupabaseClient } from 'supabase';
import { createClient } from 'supabase';
import type { PlanResult, PlanSlot } from './types.ts';
import type { RagContextReady, SlotDb, StepDb } from './types.ts';
import { loadRagContext, type LoadRagBody } from './context.ts';
import { insertNoPagesMessage, insertClarifyMessage, insertExpandCorpusMessage, insertRetrieveHardStopMessage } from './actions.ts';
import { saveAssistantMessageWithQuotes, suggestConversationTitle } from './finalize.ts';
import {
  MAX_ITERATIONS,
  MAX_SUBQUERIES_PER_ITER,
  MAX_TOTAL_SUBQUERIES,
  MAX_EXPANSIONS,
  STAGNATION_THRESHOLD,
  INCLUDE_FILL_STATUS_BY_SLOT,
} from './config.ts';
import type { PageRow, SourceRow } from './types.ts';
import { callPlan } from './plan.ts';
import { callExtractAndDecide, insertClaims } from './loop.ts';
import type { SlotRow, EvidenceChunk } from './loop.ts';
import { doRetrieve } from './retrieve.ts';
import { getEvidenceChunksForFinalAnswer, callFinalAnswer } from './finalAnswer.ts';
import { slotCompleteness, overallCompleteness } from './completeness.ts';
import type { SlotForCompleteness, SlotCompletenessMeta } from './completeness.ts';
import { doExpandCorpus, getTopSuggestedPages, type SuggestedPage } from './expand.ts';
import { getLastMessages } from './chat.ts';

export type Emit = (obj: unknown) => Promise<void>;
export type Log = (phase: string, detail?: Record<string, unknown>) => void;

export async function runRag(req: Request, emit: Emit, log: Log): Promise<void> {
  log('start');
  const body = (await req.json()) as LoadRagBody & { rootMessageId?: string };
  const { conversationId, userMessage, rootMessageId: bodyRootMessageId, appendToMessageId, scrapedPageDisplay } = body;

  if (!conversationId || !userMessage?.trim()) {
    log('error', { reason: 'conversationId and userMessage required' });
    await emit({ error: 'conversationId and userMessage required' });
    return;
  }

  const openaiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiKey) {
    await emit({ error: 'OPENAI_API_KEY secret not configured' });
    return;
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const authHeader = req.headers.get('Authorization');
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: authHeader ? { Authorization: authHeader } : {} },
  }) as SupabaseClient;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    await emit({ error: 'Authentication required' });
    return;
  }

  const ctx = await loadRagContext(supabase, body, user.id);
  if (ctx.kind === 'error') {
    await emit({ error: ctx.error });
    return;
  }
  if (ctx.kind === 'noPages') {
    log('no-pages', {});
    const { data: msg, error: insertErr } = await insertNoPagesMessage(supabase, ctx.conversationId, ctx.ownerId, ctx.content);
    if (insertErr || !msg) {
      await emit({ error: insertErr?.message ?? 'Failed to save message' });
      return;
    }
    await emit({ done: true, message: msg, quotes: [] });
    return;
  }

  const c = ctx as RagContextReady;
  const {
    conversationId: convId,
    ownerId,
    userMessage: userMsg,
    dynamicMode,
    suggestedPageCandidates,
    sourceIds,
    pages,
    pageIds,
    pageById,
    sourceById,
    sourceDomainByPageId,
    leadChunks: leadList,
    rootMessageId,
    slots: initialSlots,
    slotIdByName: initialSlotIdByName,
    planResult: initialPlanResult,
    expansionCount,
    appendToMessageId: appendId,
    scrapedPageDisplay: scrapedDisplay,
  } = c;

  let slots: SlotDb[] = initialSlots;
  let slotIdByName = initialSlotIdByName;
  let planResult: PlanResult | null = initialPlanResult;

  if (!planResult) {
    log('plan-call');
    planResult = await callPlan(openaiKey, userMsg);
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
      target_item_count: s.type === 'list' ? (s.target_item_count ?? 0) : 0,
    }));
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
    slots = (await supabase.from('slots').select('id, name, type, description, required, depends_on_slot_id, target_item_count, current_item_count, attempt_count, finished_querying, last_queries').eq('root_message_id', rootMessageId)).data as SlotDb[] ?? [];
    for (const s of slots) {
      const planSlot = planResult.slots.find((p) => p.name === s.name);
      if (s.type === 'mapping' && s.depends_on_slot_id && planSlot?.items_per_key) {
        const depSlot = slots.find((d) => d.id === s.depends_on_slot_id);
        const depTarget = depSlot?.target_item_count ?? 0;
        await supabase.from('slots').update({ target_item_count: depTarget * planSlot.items_per_key }).eq('id', s.id);
      }
    }
    slots = (await supabase.from('slots').select('id, name, type, description, required, depends_on_slot_id, target_item_count, current_item_count, attempt_count, finished_querying, last_queries').eq('root_message_id', rootMessageId)).data as SlotDb[] ?? [];
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
        const o: { name: string; type: string; description?: string; dependsOn?: string } = { name: s.name, type: s.type };
        if (s.description) o.description = s.description;
        if (s.dependsOn) o.dependsOn = s.dependsOn;
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
    ...((s.type === 'list' || s.type === 'mapping') && s.target_item_count != null ? { target_item_count: s.target_item_count } : {}),
  }));

  let totalSubqueriesRun = 0;
  let iteration = 0;
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
    statements?: string[];
    nextAction?: string;
  };
  let thoughtProcess: {
    slots: { name: string; type: string; description?: string; dependsOn?: string }[];
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
      const o: { name: string; type: string; description?: string; dependsOn?: string } = { name: s.name, type: s.type };
      if (s.description) o.description = s.description;
      if (s.dependsOn) o.dependsOn = s.dependsOn;
      return o;
    }),
    planReason: appendId ? 'Same question, with the new page in the corpus.' : (planResult?.why ?? undefined),
    steps: [],
  };

  const getSlotItemCountBySlotId = async (): Promise<Map<string, number>> => {
    const { data: items } = await supabase.from('slot_items').select('slot_id').in('slot_id', slots.map((s) => s.id));
    const countBySlot = new Map<string, number>();
    for (const s of slots) countBySlot.set(s.id, 0);
    for (const row of (items ?? []) as { slot_id: string }[]) {
      countBySlot.set(row.slot_id, (countBySlot.get(row.slot_id) ?? 0) + 1);
    }
    return countBySlot;
  };

  const slotsWithAttempts = slots.filter((s) => s.type === 'list' || s.type === 'mapping');

  /** Structured slot state for extraction: slot name -> { type, items }. Enables reliable parsing and mapping-key awareness. */
  const getCurrentSlotItemsState = async (): Promise<Record<string, { type: string; items: { key?: string | null; value: unknown }[] }>> => {
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
    const state: Record<string, { type: string; items: { key?: string | null; value: unknown }[] }> = {};
    for (const slot of slots) {
      const list = bySlot.get(slot.id) ?? [];
      state[slot.name] = {
        type: slot.type,
        items: list.map((x) => (x.key != null ? { key: x.key, value: x.value } : { value: x.value })),
      };
    }
    return state;
  };

  let prevSlotItemCount = 0;
  let done = false;
  let finalAnswer: string | undefined;
  /** Chunk ids to allow in quotes when saving the final answer (from fairly-allocated evidence passed to final-answer step). */
  let validQuoteIdsForSave = new Set<string>();
  // All evidence chunks seen across iterations, keyed by chunk id
  const evidenceChunksById = new Map<string, string>();
  let lastExtractResult: { next_action?: string; why?: string; final_answer?: string; subqueries?: { slot: string; query: string }[]; extractionGaps?: string[]; cited_snippets?: Record<string, string> } | null = null;
  const extractionGapsAccumulated: string[] = [];
  let slotItemCountBySlotId = new Map<string, number>();

  const produceFinalAnswer = async (): Promise<{ finalAnswer: string; cited_snippets: Record<string, string>; validQuoteIds: Set<string> }> => {
    const evidenceForFinal = await getEvidenceChunksForFinalAnswer(supabase, slots.map((s) => s.id), evidenceChunksById);
    const currentSlotState = await getCurrentSlotItemsState();
    const currentSlotStateJson = Object.keys(currentSlotState).length > 0 ? JSON.stringify(currentSlotState, null, 2) : '{}';
    const result = await callFinalAnswer(openaiKey, userMsg, currentSlotStateJson, evidenceForFinal);
    return {
      finalAnswer: result.final_answer,
      cited_snippets: result.cited_snippets,
      validQuoteIds: new Set(evidenceForFinal.map((c) => c.id)),
    };
  };

  if (thoughtProcess.slots.length > 0) {
    await emit({ thoughtProcess: { ...thoughtProcess } });
  }

  while (!done && iteration < MAX_ITERATIONS) {
    iteration++;
    slotItemCountBySlotId = await getSlotItemCountBySlotId();

    const stepList = (await supabase
      .from('reasoning_steps')
      .select('id, iteration_number, action')
      .eq('root_message_id', rootMessageId)
      .order('iteration_number', { ascending: true })).data as StepDb[] ?? [];
    const retrieveStep = stepList.find((s) => s.action === 'retrieve' && s.iteration_number === iteration);
    let currentStepId: string;
    type SubqWithSlot = { slotId: string; query: string };
    let subqueriesWithSlot: SubqWithSlot[] = [];

    if (retrieveStep) {
      // Iteration 1: use plan subqueries; gate by dependency and finished_querying
      currentStepId = retrieveStep.id;
      const { data: sq } = await supabase.from('reasoning_subqueries').select('query_text, slot_id').eq('reasoning_step_id', currentStepId);
      const sqRows = (sq ?? []) as { query_text: string; slot_id: string }[];
      subqueriesWithSlot = sqRows
        .filter((r) => r.query_text && r.slot_id)
        .map((r) => ({ slotId: r.slot_id, query: r.query_text }))
        .filter((sq) => {
          const slot = slots.find((s) => s.id === sq.slotId);
          if (!slot || slot.finished_querying) return false;
          const count = slotItemCountBySlotId.get(slot.id) ?? 0;
          if (slot.type === 'scalar' && count >= 1) return false;
          if ((slot.type === 'list' || slot.type === 'mapping') && slot.target_item_count > 0 && count >= slot.target_item_count) return false;
          if (!slot.depends_on_slot_id) return true;
          return (slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0) >= 1;
        });
    } else {
      // Iteration 2+: gate subqueries by dependency — only run for slot B when its depends_on slot A has ≥1 item
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
        : [{ slot: 'answer', query: userMsg.slice(0, 200) }];
      // Iteration 2+: gate by dependency, finished_querying, scalar-already-filled, list-at-target
      const nextSubsFiltered = nextSubs.filter((q) => {
        const sid = slotIdByName.get(q.slot);
        if (!sid) return false;
        const slot = slots.find((s) => s.id === sid);
        if (!slot || slot.finished_querying) return false;
        const count = slotItemCountBySlotId.get(slot.id) ?? 0;
        if (slot.type === 'scalar' && count >= 1) return false;
        if ((slot.type === 'list' || slot.type === 'mapping') && slot.target_item_count > 0 && count >= slot.target_item_count) return false;
        if (!slot.depends_on_slot_id) return true;
        return (slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0) >= 1;
      });
      const capped = nextSubsFiltered.slice(0, MAX_SUBQUERIES_PER_ITER);
      for (const q of capped) {
        const sid = slotIdByName.get(q.slot);
        if (!sid) continue;
        const slot = slots.find((s) => s.id === sid);
        const strategy: 'broad' | 'targeted' | null =
          slot && (slot.type === 'list' || slot.type === 'mapping') ? (slot.attempt_count > 0 ? 'targeted' : 'broad') : null;
        await supabase.from('reasoning_subqueries').insert({
          reasoning_step_id: currentStepId,
          slot_id: sid,
          owner_id: ownerId,
          query_text: q.query,
          ...(strategy ? { strategy } : {}),
        });
      }
      const { data: sq } = await supabase.from('reasoning_subqueries').select('query_text, slot_id').eq('reasoning_step_id', currentStepId);
      const sqRows = (sq ?? []) as { query_text: string; slot_id: string }[];
      subqueriesWithSlot = sqRows.filter((r) => r.query_text && r.slot_id).map((r) => ({ slotId: r.slot_id, query: r.query_text }));
    }

    // Avoid re-running identical (slot, query) from previous iterations only (exclude current step)
    const previousStepIds = stepList.filter((s) => s.iteration_number < iteration).map((s) => s.id);
    const seen = new Set<string>();
    if (previousStepIds.length > 0) {
      const { data: allPrevSubq } = await supabase
        .from('reasoning_subqueries')
        .select('slot_id, query_text')
        .in('reasoning_step_id', previousStepIds);
      for (const row of (allPrevSubq ?? []) as { slot_id: string; query_text: string }[]) {
        seen.add(`${row.slot_id}::${row.query_text}`);
      }
    }

    const subqueriesToRun = subqueriesWithSlot
      .filter((sq) => sq.query && !seen.has(`${sq.slotId}::${sq.query}`))
      .slice(0, Math.min(MAX_SUBQUERIES_PER_ITER, MAX_TOTAL_SUBQUERIES - totalSubqueriesRun))
      .map((sq) => sq.query);
    if (subqueriesToRun.length === 0) break;

    totalSubqueriesRun += subqueriesToRun.length;

    log('retrieve-start', { iteration, subqueryCount: subqueriesToRun.length });
    const { chunks: retrievedChunks, chunksPerSubquery } = await doRetrieve(
      supabase,
      openaiKey,
      pageIds,
      subqueriesToRun,
    );
    log('retrieve-done', { chunksRetrieved: retrievedChunks.length, chunksPerSubquery });

    // Accumulate evidence chunks across iterations (by chunk id)
    for (const chunk of retrievedChunks) {
      const snippet = (chunk.content ?? '').trim();
      if (!snippet) continue;
      evidenceChunksById.set(chunk.id, snippet);
    }

    const evidenceChunksForExtract: EvidenceChunk[] = Array.from(evidenceChunksById.entries()).map(([id, snippet]) => ({
      id,
      snippet,
    }));

    const currentSlotState = await getCurrentSlotItemsState();
    const currentSlotStateJson = Object.keys(currentSlotState).length > 0 ? JSON.stringify(currentSlotState, null, 2) : '';
    const previousAttemptsBySlot = (() => {
      const lines: string[] = [];
      for (const slot of slotsWithAttempts) {
        if (slot.finished_querying || slot.attempt_count === 0 || !slot.last_queries?.length) continue;
        const items = currentSlotState[slot.name]?.items ?? [];
        const itemsPreview = items.length <= 5
          ? JSON.stringify(items.map((i) => i.value ?? i.key ?? i))
          : `${items.length} items (e.g. ${JSON.stringify(items.slice(0, 2).map((i) => i.value ?? i.key ?? i))}...)`;
        lines.push(`Slot "${slot.name}": last queries were [${slot.last_queries.map((q) => `"${q}"`).join(', ')}]. Items now: ${itemsPreview}. Try different queries.`);
      }
      return lines.length > 0 ? lines.join('\n') : undefined;
    })();
    const broadSlotNamesThisStep = [...new Set(subqueriesWithSlot.map((sq) => slots.find((s) => s.id === sq.slotId)).filter((s): s is NonNullable<typeof s> => !!s && (s.type === 'list' || s.type === 'mapping') && s.attempt_count === 0).map((s) => s.name))];
    const finishedQueryingSlotNames = slots.filter((s) => s.finished_querying).map((s) => s.name);
    const topSuggestedPages: SuggestedPage[] | null =
      dynamicMode && sourceIds.length > 0
        ? await getTopSuggestedPages(supabase, openaiKey, sourceIds, userMsg, subqueriesToRun.slice(0, 3), suggestedPageCandidates)
        : null;
    log('extract-call', { iteration, chunkCount: evidenceChunksForExtract.length, topSuggestedCount: topSuggestedPages?.length ?? 0 });
    const snippetPreviews = evidenceChunksForExtract.map((q) => (q.snippet ?? '').slice(0, 120));
    log('extract-evidence-preview', { iteration, snippetPreviews });
    const extractResult = await callExtractAndDecide(
      openaiKey,
      slotRowsForExtract,
      evidenceChunksForExtract,
      currentSlotStateJson,
      userMsg,
      dynamicMode,
      topSuggestedPages,
      previousAttemptsBySlot,
      broadSlotNamesThisStep,
      finishedQueryingSlotNames,
    );
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

    const allowedKeysByMappingSlotId = await (async (): Promise<Map<string, Set<string>>> => {
      const map = new Map<string, Set<string>>();
      const mappingSlots = slots.filter((s) => s.type === 'mapping' && s.depends_on_slot_id);
      if (mappingSlots.length === 0) return map;
      const parentIds = [...new Set(mappingSlots.map((s) => s.depends_on_slot_id!))];
      const { data: parentItems } = await supabase
        .from('slot_items')
        .select('slot_id, value_json')
        .in('slot_id', parentIds);
      const keysByParentId = new Map<string, Set<string>>();
      for (const row of (parentItems ?? []) as { slot_id: string; value_json: unknown }[]) {
        const key = String(row.value_json != null && typeof row.value_json === 'object' ? JSON.stringify(row.value_json) : row.value_json);
        let set = keysByParentId.get(row.slot_id);
        if (!set) {
          set = new Set();
          keysByParentId.set(row.slot_id, set);
        }
        set.add(key);
      }
      for (const slot of mappingSlots) {
        const keys = keysByParentId.get(slot.depends_on_slot_id!);
        if (keys?.size) map.set(slot.id, keys);
      }
      return map;
    })();
    await insertClaims(supabase, {
      slotIdByName,
      slots,
      claims: extractResult.claims,
      ownerId,
      allowedKeysByMappingSlotId,
    });

    slotItemCountBySlotId = await getSlotItemCountBySlotId();
    const thisStepQueriesBySlotId = new Map<string, string[]>();
    for (const { slotId, query } of subqueriesWithSlot) {
      const arr = thisStepQueriesBySlotId.get(slotId) ?? [];
      arr.push(query);
      thisStepQueriesBySlotId.set(slotId, arr);
    }
    const prevItemCountBySlotId = new Map(slotsWithAttempts.map((s) => [s.id, s.current_item_count]));
    for (const slot of slotsWithAttempts) {
      const currentCount = slotItemCountBySlotId.get(slot.id) ?? 0;
      const hadSubqueriesThisStep = thisStepQueriesBySlotId.has(slot.id);
      slot.current_item_count = currentCount;
      if (hadSubqueriesThisStep) {
        slot.attempt_count += 1;
        slot.last_queries = thisStepQueriesBySlotId.get(slot.id) ?? slot.last_queries ?? [];
        if ((extractResult.broad_query_completed_slot_fully ?? []).includes(slot.name)) slot.finished_querying = true;
        const prevCount = prevItemCountBySlotId.get(slot.id) ?? 0;
        if (currentCount === prevCount) slot.finished_querying = true;
      }
    }
    for (const slot of slotsWithAttempts) {
      await supabase
        .from('slots')
        .update({
          current_item_count: slot.current_item_count,
          attempt_count: slot.attempt_count,
          finished_querying: slot.finished_querying,
          last_queries: slot.last_queries ?? [],
        })
        .eq('id', slot.id);
    }
    // Strip subqueries for slots that just became finished (broad_query_completed_slot_fully or stagnation)
    // so we never run or persist them; the prompt didn't know they were finished yet.
    const nowFinishedNames = new Set(slots.filter((s) => s.finished_querying).map((s) => s.name));
    if (lastExtractResult?.subqueries?.length && nowFinishedNames.size > 0) {
      lastExtractResult.subqueries = lastExtractResult.subqueries.filter((q) => !nowFinishedNames.has(q.slot));
    }
    const slotMetaBySlotId = new Map<string, SlotCompletenessMeta>(
      slots.map((s) => [s.id, { target_item_count: s.target_item_count, finished_querying: s.finished_querying }]),
    );
    const slotsForCompleteness: SlotForCompleteness[] = slots.map((s) => ({
      id: s.id,
      type: s.type as SlotForCompleteness['type'],
      required: s.required,
      depends_on_slot_id: s.depends_on_slot_id ?? null,
    }));
    const completeness = overallCompleteness(slotsForCompleteness, slotItemCountBySlotId, slotMetaBySlotId);

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
          slotMetaBySlotId,
        );
        const count = slotItemCountBySlotId.get(slot.id) ?? 0;
        fillStatusBySlot[slot.name] = score >= 1 ? 'filled' : count > 0 ? 'partial' : 'missing';
      }
    }

    const subqueriesForStep = subqueriesWithSlot.length
      ? subqueriesWithSlot.map((sq) => ({ slot: slots.find((s) => s.id === sq.slotId)?.name ?? '', query: sq.query }))
      : subqueriesToRun.map((q) => ({ slot: '', query: q }));
    const stepStatements: string[] = [];
    stepStatements.push(`Retrieved ${retrievedChunks.length} chunks from this step.`);
    stepStatements.push(extractResult.why ?? 'Extract');
    stepStatements.push(`Achieved ${Math.round((completeness ?? 0) * 100)}% completeness.`);
    if (INCLUDE_FILL_STATUS_BY_SLOT && fillStatusBySlot && Object.keys(fillStatusBySlot).length > 0) {
      stepStatements.push(`Fill: ${Object.entries(fillStatusBySlot).map(([k, v]) => `${k}=${v}`).join(', ')}.`);
    }
    const listSlotDebug: Record<string, { attempts: number; count: number; strategy: string; finished_querying: boolean }> = {};
    for (const slot of slotsWithAttempts) {
      const count = slotItemCountBySlotId.get(slot.id) ?? 0;
      listSlotDebug[slot.name] = {
        attempts: slot.attempt_count,
        count,
        strategy: slot.attempt_count > 0 ? 'targeted' : 'broad',
        finished_querying: slot.finished_querying,
      };
    }

    const stepEntry: ThoughtStep = {
      iter: iteration,
      action: 'retrieve',
      why: extractResult.why,
      subqueries: subqueriesForStep,
      chunksPerSubquery: chunksPerSubquery?.length ? chunksPerSubquery : undefined,
      quotesFound: retrievedChunks.length,
      claims: extractResult.claims,
      completeness,
      fillStatusBySlot: INCLUDE_FILL_STATUS_BY_SLOT ? fillStatusBySlot : undefined,
      statements: stepStatements,
      nextAction: extractResult.next_action,
      ...(Object.keys(listSlotDebug).length > 0 ? { listSlotState: listSlotDebug } : {}),
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
      quotesFound: retrievedChunks.length,
      claims: extractResult.claims,
      completeness,
      fillStatusBySlot: INCLUDE_FILL_STATUS_BY_SLOT ? fillStatusBySlot : undefined,
    });

    const currentSlotItemCount = Array.from(slotItemCountBySlotId.values()).reduce((a, b) => a + b, 0);
    const stagnation = iteration > 1 && (currentSlotItemCount - prevSlotItemCount) <= STAGNATION_THRESHOLD;
    const zeroCompletenessGiveUp = completeness === 0 && iteration >= 1;
    prevSlotItemCount = currentSlotItemCount;

    if (extractResult.next_action === 'answer') {
      const finalResult = await produceFinalAnswer();
      finalAnswer = finalResult.finalAnswer;
      lastExtractResult = { ...extractResult, cited_snippets: finalResult.cited_snippets };
      validQuoteIdsForSave = finalResult.validQuoteIds;
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
      const { data: clarifyMsg, error: clarifyErr } = await insertClarifyMessage(supabase, convId, ownerId, content, thoughtProcess, questions);
      if (!clarifyErr && clarifyMsg) {
        await emit({ clarify: true, questions: Array.isArray(questions) ? questions : [content] });
        await emit({ done: true, message: clarifyMsg, quotes: [] });
      } else {
        await emit({ error: clarifyErr?.message ?? 'Failed to save clarify message' });
      }
      return;
    }

    if (extractResult.next_action === 'expand_corpus') {
      const dependentSlotsToFill = slots.filter((s) => {
        if (!s.depends_on_slot_id) return false;
        const parentCount = slotItemCountBySlotId.get(s.depends_on_slot_id) ?? 0;
        const myCount = slotItemCountBySlotId.get(s.id) ?? 0;
        if (parentCount === 0) return false;
        if (s.type === 'mapping') return myCount < parentCount;
        return myCount < 1;
      });
      if (dependentSlotsToFill.length > 0) {
        const fallbackSubqueries = dependentSlotsToFill.map((s) => ({
          slot: s.name,
          query: (s.description ?? '').trim() || `${s.name} from evidence`,
        }));
        lastExtractResult = { ...extractResult, next_action: 'retrieve', subqueries: fallbackSubqueries };
        (extractResult as { next_action: string; subqueries?: { slot: string; query: string }[] }).next_action = 'retrieve';
        (extractResult as { next_action: string; subqueries?: { slot: string; query: string }[] }).subqueries = fallbackSubqueries;
        log('expand_corpus-override-retrieve', { reason: 'dependent_slots_not_filled', slots: dependentSlotsToFill.map((s) => s.name) });
      }
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
        const finalResult = await produceFinalAnswer();
        finalAnswer = finalResult.finalAnswer;
        lastExtractResult = { ...extractResult, cited_snippets: finalResult.cited_snippets };
        validQuoteIdsForSave = finalResult.validQuoteIds;
        done = true;
        break;
      }
      let suggestedPage: SuggestedPage | null = null;
      if (dynamicMode && sourceIds.length > 0) {
        if (topSuggestedPages && topSuggestedPages.length > 0) {
          const idx = extractResult.suggested_page_index;
          const oneBased = typeof idx === 'number' && idx >= 1 && idx <= topSuggestedPages.length ? idx : 1;
          suggestedPage = topSuggestedPages[oneBased - 1];
        } else {
          suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, subqueriesToRun.slice(0, 3));
        }
        if (suggestedPage) log('expand-suggested', { url: suggestedPage.url });
      }
      thoughtProcess.expandCorpusReason = extractResult.why;
      if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
      await emit({ thoughtProcess: { ...thoughtProcess } });
      const stubContent = suggestedPage
        ? "Consider adding the suggested page below, then I can answer with the full picture."
        : "I couldn't find enough in the current pages. Add more sources if you have them.";
      const { data: stubMsg, error: stubErr } = await insertExpandCorpusMessage(
        supabase,
        convId,
        ownerId,
        stubContent,
        thoughtProcess,
        extractResult.why,
        suggestedPage,
      );
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
              ? (thoughtProcess.hardStopReason === 'No evidence found (0% completeness)' ? undefined : 'No evidence found for the requested slots.')
              : `Answered with partial completeness; missing or partial: ${missing.join(', ')}`;
          }
        }
        if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
        const lastCompleteness = thoughtProcess.steps[thoughtProcess.steps.length - 1]?.completeness ?? 0;
        if (dynamicMode && sourceIds.length > 0) {
          thoughtProcess.expandCorpusReason = thoughtProcess.hardStopReason === 'No evidence found (0% completeness)'
            ? 'Suggesting a page to add.'
            : thoughtProcess.hardStopReason + '; suggesting a page to add.';
          await emit({ thoughtProcess: { ...thoughtProcess } });
          const suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, subqueriesToRun.slice(0, 3));
          if (suggestedPage) log('expand-suggested-on-stagnation', { url: suggestedPage.url });
          const stagnationModelMessage = (lastExtractResult?.why ?? '').trim();
          const stubContent = stagnationModelMessage.length > 0
            ? stagnationModelMessage
            : suggestedPage
              ? "I didn't find any evidence in the current sources for that. Consider adding the suggested page below, then ask again."
              : "I didn't find any evidence in the current sources for that. You could try adding more sources or rephrasing.";
          const { data: stubMsg, error: stubErr } = await insertRetrieveHardStopMessage(
            supabase,
            convId,
            ownerId,
            stubContent,
            thoughtProcess,
            suggestedPage,
          );
          if (stubErr || !stubMsg) {
            await emit({ error: stubErr?.message ?? 'Failed to save stub message' });
            return;
          }
          await emit({ done: true, message: stubMsg, quotes: [], suggestedPage: suggestedPage ?? undefined, thoughtProcess });
          return;
        }
        const noEvidenceMessage = "I didn't find any evidence in the current sources for that. You could try adding more sources or rephrasing.";
        const finalResult = await produceFinalAnswer();
        finalAnswer = lastCompleteness > 0 ? finalResult.finalAnswer : noEvidenceMessage;
        lastExtractResult = { ...lastExtractResult, cited_snippets: finalResult.cited_snippets };
        validQuoteIdsForSave = finalResult.validQuoteIds;
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
    const finalResult = await produceFinalAnswer();
    finalAnswer = lastCompleteness === 0 ? noEvidenceMessage : finalResult.finalAnswer;
    lastExtractResult = { ...lastExtractResult, cited_snippets: finalResult.cited_snippets };
    validQuoteIdsForSave = finalResult.validQuoteIds;
  }

  if (finalAnswer != null && finalAnswer.length > 0) {
    const { message: assistantRow, quotesOut } = await saveAssistantMessageWithQuotes({
      supabase,
      conversationId: convId,
      ownerId,
      finalAnswer,
      validQuoteIds: validQuoteIdsForSave.size > 0 ? validQuoteIdsForSave : new Set(evidenceChunksById.keys()),
      lastExtractResult,
      thoughtProcess,
      extractionGapsAccumulated,
      iteration,
      appendToMessageId: appendId,
      scrapedPageDisplay: scrapedDisplay,
      pageById,
      sourceById,
    });

    const isFirstMessage = !appendId && (await getLastMessages(supabase, convId)).length <= 1;
    const suggestedTitle = await suggestConversationTitle(openaiKey, supabase, convId, userMsg, isFirstMessage);

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
}
