import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractClaim, ExtractResult, ExtractSubquery } from './types.ts';
import type { SuggestedPage } from './expand.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';

export interface SlotRow {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  depends_on_slot_id?: string | null;
  /** For list/mapping: do not suggest subqueries once current slot state has this many items. 0 = no fixed target (continue until broad_query_completed_slot_fully or stagnate). */
  target_item_count?: number;
}

export interface EvidenceChunk {
  id: string;
  snippet: string;
}

const EXTRACT_SYSTEM = `You extract atomic claims from the provided evidence (chunks) and decide the next step.

Output JSON only:
{
  "claims": [
    { "slot": "slot_name", "value": <atomic value: string or number>, "key": "<only for mapping slots>", "confidence": 0.0-1.0, "chunkIds": ["chunk-uuid-1", "chunk-uuid-2"] }
  ],
  "next_action": "retrieve" | "expand_corpus" | "clarify" | "answer",
  "why": "short reason",
  "subqueries": "optional: when next_action is retrieve, array of { \"slot\": \"slot_name\", \"query\": \"search phrase\" } or for mapping slots { \"slot\": \"slot_name\", \"query\": \"__map__\", \"map_description\": \"optional phrase per key (e.g. achievements)\" }; backend expands __map__ to one query per key from the dependency list",
  "questions": "optional: when next_action is clarify, array of clarifying question strings",
  "suggested_page_index": "optional: when next_action is expand_corpus and a candidate list was provided, integer 1–10 (1 = first); omit for first",
  "broad_query_completed_slot_fully": "optional: array of BROAD slot names (listed below) for which no more retrieval is needed; evidence sufficient."
}

Rules:
- Claims: only from given chunks; each claim must list at least one chunkId (exact UUID from [uuid] lines). 
Scalar: one value, no key. List: one claim per item. Mapping: key = one of the dependency slot's entity names from current slot state; do not invent keys.

- Prefer "retrieve" or "answer"; use "expand_corpus" only when evidence genuinely lacks the facts (not merely spread across chunks). 
Use "clarify" only when the question is ambiguous, not when evidence is missing.

- Answer: Set next_action to "answer" when required slots are finished/complete or retrieval has stagnated with partial evidence. 
Backend runs a separate final-answer step; you do not write answer text.

- Subqueries: omit for (a) slots that have finished querying (listed below), (b) scalar slots that already have a value in current slot state, 
(c) list/mapping slots that have reached target (see "Slots to fill" targets; target 0 = no fixed target, continue until broad_query_completed_slot_fully or stagnate). 
Only suggest subqueries for slots that still need retrieval after your claims.
For mapping slots you may output a single map directive: { \"slot\": \"slot_name\", \"query\": \"__map__\", \"map_description\": \"optional phrase per key\" }; backend will expand it into one query per key from the dependency list (matrix).

- BROAD vs TARGETED: Backend lists BROAD slots this step. Use broad-style only for those; targeted for other list/mapping. 
For BROAD slots you may set broad_query_completed_slot_fully if no more retrieval needed. Never repeat an identical query; use "last queries and items" to try something different.

- Candidate suggested pages: prefer "expand_corpus" only when evidence genuinely lacks info AND a candidate is clearly relevant; 
otherwise "retrieve" with subqueries or "answer". If expand_corpus, set suggested_page_index (1–10) or omit for first.`;

