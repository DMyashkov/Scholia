import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExtractClaim, ExtractResult } from './types.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';

export interface SlotRow {
  id: string;
  name: string;
  type: string;
  description?: string | null;
  depends_on_slot_id?: string | null;
}

export interface QuoteWithId {
  id: string;
  snippet: string;
}

const EXTRACT_SYSTEM = `You extract atomic claims from the provided evidence (quotes) and decide the next step.

Output JSON only:
{
  "claims": [
    { "slot": "slot_name", "value": <atomic value: string or number>, "key": "<only for mapping slots>", "confidence": 0.0-1.0, "quoteIds": ["quote-uuid-1", "quote-uuid-2"] }
  ],
  "next_action": "retrieve" | "expand_corpus" | "clarify" | "answer",
  "why": "short reason",
  "final_answer": "optional: when next_action is answer and slots are complete, provide the answer text with citation placeholders [[quote:uuid]] for each quote you use",
  "cited_snippets": "optional: when next_action is answer, object mapping each quote uuid you cite to the exact verbatim passage from the evidence for that citation, e.g. {\"uuid-1\": \"exact sentence from evidence\"}. Copy the passage exactly from the evidence block.",
  "subqueries": "optional: when next_action is retrieve, array of { \"slot\": \"slot_name\", \"query\": \"search phrase\" } for the next retrieval round",
  "questions": "optional: when next_action is clarify, array of clarifying question strings"
}

Rules:
- Only output claims that are directly supported by the given quotes. Each claim must list at least one quoteId from the evidence.
- Use the exact quote id (UUID) in quoteIds. Use the same ids in final_answer as [[quote:uuid]].
- For scalar slots: one value, key omitted. For list slots: one claim per list item, value = the item. For mapping slots: key = entity name, value = the mapping value.
- If evidence is insufficient for required slots, set next_action to "retrieve" or "expand_corpus" or "clarify".
- When suggestExpandWhenNoEvidence is true (dynamic sources), prefer next_action "expand_corpus" with why describing what kind of page might help when evidence does not support the required slots—instead of "retrieve" again.
- When all required slots are filled and you can answer, set next_action to "answer" and include "final_answer" with [[quote:uuid]] placeholders. Also include "cited_snippets" with each cited quote id mapped to the exact verbatim passage you are citing (one sentence or short passage from the evidence).`;

export async function callExtractAndDecide(
  apiKey: string,
  slots: SlotRow[],
  quotes: QuoteWithId[],
  currentSlotItemsSummary: string,
  userMessage: string,
  suggestExpandWhenNoEvidence = false,
): Promise<ExtractResult> {
  const quoteBlock = quotes
    .map((q) => `[${q.id}]\n${q.snippet.slice(0, 800)}${q.snippet.length > 800 ? '...' : ''}`)
    .join('\n\n---\n\n');
  const slotBlock = slots
    .map((s) => `- ${s.name} (${s.type})${s.description ? `: ${s.description}` : ''}`)
    .join('\n');

  const userContent = `Question: ${userMessage}

Slots to fill:
${slotBlock}

Current slot items (already extracted):
${currentSlotItemsSummary || '(none yet)'}

Evidence (quotes with ids — use these ids in quoteIds and in [[quote:id]] in final_answer):
---
${quoteBlock}
---
${suggestExpandWhenNoEvidence ? '\nThis conversation has dynamic sources (suggestExpandWhenNoEvidence=true). When evidence is insufficient to fill required slots, prefer next_action "expand_corpus" with why describing what kind of page might help, instead of "retrieve".' : ''}

Output JSON with claims, next_action, why, optional final_answer, and optional subqueries (when next_action is retrieve).`;

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
  const quoteIdSet = new Set(quotes.map((q) => q.id));
  const claims: ExtractClaim[] = claimsRaw
    .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
    .map((c) => {
      const quoteIds = Array.isArray(c.quoteIds)
        ? (c.quoteIds as unknown[]).filter((id): id is string => typeof id === 'string' && quoteIdSet.has(id))
        : [];
      return {
        slot: String(c.slot ?? ''),
        value: c.value !== undefined ? c.value : '',
        key: typeof c.key === 'string' ? c.key : undefined,
        confidence: typeof c.confidence === 'number' ? c.confidence : 1,
        quoteIds,
      };
    })
    .filter((c) => c.slot && c.quoteIds.length > 0);

  let cited_snippets: Record<string, string> | undefined;
  if (obj.cited_snippets != null && typeof obj.cited_snippets === 'object' && !Array.isArray(obj.cited_snippets)) {
    cited_snippets = {};
    for (const [id, passage] of Object.entries(obj.cited_snippets)) {
      if (quoteIdSet.has(id) && typeof passage === 'string' && passage.trim().length > 0) {
        cited_snippets[id] = passage.trim();
      }
    }
    if (Object.keys(cited_snippets).length === 0) cited_snippets = undefined;
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
  };
}

/**
 * Insert claims as slot_items and claim_evidence. Dedupes by (slot_id, key, value_json).
 * Returns created slot_item ids (for callers that need them).
 */
export async function insertClaims(
  supabase: SupabaseClient,
  params: {
    slotIdByName: Map<string, string>;
    claims: ExtractClaim[];
    ownerId: string;
  },
): Promise<{ insertedSlotItemIds: string[] }> {
  const { slotIdByName, claims, ownerId } = params;
  const inserted: string[] = [];

  for (const claim of claims) {
    const slotId = slotIdByName.get(claim.slot);
    if (!slotId) continue;

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

    for (const quoteId of claim.quoteIds) {
      await supabase.from('claim_evidence').upsert(
        { slot_item_id: slotItemId, quote_id: quoteId, owner_id: ownerId },
        { onConflict: 'slot_item_id,quote_id', ignoreDuplicates: true },
      );
    }
  }

  return { insertedSlotItemIds: inserted };
}
