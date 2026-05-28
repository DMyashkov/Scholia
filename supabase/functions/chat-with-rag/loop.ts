import type { SupabaseClient } from '@supabase/supabase-js';
import type { EvidenceChunk, ExtractClaim, ExtractResult, ExtractSubquery } from './types.ts';
import { formatEvidenceForPrompt } from './evidenceFormat.ts';
import type { SuggestedPage } from './expand.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';
import { EXTRACT_SYSTEM } from './prompts.ts';
import { normalizeSlotEntityString, slotValueDedupKey, splitListEntityValues } from './utils.ts';
import type { CorpusLanguage } from './language.ts';
import { formatCorpusLanguageLine } from './language.ts';

export interface SlotRow {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  depends_on_slot_id?: string | null;

  target_item_count?: number;
  items_per_key?: number | null;
}

export type { EvidenceChunk } from './types.ts';

export async function callExtractAndDecide(
  apiKey: string,
  slots: SlotRow[],
  evidenceChunks: EvidenceChunk[],
  currentSlotStateJson: string,
  userMessage: string,
  corpusLanguage?: CorpusLanguage,
  suggestExpandWhenNoEvidence = false,
  topSuggestedPages: SuggestedPage[] | null = null,
  previousAttemptsBySlot?: string,

  broadSlotNamesThisStep: string[] = [],
  finishedQueryingSlotNames: string[] = [],
  queryGuidanceBlock?: string,
): Promise<ExtractResult> {
  const quoteBlock = formatEvidenceForPrompt(evidenceChunks);
  const slotBlock = slots
    .map((s) => {
      const targetStr = s.target_item_count != null && (s.type === 'list' || s.type === 'mapping') ? ` target=${s.target_item_count}` : '';
      const perKeyStr = s.type === 'mapping' && s.items_per_key != null ? ` items_per_key=${s.items_per_key}` : '';
      return `- ${s.name} (${s.type})${targetStr}${perKeyStr}${s.description ? `: ${s.description}` : ''}`;
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
      ? `${finishedQueryingSlotNames.join(', ')}. Do not suggest new subqueries for these slots.`
      : 'none';

  const guidanceBlock =
    queryGuidanceBlock && queryGuidanceBlock.trim().length > 0
      ? `

${queryGuidanceBlock}`
      : '';

  const langLine = corpusLanguage ? `${formatCorpusLanguageLine(corpusLanguage)}\n` : '';
  const userContent = `${langLine}Question: ${userMessage}

Slots to fill:
${slotBlock}

Slots already finished (no subqueries needed):
${finishedBlock}

Current slot state (JSON — existing keys per slot; for mapping, which keys are allowed):
${currentSlotStateJson || '{}'}
${guidanceBlock}
${previousAttemptsBlock}

Evidence (each block: chunk id, page URL when known, retrieval subquery + slot; use chunk indices 1..N or UUIDs in chunkIds):
---
${quoteBlock}
---${dynamicBlock}${broadBlock}

Output JSON: claims, next_action, why; add subqueries if retrieve; suggested_page_index if expand_corpus; broad_query_completed_slot_fully only when appropriate per guidance.`;

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
        const key_connector = typeof q.key_connector === 'string' ? q.key_connector.trim() || undefined : undefined;
        return {
          slot,
          query: '__map__' as const,
          ...(map_description ? { map_description } : {}),
          ...(key_connector ? { key_connector } : {}),
        };
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
  const claims: ExtractClaim[] = claimsRaw
    .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
    .map((c) => {
      const cRecord = c as Record<string, unknown>;
      const rawIds = Array.isArray(cRecord.chunkIds) ? (cRecord.chunkIds as unknown[]) : [];
      const chunkIds: string[] = [];
      const seen = new Set<string>();
      for (const id of rawIds) {
        if (typeof id === 'string' && chunkIdSet.has(id)) {
          if (!seen.has(id)) {
            seen.add(id);
            chunkIds.push(id);
          }
          continue;
        }
        const idx = typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN;
        if (Number.isInteger(idx) && idx >= 1 && idx <= chunkIdsByIndex.length) {
          const cid = chunkIdsByIndex[idx - 1];
          if (!seen.has(cid)) {
            seen.add(cid);
            chunkIds.push(cid);
          }
        }
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

function claimSortOrder(type: string | undefined): number {
  if (type === 'list') return 0;
  if (type === 'mapping') return 1;
  return 2;
}

export async function insertClaims(
  supabase: SupabaseClient,
  params: {
    slotIdByName: Map<string, string>;
    slots: { id: string; type: string; depends_on_slot_id?: string | null }[];
    claims: ExtractClaim[];
    ownerId: string;
    allowedKeysByMappingSlotId?: Map<string, Set<string>>;
  },
): Promise<{
  insertedSlotItemIds: string[];
  droppedClaims: { slot: string; key?: string; value?: string; chunkIds?: string[]; reason: string }[];
}> {
  const { slotIdByName, slots, claims, ownerId, allowedKeysByMappingSlotId } = params;
  const inserted: string[] = [];
  const batchDedup = new Map<string, string>();
  const droppedClaims: { slot: string; key?: string; value?: string; chunkIds?: string[]; reason: string }[] = [];
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const batchParentKeysBySlotId = new Map<string, Set<string>>();

  const normalizeForTokenCompare = (s: string): string =>
    normalizeSlotEntityString(s).replace(/_/g, ' ').toLowerCase();
  const tokenize = (s: string): string[] =>
    normalizeForTokenCompare(s)
      .split(/[^0-9\p{L}]+/gu)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  const looksGenericListLabel = (slotLabel: string, value: string): boolean => {
    const v = normalizeSlotEntityString(value);
    if (!v) return true;
    const hasUpper = /\p{Lu}/u.test(v);
    const words = tokenize(v);
    if (!hasUpper && words.length >= 2) {
      const slotTokens = new Set(tokenize(slotLabel));
      const overlap = words.filter((w) => slotTokens.has(w)).length;
      if (overlap >= Math.max(1, Math.floor(words.length * 0.6))) return true;
    }
    return false;
  };

  const ordered = [...claims].sort((a, b) => {
    const sa = slots.find((s) => s.id === slotIdByName.get(a.slot));
    const sb = slots.find((s) => s.id === slotIdByName.get(b.slot));
    return claimSortOrder(sa?.type) - claimSortOrder(sb?.type);
  });

  const insertOne = async (
    claim: ExtractClaim,
    slotId: string,
    slot: { id: string; type: string; depends_on_slot_id?: string | null },
    key: string | null,
    valueJson: unknown,
  ): Promise<void> => {
    if (valueJson == null || (typeof valueJson === 'string' && valueJson.trim().length === 0)) {
      droppedClaims.push({
        slot: claim.slot,
        ...(key != null ? { key } : {}),
        reason: 'Empty claim value.',
      });
      return;
    }

    if (slot.type === 'mapping') {
      if (key == null) {
        droppedClaims.push({
          slot: claim.slot,
          reason: 'Missing mapping key.',
        });
        return;
      }
      if (key.trim() === '-' || key.trim() === '—' || key.trim() === '–') {
        droppedClaims.push({
          slot: claim.slot,
          key,
          reason: 'Invalid mapping key placeholder.',
        });
        return;
      }
    }

    if (slot.type === 'list' && typeof valueJson === 'string') {
      if (looksGenericListLabel(claim.slot, valueJson)) {
        droppedClaims.push({
          slot: claim.slot,
          value: valueJson,
          ...(claim.chunkIds?.length ? { chunkIds: claim.chunkIds } : {}),
          reason: 'List value looks like a generic category label, not an entity.',
        });
        return;
      }
    }

    if (slot.type === 'mapping') {
      const allowed = allowedKeysByMappingSlotId?.get(slotId);
      const batchParent = slot.depends_on_slot_id
        ? batchParentKeysBySlotId.get(slot.depends_on_slot_id)
        : undefined;
      const keyDedup = key != null ? slotValueDedupKey(key) : null;
      const inAllowed = keyDedup != null && allowed?.has(keyDedup);
      const inBatch = keyDedup != null && batchParent?.has(keyDedup);
      if (allowed?.size && keyDedup != null && !inAllowed && !inBatch) {
        droppedClaims.push({
          slot: claim.slot,
          ...(key != null ? { key } : {}),
          ...(typeof claim.value === 'string' ? { value: claim.value } : {}),
          ...(claim.chunkIds?.length ? { chunkIds: claim.chunkIds } : {}),
          reason: 'Mapping key not in dependency slot state.',
        });
        return;
      }
    }

    const dedupKey = slotValueDedupKey(valueJson);
    const batchKey = `${slotId}\0${key ?? ''}\0${dedupKey}`;
    const batchHit = batchDedup.get(batchKey);
    if (batchHit) {
      for (const chunkId of claim.chunkIds) {
        await supabase.from('claim_evidence').upsert(
          { slot_item_id: batchHit, chunk_id: chunkId, owner_id: ownerId },
          { onConflict: 'slot_item_id,chunk_id', ignoreDuplicates: true },
        );
      }
      return;
    }

    let existingQuery = supabase
      .from('slot_items')
      .select('id, value_json')
      .eq('slot_id', slotId);
    existingQuery =
      key == null ? existingQuery.is('key', null) : existingQuery.eq('key', key);
    const { data: existingList } = await existingQuery.limit(500);
    const existing = (existingList ?? []).find(
      (row) => slotValueDedupKey(row.value_json) === dedupKey,
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
      if (insertErr || !insertedRow?.id) return;
      slotItemId = insertedRow.id;
      inserted.push(slotItemId);
    }

    batchDedup.set(batchKey, slotItemId);

    if (slot.type === 'list' && typeof valueJson === 'string') {
      let batchSet = batchParentKeysBySlotId.get(slotId);
      if (!batchSet) {
        batchSet = new Set();
        batchParentKeysBySlotId.set(slotId, batchSet);
      }
      for (const part of splitListEntityValues(valueJson)) {
        batchSet.add(slotValueDedupKey(part));
      }
    }

    for (const chunkId of claim.chunkIds) {
      await supabase.from('claim_evidence').upsert(
        { slot_item_id: slotItemId, chunk_id: chunkId, owner_id: ownerId },
        { onConflict: 'slot_item_id,chunk_id', ignoreDuplicates: true },
      );
    }
  };

  for (const claim of ordered) {
    const slotId = slotIdByName.get(claim.slot);
    if (!slotId) continue;
    const slot = slotById.get(slotId);
    if (!slot) continue;

    const key =
      claim.key != null
        ? normalizeSlotEntityString(typeof claim.key === 'string' ? claim.key : String(claim.key))
        : null;

    const rawValue = typeof claim.value === 'object' && claim.value !== null ? claim.value : claim.value;

    if (slot.type === 'list' && typeof rawValue === 'string') {
      const parts = splitListEntityValues(rawValue);
      if (parts.length > 1) {
        for (const part of parts) {
          await insertOne(claim, slotId, slot, null, part);
        }
        continue;
      }
    }

    const valueJson =
      typeof rawValue === 'string' ? normalizeSlotEntityString(rawValue) : rawValue;
    await insertOne(claim, slotId, slot, key, valueJson);
  }

  return { insertedSlotItemIds: inserted, droppedClaims };
}