export async function callExtractAndDecide(
  apiKey: string,
  slots: SlotRow[],
  evidenceChunks: EvidenceChunk[],
  currentSlotStateJson: string,
  userMessage: string,
  suggestExpandWhenNoEvidence = false,
  topSuggestedPages: SuggestedPage[] | null = null,
  previousAttemptsBySlot?: string,
  /** Slot names that are in BROAD mode this step (first retrieval for that slot). AI may set broad_query_completed_slot_fully only for these. */
  broadSlotNamesThisStep: string[] = [],
  /** Slot names that have finished_querying (backend set from stagnation or broadQueryCompletedSlotFully). AI should not suggest subqueries for these; use to decide when to answer. */
  finishedQueryingSlotNames: string[] = [],
): Promise<ExtractResult> {
  const quoteBlock = evidenceChunks
    .map((q) => `[${q.id}]\n${q.snippet}`)
    .join('\n\n---\n\n');
  const slotBlock = slots
    .map((s) => {
      const targetStr = s.target_item_count != null && (s.type === 'list' || s.type === 'mapping') ? ` target=${s.target_item_count}` : '';
      return `- ${s.name} (${s.type})${targetStr}${s.description ? `: ${s.description}` : ''}`;
    })
    .join('\n');

  let previousAttemptsBlock = '';
  if (previousAttemptsBySlot && previousAttemptsBySlot.trim().length > 0) {
    previousAttemptsBlock = `

Previous attempt (slots not yet completed — try different queries):
${previousAttemptsBySlot}`;
  }

  let dynamicBlock = '';
  if (topSuggestedPages && topSuggestedPages.length > 0) {
    const candidateList = topSuggestedPages
      .map((p, i) => `${i + 1}. ${p.url}\n   title: ${p.title}\n   snippet: ${(p.snippet || '').slice(0, 200)}${(p.snippet?.length ?? 0) > 200 ? '...' : ''}`)
      .join('\n');
    dynamicBlock = `

Candidate suggested pages (suggest expand_corpus only if one is clearly relevant and evidence lacks the info):
${candidateList}

expand_corpus: set suggested_page_index (1–${topSuggestedPages.length}) or omit for first. Prefer retrieve when more retrieval could fill slots.`;
  } else if (suggestExpandWhenNoEvidence) {
    dynamicBlock = '\nDynamic sources: when evidence is insufficient, prefer next_action "expand_corpus" with why (what kind of page would help).';
  }

  let broadBlock = '';
  if (broadSlotNamesThisStep.length > 0) {
    broadBlock = `\n\nBROAD slots this step (may set broad_query_completed_slot_fully): ${broadSlotNamesThisStep.join(', ')}.`;
  }

  const finishedBlock =
    finishedQueryingSlotNames.length > 0
      ? `
 ${finishedQueryingSlotNames.join(', ')}. Set next_action to "answer" when all required are finished or complete.`
      : '';

  const userContent = `Question: ${userMessage}

Slots to fill:
${slotBlock}

Slots already finished (no subqueries needed):
${finishedBlock}

Current slot state (JSON — existing keys per slot; for mapping, which keys are allowed):
${currentSlotStateJson || '{}'}
${previousAttemptsBlock}

Evidence (use exact UUIDs in each claim's chunkIds):
---
${quoteBlock}
---${dynamicBlock}${broadBlock}

Output JSON: claims, next_action, why; add subqueries if retrieve; suggested_page_index if expand_corpus; broad_query_completed_slot_fully for BROAD slots needing no more retrieval.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: EXTRACT_SYSTEM },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI extract: ${res.status}`);
  const raw = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      claims: [],
      next_action: 'retrieve',
      why: 'Parse error',
      extractionGaps: ['Could not parse extract response (invalid JSON)'],
    };
  }
  const obj = parsed as Record<string, unknown>;
  const next_action = ['retrieve', 'expand_corpus', 'clarify', 'answer'].includes(String(obj.next_action))
    ? (obj.next_action as ExtractResult['next_action'])
    : 'retrieve';
  const why = typeof obj.why === 'string' ? obj.why : undefined;
  const subqueriesRaw = Array.isArray(obj.subqueries) ? obj.subqueries : [];
  const subqueries: ExtractSubquery[] = subqueriesRaw
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .map((q) => {
      const slot = String(q.slot ?? '').trim();
      const queryRaw = q.query;
      const query = queryRaw === '__map__' ? '__map__' : String(queryRaw ?? '');
      if (slot.length === 0) return null;
      if (query === '__map__') {
        const map_description = typeof q.map_description === 'string' ? q.map_description.trim() || undefined : undefined;
        return { slot, query: '__map__' as const, ...(map_description ? { map_description } : {}) };
      }
      if (typeof query === 'string' && query.length > 0) return { slot, query };
      return null;
    })
    .filter((q): q is ExtractSubquery => q != null);
  const questionsRaw = Array.isArray(obj.questions) ? obj.questions : [];
  const questions = questionsRaw.filter((q): q is string => typeof q === 'string' && q.trim().length > 0).map((q) => q.trim());
  const claimsRaw = Array.isArray(obj.claims) ? obj.claims : [];
  const chunkIdSet = new Set(evidenceChunks.map((q) => q.id));
  const chunkIdsByIndex = evidenceChunks.map((q) => q.id);
  let droppedNoValidChunkIds = 0;
  const claims: ExtractClaim[] = claimsRaw
    .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
    .map((c) => {
      const rawIds = Array.isArray((c as any).chunkIds) ? ((c as any).chunkIds as unknown[]) : [];
      let chunkIds = rawIds.filter((id): id is string => typeof id === 'string' && chunkIdSet.has(id)) as string[];
      if (chunkIds.length === 0 && rawIds.length > 0) {
        const byIndex = rawIds
          .map((id) => (typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN))
          .filter((i) => Number.isInteger(i) && i >= 1 && i <= chunkIdsByIndex.length)
          .map((i) => chunkIdsByIndex[i - 1]);
        if (byIndex.length > 0) chunkIds = byIndex;
        else droppedNoValidChunkIds++;
      }
      return {
        slot: String(c.slot ?? ''),
        value: c.value !== undefined ? c.value : '',
        key: typeof c.key === 'string' ? c.key : undefined,
        confidence: typeof c.confidence === 'number' ? c.confidence : 1,
        chunkIds,
      };
    })
    .filter((c) => c.slot && c.chunkIds.length > 0);
  if (claimsRaw.length > 0 || droppedNoValidChunkIds > 0) {
    console.log(
      '[RAG] extract-claims',
      JSON.stringify({
        rawCount: claimsRaw.length,
        afterFilter: claims.length,
        droppedNoValidChunkIds,
        sampleChunkIds: evidenceChunks.slice(0, 2).map((q) => q.id),
      }),
    );
  }

  let suggested_page_index: number | undefined;
  if (next_action === 'expand_corpus' && typeof obj.suggested_page_index === 'number') {
    const n = Math.floor(obj.suggested_page_index);
    if (n >= 1 && n <= 10) suggested_page_index = n;
  }

  let broad_query_completed_slot_fully: string[] | undefined;
  if (Array.isArray(obj.broad_query_completed_slot_fully)) {
    broad_query_completed_slot_fully = obj.broad_query_completed_slot_fully
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .map((x) => x.trim());
    if (broad_query_completed_slot_fully.length === 0) broad_query_completed_slot_fully = undefined;
  }

  return {
    claims,
    next_action,
    why,
    subqueries: subqueries.length > 0 ? subqueries : undefined,
    questions: questions.length > 0 ? questions : undefined,
    extractionGaps: undefined,
    suggested_page_index,
    broad_query_completed_slot_fully,
  };
}

