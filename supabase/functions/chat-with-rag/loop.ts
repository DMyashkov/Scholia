import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractClaim, ExtractResult } from './types.ts';
import type { SuggestedPage } from './expand.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';

export interface SlotRow {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  depends_on_slot_id?: string | null;
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
  "final_answer": "optional: when next_action is answer and slots are complete, provide the answer text with citation placeholders [[quote:uuid]] for each chunk you use (uuid = chunk id from the evidence block)",
  "cited_snippets": "optional: when next_action is answer, object mapping each chunk uuid you cite to the exact verbatim passage from the evidence for that citation, e.g. {\"uuid-1\": \"exact sentence from evidence\"}. Copy the passage exactly from the evidence block.",
  "subqueries": "optional: when next_action is retrieve, array of { \"slot\": \"slot_name\", \"query\": \"search phrase\" } for the next retrieval round",
  "questions": "optional: when next_action is clarify, array of clarifying question strings",
  "suggested_page_index": "optional: when next_action is expand_corpus and a candidate list was provided, integer 1–10 indicating which candidate page to suggest (1 = first); omit to suggest the first"
}

Rules:
- Only output claims that are directly supported by the given chunks. Each claim must list at least one chunkId from the evidence (the UUID in brackets above).
- Use the exact chunk id (UUID) in chunkIds—copy from the [uuid] line for each chunk you cite. Use the same ids in final_answer as [[quote:uuid]] (now referring to chunks).
- For scalar slots: one value, key omitted. For list slots: one claim per list item, value = the item. For mapping slots: key must be one of the entity names (keys) from the slot's dependency (see current slot state); value = the mapping value. Do not invent mapping keys—only use keys that already exist in the dependency slot's items.
- Prefer extracting claims when the evidence clearly states the information. Use "expand_corpus" only when the evidence genuinely does not contain the needed facts, not when it is merely spread across several chunks.
- If evidence is insufficient for required slots, set next_action to "retrieve" or "expand_corpus" or "clarify".
- For list slots, the backend tracks how many attempts have been made and whether the list has stagnated. You may start with either a broad discovery query or a more targeted/faceted query depending on the slot description. On later iterations, prefer targeted queries, and when there are already some list items and stagnation is high, you may also propose seeded queries that reference existing items by name.
- Never repeat an identical query string for the same slot if it has already been tried in previous iterations (the backend will provide history context in the prompt).
- When candidate suggested pages are provided (dynamic sources), prefer next_action "expand_corpus" only when evidence genuinely lacks the information AND at least one candidate page is clearly relevant. Otherwise prefer "retrieve" with subqueries (e.g. when the list is not full or more retrieval could fill slots) or "answer" if slots are fillable. When you choose expand_corpus you may set "suggested_page_index" (1–10) to pick which candidate to suggest; if omitted the first is used.
- When all required slots are filled and you can answer, set next_action to "answer" and include "final_answer" with [[quote:uuid]] placeholders. Also include "cited_snippets" with each cited chunk id mapped to the exact verbatim passage you are citing (one sentence or short passage from the evidence).`;

export async function callExtractAndDecide(
  apiKey: string,
  slots: SlotRow[],
  evidenceChunks: EvidenceChunk[],
  currentSlotStateJson: string,
  userMessage: string,
  suggestExpandWhenNoEvidence = false,
  topSuggestedPages: SuggestedPage[] | null = null,
): Promise<ExtractResult> {
  const quoteBlock = evidenceChunks
    .map((q) => `[${q.id}]\n${q.snippet}`)
    .join('\n\n---\n\n');
  const slotBlock = slots
    .map((s) => `- ${s.name} (${s.type})${s.description ? `: ${s.description}` : ''}`)
    .join('\n');

  let dynamicBlock = '';
  if (topSuggestedPages && topSuggestedPages.length > 0) {
    const candidateList = topSuggestedPages
      .map((p, i) => `${i + 1}. ${p.url}\n   title: ${p.title}\n   snippet: ${(p.snippet || '').slice(0, 200)}${(p.snippet?.length ?? 0) > 200 ? '...' : ''}`)
      .join('\n');
    dynamicBlock = `

Candidate suggested pages (non-indexed links; only suggest if one is clearly relevant and evidence lacks the information):
${candidateList}

When you choose expand_corpus, you may set "suggested_page_index" (1–${topSuggestedPages.length}) to pick which candidate to suggest; if omitted the first is used. Prefer retrieve with subqueries when more retrieval could fill slots (e.g. list not full).`;
  } else if (suggestExpandWhenNoEvidence) {
    dynamicBlock = '\nThis conversation has dynamic sources. When evidence is insufficient to fill required slots, prefer next_action "expand_corpus" with why describing what kind of page might help, instead of "retrieve".';
  }

  const userContent = `Question: ${userMessage}

Slots to fill:
${slotBlock}

Current slot state (structured JSON — use this to see existing keys per slot and, for mapping slots, which keys are allowed):
${currentSlotStateJson || '{}'}

Evidence (quotes with ids — use these exact UUIDs in each claim's quoteIds):
---
${quoteBlock}
---${dynamicBlock}

Output JSON with claims, next_action, why, optional final_answer, optional subqueries (when next_action is retrieve), and optional suggested_page_index (1–10, when next_action is expand_corpus).`;

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
  const final_answer = typeof obj.final_answer === 'string' ? obj.final_answer : undefined;
  const subqueriesRaw = Array.isArray(obj.subqueries) ? obj.subqueries : [];
  const subqueries = subqueriesRaw
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .map((q) => ({ slot: String(q.slot ?? ''), query: String(q.query ?? '') }))
    .filter((q) => q.slot.length > 0 && q.query.length > 0);
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

  let cited_snippets: Record<string, string> | undefined;
  if (obj.cited_snippets != null && typeof obj.cited_snippets === 'object' && !Array.isArray(obj.cited_snippets)) {
    cited_snippets = {};
    for (const [id, passage] of Object.entries(obj.cited_snippets)) {
      if (chunkIdSet.has(id) && typeof passage === 'string' && passage.trim().length > 0) {
        cited_snippets[id] = passage.trim();
      }
    }
    if (Object.keys(cited_snippets).length === 0) cited_snippets = undefined;
  }

  let suggested_page_index: number | undefined;
  if (next_action === 'expand_corpus' && typeof obj.suggested_page_index === 'number') {
    const n = Math.floor(obj.suggested_page_index);
    if (n >= 1 && n <= 10) suggested_page_index = n;
  }

  return {
    claims,
    next_action,
    why,
    final_answer,
    subqueries: subqueries.length > 0 ? subqueries : undefined,
    questions: questions.length > 0 ? questions : undefined,
    extractionGaps: undefined,
    cited_snippets,
    suggested_page_index,
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
