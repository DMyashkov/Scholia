
/// <reference path="./deno_types.d.ts" />
import type { SupabaseClient } from 'supabase';
import { createClient } from 'supabase';
import type { PlanResult, PlanSlot, ExtractSubquery } from './types.ts';
import type { RagContextReady, SlotDb, StepDb } from './types.ts';
import { loadRagContext, type LoadRagBody } from './context.ts';
import { insertNoPagesMessage, insertClarifyMessage, insertExpandCorpusMessage, insertRetrieveHardStopMessage } from './actions.ts';
import { saveAssistantMessageWithQuotes, suggestConversationTitle } from './finalize.ts';
import {
  MAX_ITERATIONS,
  MAX_SUBQUERIES_PER_ITER,
  MAX_TOTAL_SUBQUERIES,
  MAX_MAPPING_SUBQUERIES_PER_ITER,
  MAX_EXPANSIONS,
  INCLUDE_FILL_STATUS_BY_SLOT,
  EXTRACT_CHUNKS_CAP,
} from './config.ts';
import type { PageRow, SourceRow } from './types.ts';
import { callPlan } from './plan.ts';
import { callExtractAndDecide, insertClaims } from './loop.ts';
import type { SlotRow } from './loop.ts';
import type { EvidenceChunk } from './types.ts';
import { upsertEvidenceChunk } from './evidenceFormat.ts';
import { doRetrieve } from './retrieve.ts';
import { getEvidenceChunksForFinalAnswer, callFinalAnswer } from './finalAnswer.ts';
import { slotCompleteness, overallCompleteness } from './completeness.ts';
import type { SlotForCompleteness, SlotCompletenessMeta } from './completeness.ts';
import { doExpandCorpus, getTopSuggestedPages, type SuggestedPage } from './expand.ts';
import { getLastMessages } from './chat.ts';
import { buildCorpusContextBlock } from './corpusContext.ts';
import { slotValueDedupKey, splitListEntityValues } from './utils.ts';
import { inferCorpusLanguage } from './language.ts';
import {
  buildQueryGuidance,
  computeSlotFillState,
  countFilledBySlotId,
  anySlotHasGuidedWork,
  buildRecoverySubqueries,
  createSlotStagnationTrack,
  getEffectiveTarget,
  groupItemsBySlotId,
  inferSubqueryStrategy,
  prepareRunnableSubqueries,
  slotHasGuidedWorkRemaining,
  slotShouldBeFinishedQuerying,
  updateSlotStagnationTrack,
  type SlotQueryStrategy,
  type SlotStagnationTrack,
  updateParentFingerprints,
  type SlotFillStatus,
  type SlotItemRow,
} from './slotFillState.ts';

type FillMap = Map<string, SlotFillStatus>;

export type Emit = (obj: unknown) => Promise<void>;
export type Log = (phase: string, detail?: Record<string, unknown>) => void;

export type ThoughtSlotUi = {
  name: string;
  type: string;
  description?: string;
  dependsOn?: string;
  targetItemCount?: number;
  itemsPerKey?: number;
};

export type SlotFillRow = {
  name: string;
  type: string;
  target: number | null;
  filled: number;
};

export type SlotSnapshotState = Record<
  string,
  { type: string; items: { key?: string | null; value: unknown }[] }
>;

function buildThoughtSlots(slots: SlotDb[], planSlots?: PlanSlot[]): ThoughtSlotUi[] {
  const planByName = new Map((planSlots ?? []).map((p) => [p.name, p]));
  return slots.map((s) => {
    const plan = planByName.get(s.name);
    const depName = s.depends_on_slot_id
      ? slots.find((x) => x.id === s.depends_on_slot_id)?.name
      : plan?.dependsOn;
    const o: ThoughtSlotUi = { name: s.name, type: s.type };
    const desc = s.description ?? plan?.description;
    if (desc) o.description = desc;
    if (depName) o.dependsOn = depName;
    const target = s.target_item_count ?? plan?.target_item_count;
    if (target != null && target >= 0) o.targetItemCount = target;
    if (s.type === 'mapping') {
      const perKey = s.items_per_key ?? plan?.items_per_key ?? 0;
      if (perKey >= 0) o.itemsPerKey = perKey;
    }
    return o;
  });
}