/**
 * Insert claims as slot_items and claim_evidence. Dedupes by (slot_id, key, value_json).
 * For mapping slots, only accepts claims whose key is in allowedKeysByMappingSlotId (anchors to list slot).
 * Returns created slot_item ids (for callers that need them).
 */
export async function insertClaims(
  supabase: SupabaseClient,
  params: {
    slotIdByName: Map<string, string>;
    slots: { id: string; type: string; depends_on_slot_id?: string | null }[];
    claims: ExtractClaim[];
    ownerId: string;
    allowedKeysByMappingSlotId?: Map<string, Set<string>>;
  },
): Promise<{ insertedSlotItemIds: string[] }> {
  const { slotIdByName, slots, claims, ownerId, allowedKeysByMappingSlotId } = params;
  const inserted: string[] = [];

  for (const claim of claims) {
    const slotId = slotIdByName.get(claim.slot);
    if (!slotId) continue;

    const slot = slots.find((s) => s.id === slotId);
    if (slot?.type === 'mapping' && allowedKeysByMappingSlotId?.has(slotId)) {
      const allowed = allowedKeysByMappingSlotId.get(slotId)!;
      const keyStr = claim.key != null ? (typeof claim.key === 'string' ? claim.key : String(claim.key)) : null;
      if (keyStr == null || !allowed.has(keyStr)) continue;
    }

    const valueJson = typeof claim.value === 'object' && claim.value !== null ? claim.value : claim.value;
    const key = claim.key ?? null;

    // Dedupe: check existing slot_item with same slot_id, key, value_json
    const { data: existingList } = await supabase
      .from('slot_items')
      .select('id, value_json')
      .eq('slot_id', slotId)
      .eq('key', key)
      .limit(50);
    const existing = (existingList ?? []).find(
      (row) => JSON.stringify(row.value_json) === JSON.stringify(valueJson),
    );

    let slotItemId: string;
    if (existing?.id) {
      slotItemId = existing.id as string;
    } else {
      const { data: insertedRow, error: insertErr } = await supabase
        .from('slot_items')
        .insert({
          slot_id: slotId,
          owner_id: ownerId,
          key,
          value_json: valueJson,
          confidence: claim.confidence ?? 1,
          complete: false,
        })
        .select('id')
        .single();
      if (insertErr || !insertedRow?.id) continue;
      slotItemId = insertedRow.id;
      inserted.push(slotItemId);
    }

    for (const chunkId of claim.chunkIds) {
      await supabase.from('claim_evidence').upsert(
        { slot_item_id: slotItemId, chunk_id: chunkId, owner_id: ownerId },
        { onConflict: 'slot_item_id,chunk_id', ignoreDuplicates: true },
      );
    }
  }

  return { insertedSlotItemIds: inserted };
}
