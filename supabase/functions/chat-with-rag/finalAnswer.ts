



import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENAI_CHAT_MODEL } from './config.ts';
import { FINAL_ANSWER_CHUNKS_CAP } from './config.ts';
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

const FINAL_ANSWER_SYSTEM = `You write the final answer to the user's question using only the provided evidence (chunks). 
Each chunk has an id in brackets; use [[quote:uuid]] in your answer for every chunk you cite (uuid = chunk id).

Output JSON only:
{
  "final_answer": "your answer text with [[quote:uuid]] placeholders for each citation",
  "cited_snippets": { "uuid-1": "exact verbatim passage from that chunk", "uuid-2": "..." }
}

Rules:
- Base the answer only on the evidence below. Cite every claim with [[quote:uuid]] using the chunk id from the evidence block.
- In cited_snippets, map each cited chunk uuid to the exact verbatim passage you are quoting (one sentence or short passage). Copy from the evidence exactly — unverified quotes are removed from the saved answer.
- Slot state summaries may paraphrase evidence; final-answer quotes must be verbatim from the chunk text.
- Format the answer in Markdown with clear newlines. Prefer lists/tables when the question asks for per-entity answers.
- If the question asks about a specific number of entities (e.g. "22 varieties") and you could not find evidence for all of them, begin your answer with exactly one sentence: "Found [data type] for [X] of [Y] [entity type]; the rest are not covered in the indexed sources." — then present the full per-entity list below.
- If some parts of the question could not be answered from the evidence:
(1) briefly say why (e.g. no evidence in the provided sources); (2) present what you did find with citations; (3) at the end list what could not be found.`;

export async function callFinalAnswer(
  apiKey: string,
  userMessage: string,
  currentSlotStateJson: string,
  evidenceChunks: EvidenceChunk[],
): Promise<FinalAnswerResult> {
  const quoteBlock = formatEvidenceForPrompt(evidenceChunks);
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
  const chunkIdsByIndex = evidenceChunks.map((c) => c.id);
  const resolveId = (rawId: string): string | null => {
    const id = rawId.trim();
    if (chunkIdSet.has(id)) return id;
    const n = Number.parseInt(id, 10);
    if (Number.isInteger(n) && n >= 1 && n <= chunkIdsByIndex.length) return chunkIdsByIndex[n - 1];
    return null;
  };

  const resolvedFinalAnswer = final_answer.replace(/\[\[quote:([^\]]+)\]\]/g, (m, idRaw) => {
    const resolved = typeof idRaw === 'string' ? resolveId(idRaw) : null;
    return resolved ? `[[quote:${resolved}]]` : m;
  });
  const cited_snippets: Record<string, string> = {};
  if (obj.cited_snippets != null && typeof obj.cited_snippets === 'object' && !Array.isArray(obj.cited_snippets)) {
    for (const [id, passage] of Object.entries(obj.cited_snippets)) {
      const resolved = resolveId(id);
      if (resolved && typeof passage === 'string' && passage.trim().length > 0) {
        cited_snippets[resolved] = passage.trim();
      }
    }
  }
  return { final_answer: resolvedFinalAnswer, cited_snippets };
}