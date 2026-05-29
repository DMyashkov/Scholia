



import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENAI_CHAT_MODEL, FINAL_ANSWER_CHUNKS_CAP, fetchWithTimeout } from './config.ts';
import { capWithFairAllocation } from './utils.ts';
import type { EvidenceChunk } from './types.ts';
import { formatEvidenceForPrompt } from './evidenceFormat.ts';


export interface FinalAnswerResult {
  final_answer: string;
  cited_snippets: Record<string, string>;
}





export async function getEvidenceChunksForFinalAnswer(
  supabase: SupabaseClient,
  slotIds: string[],
  evidenceChunksById: Map<string, EvidenceChunk>,
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
        const chunk = evidenceChunksById.get(id);
        if (chunk == null) continue;
        const obj = chunk;
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

const FINAL_ANSWER_SYSTEM = `You write the final answer to the user's question from extracted slot state data.

Output JSON only:
{ "final_answer": "your formatted answer with [ref:N] citation markers from the citation table" }

Rules:
- Write from the slot state provided. Do not add facts not present in the slot state.
- For each entity/key in a mapping slot: if the citation table lists a [ref:N] marker for that entity, append that exact marker at the end of that entity's line.
- If no citation is listed for an entity, write it without any citation marker — never invent a [ref:N] marker.
- Only use [ref:N] markers that appear in the citation table. Do not modify the number.
- Format the answer in Markdown with clear newlines. Prefer lists/tables when the question asks for per-entity answers.
- If the question asks about a specific number of entities (e.g. "22 varieties") and fewer appear in the slot state, begin with exactly one sentence: "Found [data type] for [X] of [Y] [entity type]; the rest are not covered in the indexed sources." — use the exact counts from the coverage note if provided.`;

export async function callFinalAnswer(
  apiKey: string,
  userMessage: string,
  currentSlotStateJson: string,
  quoteRefTable?: string,
  fillNote?: string,
): Promise<FinalAnswerResult> {
  const userContent = `Question: ${userMessage}

Extracted slot state:
${currentSlotStateJson || '{}'}
${fillNote ? `\nCoverage (use these exact counts in your completeness sentence):\n${fillNote}\n` : ''}
${quoteRefTable ? `\nCitation table — copy each [ref:N] marker verbatim to the matching entity's line:\n${quoteRefTable}\n` : ''}
Output JSON with "final_answer".`;

  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
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
    return { final_answer: "I couldn't format the answer from the evidence. Here's what was found in the sources.", cited_snippets: {} };
  }
  const obj = parsed as Record<string, unknown>;
  const final_answer = typeof obj.final_answer === 'string' && obj.final_answer.trim().length > 0
    ? obj.final_answer.trim()
    : "I couldn't find enough in the sources to answer fully.";
  return { final_answer, cited_snippets: {} };
}