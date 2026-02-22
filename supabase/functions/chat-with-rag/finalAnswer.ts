/**
 * Final-answer step: separate prompt that runs when we finish (answer or forced by stagnation/hard stop).
 * Receives all evidence that supports any slot_item, fairly allocated across slots, so we can cite early and late findings.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENAI_CHAT_MODEL } from './config.ts';
import { FINAL_ANSWER_CHUNKS_CAP } from './config.ts';
import { capWithFairAllocation } from './utils.ts';

export interface EvidenceChunk {
  id: string;
  snippet: string;
}

export interface FinalAnswerResult {
  final_answer: string;
  cited_snippets: Record<string, string>;
}

/**
 * Get chunk ids that support slot_items for the given slots (via claim_evidence), grouped by slot_id.
 * Then return chunk objects (from evidenceChunksById) fairly allocated across slots up to cap.
 */
export async function getEvidenceChunksForFinalAnswer(
  supabase: SupabaseClient,
  slotIds: string[],
  evidenceChunksById: Map<string, string>,
  cap: number = FINAL_ANSWER_CHUNKS_CAP,
): Promise<EvidenceChunk[]> {
  if (slotIds.length === 0) return [];
  const { data: slotItems } = await supabase
    .from('slot_items')
    .select('id, slot_id')
    .in('slot_id', slotIds);
  const slotItemIds = (slotItems ?? []) as { id: string; slot_id: string }[];
  if (slotItemIds.length === 0) return [];
  const slotItemIdsList = slotItemIds.map((r) => r.id);
  const { data: claimRows } = await supabase
    .from('claim_evidence')
    .select('slot_item_id, chunk_id')
    .in('slot_item_id', slotItemIdsList);
  const claims = (claimRows ?? []) as { slot_item_id: string; chunk_id: string }[];
  const slotIdByItemId = new Map(slotItemIds.map((r) => [r.id, r.slot_id]));
  const chunkIdsBySlotId = new Map<string, Set<string>>();
  for (const c of claims) {
    const slotId = slotIdByItemId.get(c.slot_item_id);
    if (!slotId) continue;
    let set = chunkIdsBySlotId.get(slotId);
    if (!set) {
      set = new Set();
      chunkIdsBySlotId.set(slotId, set);
    }
    set.add(c.chunk_id);
  }
  const chunkMap = new Map<string, EvidenceChunk>();
  const groups: EvidenceChunk[][] = [];
  for (const slotId of slotIds) {
    const ids = chunkIdsBySlotId.get(slotId);
    const list: EvidenceChunk[] = [];
    if (ids) {
      for (const id of ids) {
        const snippet = evidenceChunksById.get(id);
        if (snippet == null) continue;
        const obj = { id, snippet };
        chunkMap.set(id, obj);
        list.push(obj);
      }
    }
    groups.push(list);
  }
  if (chunkMap.size === 0) return [];
  const selected = capWithFairAllocation(
    chunkMap,
    groups,
    Math.min(cap, chunkMap.size),
    (c) => c.id,
    () => 0,
  );
  return selected;
}

const FINAL_ANSWER_SYSTEM = `You write the final answer to the user's question using only the provided evidence (chunks). 
Each chunk has an id in brackets; use [[quote:uuid]] in your answer for every chunk you cite (uuid = chunk id).

Output JSON only:
{
  "final_answer": "your answer text with [[quote:uuid]] placeholders for each citation",
  "cited_snippets": { "uuid-1": "exact verbatim passage from that chunk", "uuid-2": "..." }
}

Rules:
- Base the answer only on the evidence below. Cite every claim with [[quote:uuid]] using the chunk id from the evidence block.
- In cited_snippets, map each cited chunk uuid to the exact verbatim passage you are quoting (one sentence or short passage). Copy from the evidence exactly.
- If some parts of the question could not be answered from the evidence: 
(1) briefly say why (e.g. no evidence in the provided sources); (2) present what you did find with citations; (3) at the end list what could not be found.`;

export async function callFinalAnswer(
  apiKey: string,
  userMessage: string,
  currentSlotStateJson: string,
  evidenceChunks: EvidenceChunk[],
): Promise<FinalAnswerResult> {
  const quoteBlock = evidenceChunks
    .map((q) => `[${q.id}]\n${q.snippet}`)
    .join('\n\n---\n\n');
  const userContent = `Question: ${userMessage}

Filled slot state (what we extracted from evidence):
${currentSlotStateJson || '{}'}

Evidence (chunks with ids — cite these with [[quote:uuid]] in your answer):
---
${quoteBlock}
---

Output JSON with final_answer and cited_snippets.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: FINAL_ANSWER_SYSTEM },
        { role: 'user', content: userContent },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI final answer: ${res.status}`);
  const raw = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      final_answer: "I couldn't format the answer from the evidence. Here's what was found in the sources.",
      cited_snippets: {},
    };
  }
  const obj = parsed as Record<string, unknown>;
  const final_answer = typeof obj.final_answer === 'string' && obj.final_answer.trim().length > 0
    ? obj.final_answer.trim()
    : "I couldn't find enough in the sources to answer fully.";
  const chunkIdSet = new Set(evidenceChunks.map((c) => c.id));
  let cited_snippets: Record<string, string> = {};
  if (obj.cited_snippets != null && typeof obj.cited_snippets === 'object' && !Array.isArray(obj.cited_snippets)) {
    for (const [id, passage] of Object.entries(obj.cited_snippets)) {
      if (chunkIdSet.has(id) && typeof passage === 'string' && passage.trim().length > 0) {
        cited_snippets[id] = passage.trim();
      }
    }
  }
  return { final_answer, cited_snippets };
}
