import type { PlanResult, PlanSlot, PlanSubquery, SlotType } from './types.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';

const PLAN_SYSTEM = `You plan semantic search and evidence gathering for a question over indexed documents.

Output JSON only with this shape:
- why: short reason for this action
- slots: array of slot objects. Fields: name, type, description?, required?, dependsOn?, target_item_count? (list), items_per_key? (mapping only).
  - type is one of: "scalar" (one value), "list" (set of items), "mapping" (key->value per list item; use dependsOn: slot name of the list)

  - dependsOn: slot whose extracted values are required to build this slot’s query. 
  Use only when independent querying can't be meaningfully done without those values. (mapping always depends on a list)

  - description: one short sentence for what this slot represents (helps extraction and UI)
  
  - target_item_count: for list slots only. Set to the number of items the user asked for (e.g. "top 5 products" -> 5). 
  Set to 0 if the user did not specify a concrete number. Omit or 0 for scalar/mapping.

  - items_per_key: (mapping only) Values per key (e.g. "top 2 achievements per product" -> 2). Backend: target = dependency target_item_count × items_per_key. Include in slots array for every mapping slot.

- subqueries: array of { slot, query } — only for slots that have no dependencies (omit dependsOn). 
Each query is a search phrase for the slot. Do not include subqueries for mapping slots or any slot that dependsOn another; those are run later once dependencies are filled.

Rules:
- Start with action "retrieve" unless the question is ambiguous (then "clarify" with questions).
- Subqueries: only for slots with no dependencies (scalars and lists that do not dependOn another slot). 
For scalar slots use 1–2 focused queries. For list slots use 1–2 high-level discovery (BROAD) queries (e.g. "company product list", "Biden major achievements").`;

export async function callPlan(apiKey: string, userMessage: string): Promise<PlanResult> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI plan: ${res.status}`);
  const raw = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return fallbackPlan(userMessage);
  }
  const obj = parsed as Record<string, unknown>;
  const action = ['retrieve', 'clarify', 'answer'].includes(String(obj.action))
    ? (obj.action as PlanResult['action'])
    : 'retrieve';
  const why = typeof obj.why === 'string' ? obj.why : undefined;
  const slotsRaw = Array.isArray(obj.slots) ? obj.slots : [];
  const slots: PlanSlot[] = slotsRaw
    .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object')
    .map((s) => ({
      name: String(s.name ?? ''),
      type: ['scalar', 'list', 'mapping'].includes(String(s.type)) ? (s.type as SlotType) : 'scalar',
      description: typeof s.description === 'string' ? s.description : undefined,
      required: s.required !== false,
      dependsOn: typeof s.dependsOn === 'string' ? s.dependsOn : undefined,
      target_item_count: typeof s.target_item_count === 'number' && Number.isInteger(s.target_item_count) && s.target_item_count >= 0 ? s.target_item_count : undefined,
      items_per_key: typeof s.items_per_key === 'number' && Number.isInteger(s.items_per_key) && s.items_per_key >= 1 ? s.items_per_key : undefined,
    }))
    .filter((s) => s.name.length > 0);
  const slotNamesWithNoDeps = new Set(slots.filter((s) => !s.dependsOn).map((s) => s.name));
  const subqueriesRaw = Array.isArray(obj.subqueries) ? obj.subqueries : [];
  const subqueries: PlanSubquery[] = subqueriesRaw
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .map((q) => ({
      slot: String(q.slot ?? ''),
      query: String(q.query ?? ''),
    }))
    .filter((q) => q.query.length > 0 && slotNamesWithNoDeps.has(q.slot));

  return { action, why, slots: slots.length > 0 ? slots : [{ name: 'answer', type: 'scalar', required: true }], subqueries };
}

function fallbackPlan(userMessage: string): PlanResult {
  return {
    action: 'retrieve',
    why: 'Fallback after parse error',
    slots: [{ name: 'answer', type: 'scalar', description: 'Information needed to answer the question', required: true }],
    subqueries: [{ slot: 'answer', query: userMessage.trim().slice(0, 200) }],
  };
}
