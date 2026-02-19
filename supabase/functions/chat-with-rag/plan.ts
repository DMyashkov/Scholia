import type { PlanResult, PlanSlot, PlanSubquery, SlotType } from './types.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';

const PLAN_SYSTEM = `You plan semantic search and evidence gathering for a question over indexed documents.

Output JSON only with this shape:
- action: "retrieve" | "clarify" | "answer"
- why: short reason for this action
- slots: array of { name, type, description?, required?, dependsOn? }
  - type is one of: "scalar" (one value), "list" (set of items), "mapping" (key->value per list item; use dependsOn: slot name of the list)
  - dependsOn: name of another slot that must have at least one value before this slot can be queried (e.g. mapping depends on list; or "archetype" slot depends on "loved_thing" scalar)
  - description: one short sentence for what this slot represents (helps extraction and UI)
- subqueries: array of { slot, query } — each query is a search phrase for the slot (slot = slot name string)

Rules:
- Start with action "retrieve" unless the question is ambiguous (then "clarify" with questions).
- Slots: identify what information is needed to answer (e.g. birth_date scalar, product_list list, region_per_product mapping with dependsOn product_list). Any slot can depend on another: use dependsOn whenever slot B cannot be filled until slot A has values.
- Subqueries
  - for scalar slots - 1–2 focused queries
  - for list slots - 1–2 broad discovery queries
  - for mapping slots - 1 broad mapping query`;

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
    }))
    .filter((s) => s.name.length > 0);
  const subqueriesRaw = Array.isArray(obj.subqueries) ? obj.subqueries : [];
  const subqueries: PlanSubquery[] = subqueriesRaw
    .filter((q): q is Record<string, unknown> => q != null && typeof q === 'object')
    .map((q) => ({
      slot: String(q.slot ?? ''),
      query: String(q.query ?? ''),
    }))
    .filter((q) => q.query.length > 0);

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