function buildSlotFillSummary(
  slots: SlotDb[],
  slotItemCountBySlotId: Map<string, number>,
  slotsById?: Map<string, SlotDb>,
): SlotFillRow[] {
  const byId = slotsById ?? new Map(slots.map((s) => [s.id, s]));
  return slots.map((slot) => {
    const filled = slotItemCountBySlotId.get(slot.id) ?? 0;
    if (slot.type === 'scalar') {
      return { name: slot.name, type: slot.type, target: 1, filled: Math.min(filled, 1) };
    }
    const eff = getEffectiveTarget(slot, slotItemCountBySlotId, byId);
    const planTarget = slot.target_item_count ?? 0;
    const target = eff > 0 ? eff : (slot.type === 'list' && planTarget > 0 ? planTarget : null);
    return { name: slot.name, type: slot.type, target, filled };
  });
}

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

  try {
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
    const corpusContext = buildCorpusContextBlock({
      pages,
      sourceById,
      leadChunks: leadList,
    });
    const corpusLanguage = inferCorpusLanguage(corpusContext);
    planResult = await callPlan(openaiKey, userMsg, corpusContext, corpusLanguage);
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
      depends_on_slot_id: null as string | null,
      target_item_count: s.type === 'list' ? (s.target_item_count ?? 0) : 0,
      items_per_key: s.type === 'mapping' ? (s.items_per_key ?? 0) : null,
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
    slots = (await supabase.from('slots').select('id, name, type, description, depends_on_slot_id, target_item_count, items_per_key, current_item_count, attempt_count, finished_querying, last_queries').eq('root_message_id', rootMessageId)).data as SlotDb[] ?? [];
    slotIdByName = new Map(slots.map((s) => [s.name, s.id]));
    for (const q of planResult.subqueries) {
      const sid = slotIdByName.get(q.slot);
      if (sid) {
        const slot = slots.find((s) => s.id === sid);
        const isBroad =
          slot?.type === 'list' ||
          slot?.type === 'mapping' ||
          Boolean(slot?.depends_on_slot_id);
        await supabase.from('reasoning_subqueries').insert({
          reasoning_step_id: stepId,
          slot_id: sid,
          owner_id: ownerId,
          query_text: q.query,
          ...(isBroad ? { strategy: 'broad' } : {}),
        });
      }
    }

            const { data: existingStepSubq } = await supabase
      .from('reasoning_subqueries')
      .select('slot_id')
      .eq('reasoning_step_id', stepId);
    const hasSubqForSlot = new Set((existingStepSubq ?? []).map((r: { slot_id: string }) => r.slot_id));
    for (const slot of slots) {
      if (!slot.depends_on_slot_id) continue;
      if (hasSubqForSlot.has(slot.id)) continue;
      const q = (slot.description ?? '').trim() || slot.name;
      await supabase.from('reasoning_subqueries').insert({
        reasoning_step_id: stepId,
        slot_id: slot.id,
        owner_id: ownerId,
        query_text: q,
        strategy: 'broad',
      });
      hasSubqForSlot.add(slot.id);
    }
    await emit({ plan: { action: planResult.action, why: planResult.why, slots: planResult.slots, subqueries: planResult.subqueries } });
    const initialThoughtSlots = buildThoughtSlots(slots, planResult.slots);
    const initialThought = {
      slots: initialThoughtSlots,
      steps: [],
      slotFillSummary: buildSlotFillSummary(slots, new Map(slots.map((s) => [s.id, 0]))),
    };
    await emit({ thoughtProcess: initialThought });
  }

  let totalSubqueriesRun = 0;
  let iteration = 0;
  type ThoughtStep = {
    iter: number;
    action: string;
    why?: string;
    subqueries?: { slot: string; query: string; strategy?: 'broad' | 'targeted' }[];
    chunksPerSubquery?: number[];
    quotesFound?: number;
    claims?: unknown[];
    completeness?: number;
    fillStatusBySlot?: Record<string, string>;
    statements?: string[];
    nextAction?: string;
    slotSnapshot?: SlotSnapshotState;
    queryGuidance?: string;
    droppedClaims?: { slot: string; key?: string; value?: string; chunkIds?: string[]; reason: string }[];
    droppedSubqueries?: { slot: string; query: string; reason: string }[];
    listSlotState?: Record<string, { attempts: number; count: number; strategy: string; finished_querying: boolean }>;
  };
  let droppedSubqueriesPreparedThisIter: { slot: string; query: string; reason: string }[] = [];
  const thoughtProcess: {
    slots: ThoughtSlotUi[];
    slotFillSummary?: SlotFillRow[];
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
    slots: buildThoughtSlots(slots, planResult?.slots ?? undefined),
    slotFillSummary: buildSlotFillSummary(slots, new Map(slots.map((s) => [s.id, 0]))),
    planReason: appendId ? 'Same question, with the new page in the corpus.' : (planResult?.why ?? undefined),
    steps: [],
  };

  const slotsWithAttempts = slots.filter((s) => s.type === 'list' || s.type === 'mapping');

  const getCurrentSlotItemsState = async (): Promise<SlotSnapshotState> => {
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const { data: items } = await supabase
      .from('slot_items')
      .select('slot_id, key, value_json')
      .in('slot_id', slots.map((s) => s.id));
    const bySlot = new Map<string, { key: string | null; value: unknown }[]>();
    const seenListValueBySlotId = new Map<string, Set<string>>();
    for (const row of (items ?? []) as { slot_id: string; key: string | null; value_json: unknown }[]) {
      const slot = slotById.get(row.slot_id);
      if (slot?.type === 'list') {
        const dk = slotValueDedupKey(row.value_json);
        let seen = seenListValueBySlotId.get(row.slot_id);
        if (!seen) {
          seen = new Set();
          seenListValueBySlotId.set(row.slot_id, seen);
        }
        if (seen.has(dk)) continue;
        seen.add(dk);
      }
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
  let stagnationThisIteration = false;
  let done = false;
  let finalAnswer: string | undefined;
  
  let validQuoteIdsForSave = new Set<string>();
  
  const evidenceChunksById = new Map<string, EvidenceChunk>();
  let lastExtractResult: { next_action?: string; why?: string; final_answer?: string; subqueries?: ExtractSubquery[]; extractionGaps?: string[]; cited_snippets?: Record<string, string> } | null = null;
  const extractionGapsAccumulated: string[] = [];
  let slotItemCountBySlotId = new Map<string, number>();
  let fillBySlotId: FillMap = new Map();
  const lastParentFingerprintBySlotId = new Map<string, string>();
  const broadQueriesAttemptedBySlotId = new Map<string, string[]>();
  const failedAttemptsBySlotId = new Map<string, number>();
  const stagnationBySlotId = new Map<string, SlotStagnationTrack>(
    slots.map((s) => [s.id, createSlotStagnationTrack()]),
  );
  const slotsById = new Map(slots.map((s) => [s.id, s]));

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
    const { data: slotItemsRaw } = await supabase
      .from('slot_items')
      .select('slot_id, key, value_json')
      .in('slot_id', slots.map((s) => s.id));
    const itemsBySlotId = groupItemsBySlotId((slotItemsRaw ?? []) as SlotItemRow[]);
    slotItemCountBySlotId = countFilledBySlotId(slots, itemsBySlotId);
    fillBySlotId = computeSlotFillState({
      slots,
      itemsBySlotId,
      counts: slotItemCountBySlotId,
      lastParentFingerprintBySlotId,
      broadQueriesAttemptedBySlotId,
    });

    for (const slot of slots) {
      const fill = fillBySlotId.get(slot.id);
      const count = slotItemCountBySlotId.get(slot.id) ?? 0;
      if (slot.type === 'scalar') {
        if (count >= 1) slot.finished_querying = true;
      } else if (slot.type === 'mapping' && slot.depends_on_slot_id && fill?.parentSatisfied) {
        if (fill.unfilledKeys.length === 0 && fill.atTarget) slot.finished_querying = true;
      } else if (slot.type === 'list' || slot.type === 'mapping') {
        const effectiveTarget = getEffectiveTarget(slot, slotItemCountBySlotId, slotsById);
        if (effectiveTarget > 0 && count >= effectiveTarget && slot.type === 'list') {
          slot.finished_querying = true;
        }
      }
    }

    const stepList = (await supabase
      .from('reasoning_steps')
      .select('id, iteration_number, action')
      .eq('root_message_id', rootMessageId)
      .order('iteration_number', { ascending: true })).data as StepDb[] ?? [];
    const retrieveStep = stepList.find((s) => s.action === 'retrieve' && s.iteration_number === iteration);
    let currentStepId: string;
    type SubqWithSlot = { slotId: string; query: string; strategy?: 'broad' | 'targeted' };
    let subqueriesWithSlot: SubqWithSlot[] = [];

    // Build the seen set before insertion so fresh runs can skip duplicates upfront.
    // This also acts as a safety net for the resume path.
    const previousStepIds = stepList.filter((s) => s.iteration_number < iteration).map((s) => s.id);
    const seen = new Set<string>();
    // Normalize to lowercase so "Информация за X" and "информация за X" are the same key.
    const seenKey = (slotId: string, query: string) => `${slotId}::${query.trim().toLowerCase()}`;
    if (previousStepIds.length > 0) {
      const { data: allPrevSubq } = await supabase
        .from('reasoning_subqueries')
        .select('slot_id, query_text')
        .in('reasoning_step_id', previousStepIds);
      for (const row of (allPrevSubq ?? []) as { slot_id: string; query_text: string }[]) {
        seen.add(seenKey(row.slot_id, row.query_text));
      }
    }

    if (retrieveStep) {
      
      currentStepId = retrieveStep.id;
      const { data: sq } = await supabase
        .from('reasoning_subqueries')
        .select('query_text, slot_id, strategy')
        .eq('reasoning_step_id', currentStepId);
      const sqRows = (sq ?? []) as { query_text: string; slot_id: string; strategy: string | null }[];
      subqueriesWithSlot = sqRows
        .filter((r) => r.query_text && r.slot_id)
        .map((r): SubqWithSlot => ({
          slotId: r.slot_id,
          query: r.query_text,
          ...(r.strategy === 'broad' || r.strategy === 'targeted' ? { strategy: r.strategy } : {}),
        }))
        .filter((sq) => {
          const slot = slots.find((s) => s.id === sq.slotId);
          if (!slot || slot.finished_querying) return false;
          const count = slotItemCountBySlotId.get(slot.id) ?? 0;
          if (slot.type === 'scalar' && count >= 1) return false;
          return true;
        });
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
      const subsInput: ExtractSubquery[] = lastExtractResult?.subqueries?.length
        ? (lastExtractResult.subqueries as ExtractSubquery[])
        : [{ slot: 'answer', query: userMsg.slice(0, 200) }];
      
      const currentSlotStateForExpand = await getCurrentSlotItemsState();
      const subsForPrepare = subsInput.map((q) => ({
        slot: q.slot,
        query: q.query,
        ...((q as { map_description?: string }).map_description
          ? { map_description: (q as { map_description?: string }).map_description }
          : {}),
        ...((q as { key_connector?: string }).key_connector
          ? { key_connector: (q as { key_connector?: string }).key_connector }
          : {}),
      }));
      const prepared = prepareRunnableSubqueries({
        subsInput: subsForPrepare,
        slots,
        slotIdByName,
        fillBySlotId,
        stagnationBySlotId,
        slotItemCountBySlotId,
        getParentItems: (depSlotName) => currentSlotStateForExpand[depSlotName]?.items ?? [],
        maxMappingPerIter: MAX_MAPPING_SUBQUERIES_PER_ITER,
        maxPerIter: MAX_SUBQUERIES_PER_ITER,
      });
      droppedSubqueriesPreparedThisIter = prepared.dropped;
      for (const q of prepared.runnable) {
        const sid = slotIdByName.get(q.slot);
        if (!sid) continue;
        // Skip queries already run in a previous step so the DB stays clean.
        if (seen.has(seenKey(sid, q.query))) continue;
        const slot = slots.find((s) => s.id === sid);
        const fill = fillBySlotId.get(sid);
        const strategy = inferSubqueryStrategy(slot, fill, q.query);
        await supabase.from('reasoning_subqueries').insert({
          reasoning_step_id: currentStepId,
          slot_id: sid,
          owner_id: ownerId,
          query_text: q.query,
          ...(strategy ? { strategy } : {}),
        });
        if (strategy === 'broad') {
          const arr = broadQueriesAttemptedBySlotId.get(sid) ?? [];
          if (!arr.includes(q.query)) arr.push(q.query);
          broadQueriesAttemptedBySlotId.set(sid, arr);
        }
      }
      const { data: sq } = await supabase
        .from('reasoning_subqueries')
        .select('query_text, slot_id, strategy')
        .eq('reasoning_step_id', currentStepId);
      const sqRows = (sq ?? []) as { query_text: string; slot_id: string; strategy: string | null }[];
      subqueriesWithSlot = sqRows
        .filter((r) => r.query_text && r.slot_id)
        .map((r) => ({
          slotId: r.slot_id,
          query: r.query_text,
          ...(r.strategy === 'broad' || r.strategy === 'targeted' ? { strategy: r.strategy } : {}),
        }));
    }

    // `seen` and `seenKey` were computed above before insertion; no need to rebuild.
    // Keep the post-block filter as a safety net (handles the resume path where queries
    // were inserted by an older code version that lacked pre-insertion dedup).
    const seenDedupKey = (slotId: string, query: string) => `${slotId}\0${query}`;
    let runnable = subqueriesWithSlot.filter(
      (sq) => sq.query && !seen.has(seenKey(sq.slotId, sq.query)),
    );

    if (runnable.length === 0) {
      const seenForRecovery = new Set<string>();
      for (const key of seen) {
        // seen keys are "slotId::queryNormalized"; convert to "slotId\0queryNormalized" for recovery
        const sep = key.indexOf('::');
        if (sep >= 0) seenForRecovery.add(`${key.slice(0, sep)}\0${key.slice(sep + 2)}`);
      }
      for (const sq of subqueriesWithSlot) {
        if (sq.query) seenForRecovery.add(seenDedupKey(sq.slotId, sq.query.trim().toLowerCase()));
      }
      const recovery = buildRecoverySubqueries(slots, fillBySlotId, seenForRecovery);
      if (recovery.length > 0) {
        log('recovery-subqueries', { iteration, count: recovery.length });
        const currentSlotStateForRecovery = await getCurrentSlotItemsState();
        const recoveryPrepared = prepareRunnableSubqueries({
          subsInput: recovery.map((q) => {
            const slot = slots.find((s) => s.name === q.slot);
            return {
              slot: q.slot,
              query: q.query,
              ...(q.query === '__map__' ? { map_description: slot?.name ?? slot?.description ?? q.slot } : {}),
            };
          }),
          slots,
          slotIdByName,
          fillBySlotId,
          stagnationBySlotId,
          slotItemCountBySlotId,
          getParentItems: (depSlotName) => currentSlotStateForRecovery[depSlotName]?.items ?? [],
          maxMappingPerIter: MAX_MAPPING_SUBQUERIES_PER_ITER,
          maxPerIter: MAX_SUBQUERIES_PER_ITER,
        });
        droppedSubqueriesPreparedThisIter = [...(droppedSubqueriesPreparedThisIter ?? []), ...recoveryPrepared.dropped];
        for (const q of recoveryPrepared.runnable) {
          const sid = slotIdByName.get(q.slot);
          if (!sid || seen.has(seenKey(sid, q.query))) continue;
          await supabase.from('reasoning_subqueries').insert({
            reasoning_step_id: currentStepId,
            slot_id: sid,
            owner_id: ownerId,
            query_text: q.query,
            strategy: inferSubqueryStrategy(slots.find((s) => s.id === sid), fillBySlotId.get(sid), q.query) ?? undefined,
          });
          runnable.push({
            slotId: sid,
            query: q.query,
            ...(inferSubqueryStrategy(slots.find((s) => s.id === sid), fillBySlotId.get(sid), q.query)
              ? { strategy: inferSubqueryStrategy(slots.find((s) => s.id === sid), fillBySlotId.get(sid), q.query)! }
              : {}),
          });
        }
      }
    }

    const runnableForRetrieve = runnable.slice(
      0,
      Math.min(MAX_SUBQUERIES_PER_ITER, MAX_TOTAL_SUBQUERIES - totalSubqueriesRun),
    );
    const retrieveSubqueries = runnableForRetrieve.map((sq) => {
      const slot = slots.find((s) => s.id === sq.slotId);
      return { slot: slot?.name ?? '', query: sq.query };
    });
    if (retrieveSubqueries.length === 0) {
      log('break-no-subqueries', { iteration, subqueriesWithSlotCount: subqueriesWithSlot.length });
      break;
    }

    totalSubqueriesRun += retrieveSubqueries.length;

    log('retrieve-start', { iteration, subqueryCount: retrieveSubqueries.length });
    const { chunks: retrievedChunks, chunksPerSubquery, provenanceByChunkId } = await doRetrieve(
      supabase,
      openaiKey,
      pageIds,
      retrieveSubqueries,
    );
    log('retrieve-done', { chunksRetrieved: retrievedChunks.length, chunksPerSubquery });

    // Only pass this step's new chunks to extraction. Old chunks have already been processed
    // in prior iterations and their claims are in the current slot state. Keeping all accumulated
    // chunks blows up the extraction context with each step and causes edge-function timeouts.
    // The AI can still see what has already been found via the slot state JSON.
    const stepChunks: EvidenceChunk[] = [];
    for (const chunk of retrievedChunks) {
      const prov = provenanceByChunkId.get(chunk.id) ?? [];
      const ec: EvidenceChunk = {
        id: chunk.id,
        snippet: (chunk.content ?? '').trim(),
        pageUrl: chunk.page_url,
        pageTitle: chunk.page_title,
        retrievedBy: prov,
      };
      upsertEvidenceChunk(evidenceChunksById, ec);
      stepChunks.push(ec);
    }

    // Cap per-step evidence if needed (edge case: many queries with large results).
    const evidenceChunksForExtract: EvidenceChunk[] = stepChunks.length > EXTRACT_CHUNKS_CAP
      ? stepChunks
          .sort((a, b) => ((a as { distance?: number }).distance ?? 1) - ((b as { distance?: number }).distance ?? 1))
          .slice(0, EXTRACT_CHUNKS_CAP)
      : stepChunks;

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
    const { data: stepSubqRows } = await supabase
      .from('reasoning_subqueries')
      .select('slot_id, query_text, strategy')
      .eq('reasoning_step_id', currentStepId);
    const broadSlotIdsThisStep = new Set<string>();
    for (const row of (stepSubqRows ?? []) as { slot_id: string; query_text: string; strategy: string | null }[]) {
      if (row.strategy === 'broad' && row.query_text) {
        broadSlotIdsThisStep.add(row.slot_id);
        const arr = broadQueriesAttemptedBySlotId.get(row.slot_id) ?? [];
        if (!arr.includes(row.query_text)) arr.push(row.query_text);
        broadQueriesAttemptedBySlotId.set(row.slot_id, arr);
      }
    }
    fillBySlotId = computeSlotFillState({
      slots,
      itemsBySlotId,
      counts: slotItemCountBySlotId,
      lastParentFingerprintBySlotId,
      broadQueriesAttemptedBySlotId,
    });
    const broadSlotNamesThisStep = [
      ...new Set(slots.filter((s) => broadSlotIdsThisStep.has(s.id)).map((s) => s.name)),
    ];
    const queryGuidanceBlock = buildQueryGuidance(slots, fillBySlotId, stagnationBySlotId);
    const finishedQueryingSlotNames = slots.filter((s) => s.finished_querying).map((s) => s.name);
    const topSuggestedPages: SuggestedPage[] | null =
      dynamicMode && sourceIds.length > 0
        ? await getTopSuggestedPages(supabase, openaiKey, sourceIds, userMsg, retrieveSubqueries.map((s) => s.query), suggestedPageCandidates)
        : null;
    log('extract-call', { iteration, chunkCount: evidenceChunksForExtract.length, topSuggestedCount: topSuggestedPages?.length ?? 0 });
    const snippetPreviews = evidenceChunksForExtract.map((q) => (q.snippet ?? '').slice(0, 120));
    log('extract-evidence-preview', { iteration, snippetPreviews });
    const slotRowsForExtract: SlotRow[] = slots.map((s) => {
      const target = getEffectiveTarget(s, slotItemCountBySlotId, slotsById);
      return {
        id: s.id,
        name: s.name,
        type: s.type,
        description: s.description ?? undefined,
        depends_on_slot_id: s.depends_on_slot_id ?? undefined,
        ...(s.type === 'mapping' ? { items_per_key: s.items_per_key ?? 0 } : {}),
        ...((s.type === 'list' || s.type === 'mapping') && target > 0 ? { target_item_count: target } : {}),
      };
    });
    const extractResult = await callExtractAndDecide(
      openaiKey,
      slotRowsForExtract,
      evidenceChunksForExtract,
      currentSlotStateJson,
      userMsg,
      inferCorpusLanguage(buildCorpusContextBlock({ pages, sourceById, leadChunks: leadList })),
      dynamicMode,
      topSuggestedPages,
      previousAttemptsBySlot,
      broadSlotNamesThisStep,
      finishedQueryingSlotNames,
      queryGuidanceBlock,
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
        const label = typeof row.value_json === 'string' ? row.value_json : String(row.value_json ?? '');
        let set = keysByParentId.get(row.slot_id);
        if (!set) {
          set = new Set();
          keysByParentId.set(row.slot_id, set);
        }
        for (const part of splitListEntityValues(label)) {
          set.add(slotValueDedupKey(part));
        }
      }
      for (const slot of mappingSlots) {
        const keys = keysByParentId.get(slot.depends_on_slot_id!);
        if (keys?.size) map.set(slot.id, keys);
      }
      return map;
    })();
    const beforeCounts = new Map(slotItemCountBySlotId);
    const beforeFill = new Map(fillBySlotId);
    const { droppedClaims } = await insertClaims(supabase, {
      slotIdByName,
      slots,
      claims: extractResult.claims,
      ownerId,
      allowedKeysByMappingSlotId,
    });
    if (droppedClaims.length > 0) {
      extractionGapsAccumulated.push(
        ...droppedClaims.slice(0, 25).map((d) => `Dropped unsupported claim for ${d.slot}${d.key ? `/${d.key}` : ''}: ${d.reason}`),
      );
    }

    const { data: slotItemsAfter } = await supabase
      .from('slot_items')
      .select('slot_id, key, value_json')
      .in('slot_id', slots.map((s) => s.id));
    const itemsAfter = groupItemsBySlotId((slotItemsAfter ?? []) as SlotItemRow[]);
    slotItemCountBySlotId = countFilledBySlotId(slots, itemsAfter);
    fillBySlotId = computeSlotFillState({
      slots,
      itemsBySlotId: itemsAfter,
      counts: slotItemCountBySlotId,
      lastParentFingerprintBySlotId,
      broadQueriesAttemptedBySlotId,
    });
    const thisStepQueriesBySlotId = new Map<string, string[]>();
    for (const { slotId, query } of subqueriesWithSlot) {
      const arr = thisStepQueriesBySlotId.get(slotId) ?? [];
      arr.push(query);
      thisStepQueriesBySlotId.set(slotId, arr);
    }
    const prevItemCountBySlotId = new Map(slotsWithAttempts.map((s) => [s.id, s.current_item_count]));
    stagnationThisIteration = false;
    for (const slot of slotsWithAttempts) {
      const currentCount = slotItemCountBySlotId.get(slot.id) ?? 0;
      const hadSubqueriesThisStep = thisStepQueriesBySlotId.has(slot.id);
      slot.current_item_count = currentCount;

      const fill = fillBySlotId.get(slot.id);
      const effectiveTarget = getEffectiveTarget(slot, slotItemCountBySlotId, slotsById);
      const track = stagnationBySlotId.get(slot.id) ?? createSlotStagnationTrack();
      stagnationBySlotId.set(slot.id, track);

      const strategiesRun = new Set<SlotQueryStrategy>();
      for (const q of thisStepQueriesBySlotId.get(slot.id) ?? []) {
        const s = inferSubqueryStrategy(slot, fill, q);
        if (s) strategiesRun.add(s);
      }

      const itemCountBefore = beforeCounts.get(slot.id) ?? prevItemCountBySlotId.get(slot.id) ?? 0;
      const { awakened, finishedByStagnation } = updateSlotStagnationTrack({
        slot,
        fill,
        track,
        hadSubqueriesThisStep,
        strategiesRun,
        itemCountBefore,
        itemCountAfter: currentCount,
      });
      if (awakened) slot.finished_querying = false;
      if (finishedByStagnation) stagnationThisIteration = true;

      if (hadSubqueriesThisStep) {
        slot.attempt_count += 1;
        slot.last_queries = thisStepQueriesBySlotId.get(slot.id) ?? slot.last_queries ?? [];
        if ((extractResult.broad_query_completed_slot_fully ?? []).includes(slot.name)) {
          if (effectiveTarget <= 0 || currentCount >= effectiveTarget) slot.finished_querying = true;
        }
      }

      if (slotShouldBeFinishedQuerying(slot, fill, track, currentCount)) {
        slot.finished_querying = true;
      }
    }
    
    for (const slot of slots) {
      if (slot.type !== 'scalar') continue;
      const count = slotItemCountBySlotId.get(slot.id) ?? 0;
      if (count >= 1) continue;
            if (thisStepQueriesBySlotId.has(slot.id)) {
        const priorFails = failedAttemptsBySlotId.get(slot.id) ?? 0;
        const prevFilled = beforeCounts.get(slot.id) ?? 0;
        const progressed = count > prevFilled;
        const nextFails = progressed ? 0 : priorFails + 1;
        failedAttemptsBySlotId.set(slot.id, nextFails);
        if (nextFails >= 2) slot.finished_querying = true;
      }
    }
    const currentSlotItemCount = Array.from(slotItemCountBySlotId.values()).reduce((a, b) => a + b, 0);
    if (stagnationThisIteration) {
      log('stagnation-mark-finished', { iteration, currentSlotItemCount, prevSlotItemCount });
    }

    for (const slot of slots) {
      const payload: { finished_querying: boolean; current_item_count?: number; attempt_count?: number; last_queries?: string[] } = { finished_querying: slot.finished_querying };
      if (slot.type === 'list' || slot.type === 'mapping') {
        payload.current_item_count = slot.current_item_count;
        payload.attempt_count = slot.attempt_count;
        payload.last_queries = slot.last_queries ?? [];
      }
      await supabase.from('slots').update(payload).eq('id', slot.id);
    }
    prevSlotItemCount = currentSlotItemCount;

    for (const [slotId, fp] of updateParentFingerprints(fillBySlotId, slots).entries()) {
      lastParentFingerprintBySlotId.set(slotId, fp);
    }

    const nowFinishedNames = new Set(slots.filter((s) => s.finished_querying).map((s) => s.name));
    if (lastExtractResult?.subqueries?.length && nowFinishedNames.size > 0) {
      lastExtractResult.subqueries = lastExtractResult.subqueries.filter((q) => !nowFinishedNames.has(q.slot));
    }
    const slotMetaBySlotId = new Map<string, SlotCompletenessMeta>(
      slots.map((s) => [s.id, { target_item_count: getEffectiveTarget(s, slotItemCountBySlotId, slotsById), finished_querying: s.finished_querying }]),
    );
    const slotsForCompleteness: SlotForCompleteness[] = slots.map((s) => ({
      id: s.id,
      type: s.type as SlotForCompleteness['type'],
      depends_on_slot_id: s.depends_on_slot_id ?? null,
    }));
    const completeness = overallCompleteness(slotsForCompleteness, slotItemCountBySlotId, slotMetaBySlotId);
    const allFinished = slots.every((s) => s.finished_querying);
    let effectiveNextAction =
      extractResult.next_action === 'answer' && !allFinished
        ? 'retrieve'
        : (extractResult.next_action === 'retrieve' && allFinished)
          ? 'answer'
          : extractResult.next_action;

            if (effectiveNextAction === 'answer') {
      const pending = slots.filter((s) => {
        if (s.finished_querying) return false;
        const track = stagnationBySlotId.get(s.id);
        return slotHasGuidedWorkRemaining(fillBySlotId.get(s.id), track, s);
      });
      if (pending.length > 0) {
        effectiveNextAction = 'retrieve';
        const fallbackInput = pending.map((s) => ({
          slot: s.name,
          query: s.type === 'mapping' ? ('__map__' as const) : ((s.description ?? '').trim() || s.name),
          ...(s.type === 'mapping' && s.description ? { map_description: s.description } : {}),
        }));
        lastExtractResult = { ...extractResult, next_action: 'retrieve', subqueries: fallbackInput as ExtractSubquery[] };
      }
    }

    if (effectiveNextAction === 'expand_corpus' && anySlotHasGuidedWork(slots, fillBySlotId, stagnationBySlotId)) {
      effectiveNextAction = 'retrieve';
      log('expand_corpus-override-guided-work', { why: extractResult.why });
      const fallbackInput = slots
        .filter((s) => !s.finished_querying && slotHasGuidedWorkRemaining(fillBySlotId.get(s.id), stagnationBySlotId.get(s.id), s))
        .map((s) => ({
          slot: s.name,
          query: s.type === 'mapping' ? ('__map__' as const) : ((s.description ?? '').trim() || s.name),
          ...(s.type === 'mapping' && s.description ? { map_description: s.description } : {}),
        }));
      lastExtractResult = { ...extractResult, next_action: 'retrieve', subqueries: fallbackInput as ExtractSubquery[] };
      (extractResult as { next_action: string }).next_action = 'retrieve';
    }

    await supabase
      .from('reasoning_steps')
      .update({ completeness_score: completeness, why: extractResult.why ?? undefined })
      .eq('id', currentStepId);

    let fillStatusBySlot: Record<string, string> | undefined;
    if (INCLUDE_FILL_STATUS_BY_SLOT) {
      fillStatusBySlot = {};
      for (const slot of slots) {
        const fill = fillBySlotId.get(slot.id);
        const count = slotItemCountBySlotId.get(slot.id) ?? 0;
        if (slot.type === 'mapping' && fill) {
          const keysDone = fill.filledKeys.length;
          const keysTotal = fill.filledKeys.length + fill.unfilledKeys.length;
          fillStatusBySlot[slot.name] =
            fill.atTarget && fill.unfilledKeys.length === 0
              ? 'filled'
              : keysDone > 0
                ? 'partial'
                : 'missing';
        } else if (fill?.atTarget) {
          fillStatusBySlot[slot.name] = 'filled';
        } else {
          fillStatusBySlot[slot.name] = count > 0 ? 'partial' : 'missing';
        }
      }
    }

    const subqueriesForStep = subqueriesWithSlot.length
      ? subqueriesWithSlot.map((sq) => {
          const slot = slots.find((s) => s.id === sq.slotId);
          const fill = fillBySlotId.get(sq.slotId);
          const strategy =
            sq.strategy ??
            inferSubqueryStrategy(slot, fill, sq.query) ??
            undefined;
          return {
            slot: slot?.name ?? '',
            query: sq.query,
            ...(strategy ? { strategy } : {}),
          };
        })
      : retrieveSubqueries.map((q) => ({ slot: q.slot, query: q.query }));
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

    const slotSnapshot = await getCurrentSlotItemsState();
    thoughtProcess.slotFillSummary = buildSlotFillSummary(slots, slotItemCountBySlotId, slotsById);
    thoughtProcess.completeness = completeness;

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
      nextAction: effectiveNextAction,
      slotSnapshot,
      queryGuidance: queryGuidanceBlock,
      ...(droppedClaims.length ? { droppedClaims } : {}),
      ...(droppedSubqueriesPreparedThisIter.length ? { droppedSubqueries: droppedSubqueriesPreparedThisIter.slice(0, 50) } : {}),
      ...(extractResult.debug ? { extractDebug: extractResult.debug } : {}),
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
      action: effectiveNextAction,
      label: effectiveNextAction === 'answer' ? 'Answering' : effectiveNextAction === 'retrieve' ? 'Retrieving again' : effectiveNextAction,
      why: extractResult.why,
      quotesFound: retrievedChunks.length,
      claims: extractResult.claims,
      completeness,
      fillStatusBySlot: INCLUDE_FILL_STATUS_BY_SLOT ? fillStatusBySlot : undefined,
    });

    const zeroCompletenessGiveUp = completeness === 0 && iteration >= 1;

    if (effectiveNextAction === 'answer') {
      const finalResult = await produceFinalAnswer();
      finalAnswer = finalResult.finalAnswer;
      lastExtractResult = { ...extractResult, cited_snippets: finalResult.cited_snippets };
      if (extractResult.next_action === 'retrieve' && allFinished) {
        (lastExtractResult as { next_action?: string }).next_action = 'answer';
      }
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

    if (effectiveNextAction === 'expand_corpus') {
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
          suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, retrieveSubqueries.map((s) => s.query));
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

    if (effectiveNextAction === 'retrieve') {
      if (totalSubqueriesRun >= MAX_TOTAL_SUBQUERIES || stagnationThisIteration || zeroCompletenessGiveUp) {
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
          const suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, retrieveSubqueries.map((s) => s.query));
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

  if (!done && finalAnswer == null && iteration > 0) {
    log('no-answer-after-loop', { iteration, reason: 'broke with no subqueries or no final answer' });
    const fallbackResult = await produceFinalAnswer();
    finalAnswer = fallbackResult.finalAnswer || "I couldn't complete retrieval for that question. Try rephrasing or adding more sources.";
    validQuoteIdsForSave = fallbackResult.validQuoteIds;
    lastExtractResult = { ...lastExtractResult, cited_snippets: fallbackResult.cited_snippets };
    done = true;
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
  } else {
    log('no-final-answer', { iteration, finalAnswerLen: finalAnswer?.length ?? 0 });
    await emit({
      error: 'No answer was produced. Try again or check function logs.',
      thoughtProcess: {
        ...thoughtProcess,
        iterationCount: iteration,
        ...(extractionGapsAccumulated.length > 0 ? { extractionGaps: extractionGapsAccumulated } : {}),
      },
    });
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('error', { error: msg, stack: err instanceof Error ? err.stack : undefined });
    await emit({ error: msg });
  }
}