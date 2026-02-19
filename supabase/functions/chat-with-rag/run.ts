/**
 * RAG orchestration: load context, run plan+loop, handle clarify/expand_corpus, finalize answer.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from 'npm:@supabase/supabase-js@2';
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
import type { SlotRow } from './loop.ts';
import { doRetrieveAndCreateQuotes } from './retrieve.ts';
import { createQuoteFromChunk } from './quotes.ts';
import { slotCompleteness, overallCompleteness } from './completeness.ts';
import type { SlotForCompleteness } from './completeness.ts';
import { doExpandCorpus, type SuggestedPage } from './expand.ts';
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
    slots = (await supabase.from('slots').select('id, name, type, description, required, depends_on_slot_id').eq('root_message_id', rootMessageId)).data as SlotDb[] ?? [];
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
      const { data: sq } = await supabase.from('reasoning_subqueries').select('query_text, slot_id').eq('reasoning_step_id', currentStepId);
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
        : [{ slot: 'answer', query: userMsg.slice(0, 200) }];
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

    for (const chunk of leadList) {
      const page = pageById.get(chunk.page_id);
      if (!page) continue;
      const domain = sourceDomainByPageId.get(chunk.page_id) ?? '';
      const id = await createQuoteFromChunk(supabase, {
        chunk,
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
      const { data: qrows } = await supabase.from('quotes').select('id, snippet').in('retrieved_in_reasoning_step_id', stepIds);
      return (qrows ?? []) as QuoteRow[];
    })();
    validQuoteIds = new Set(allQuotesForRoot.map((q) => q.id));
    const quotesForExtract = allQuotesForRoot.map((q) => ({ id: q.id, snippet: q.snippet }));

    const currentSummary = await getCurrentSlotItemsSummary();
    log('extract-call', { iteration, quoteCount: quotesForExtract.length });
    const snippetPreviews = quotesForExtract.map((q) => (q.snippet ?? '').slice(0, 120));
    const hasFoalKeywords = quotesForExtract.some((q) => /foal|Kid Meyers|Oh My Oh|Mr\. Meyers|Milpool|broodmare|sired by|dam of/i.test(q.snippet ?? ''));
    log('extract-quotes-preview', { iteration, snippetPreviews, hasFoalKeywords });
    const extractResult = await callExtractAndDecide(openaiKey, slotRowsForExtract, quotesForExtract, currentSummary, userMsg, dynamicMode);
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
        finalAnswer = extractResult.final_answer ?? "I've hit the limit for suggesting new pages. You can add more sources and ask again.";
        done = true;
        break;
      }
      let suggestedPage: SuggestedPage | null = null;
      if (dynamicMode && sourceIds.length > 0) {
        suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, subqueryTexts.slice(0, 3));
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
              ? 'No evidence found for the requested slots.'
              : `Answered with partial completeness; missing or partial: ${missing.join(', ')}`;
          }
        }
        if (extractionGapsAccumulated.length > 0) thoughtProcess.extractionGaps = [...extractionGapsAccumulated];
        const lastCompleteness = thoughtProcess.steps[thoughtProcess.steps.length - 1]?.completeness ?? 0;
        if (dynamicMode && sourceIds.length > 0) {
          thoughtProcess.expandCorpusReason = thoughtProcess.hardStopReason + '; suggesting a page to add.';
          await emit({ thoughtProcess: { ...thoughtProcess } });
          const suggestedPage = await doExpandCorpus(supabase, openaiKey, sourceIds, userMsg, subqueryTexts.slice(0, 3));
          if (suggestedPage) log('expand-suggested-on-stagnation', { url: suggestedPage.url });
          const stagnationModelMessage = (lastExtractResult?.final_answer ?? lastExtractResult?.why ?? '').trim();
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
    const { message: assistantRow, quotesOut } = await saveAssistantMessageWithQuotes({
      supabase,
      conversationId: convId,
      ownerId,
      finalAnswer,
      validQuoteIds,
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
