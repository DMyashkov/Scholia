import type { PlanResult, PlanSlot, PlanSubquery, SlotType } from './types.ts';
import { OPENAI_CHAT_MODEL, fetchWithTimeout } from './config.ts';
import { buildPlanUserMessage } from './corpusContext.ts';
import { PLAN_SYSTEM } from './prompts.ts';
import type { CorpusLanguage } from './language.ts';
import { formatCorpusLanguageLine, looksLikeLanguageMismatch } from './language.ts';

export async function callPlan(
  apiKey: string,
  userMessage: string,
  corpusContext = '',
  corpusLanguage?: CorpusLanguage,
  _didRetryForLanguage = false,
): Promise<PlanResult> {
  const langLine = corpusLanguage ? `${formatCorpusLanguageLine(corpusLanguage)}\n` : '';
  const userPrompt = `${langLine}${buildPlanUserMessage(userMessage, corpusContext)}`;
  const res = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: PLAN_SYSTEM },
        { role: 'user', content: userPrompt },
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
      dependsOn: typeof s.dependsOn === 'string' ? s.dependsOn : undefined,
      target_item_count: typeof s.target_item_count === 'number' && Number.isInteger(s.target_item_count) && s.target_item_count >= 0 ? s.target_item_count : undefined,
      items_per_key: typeof s.items_per_key === 'number' && Number.isInteger(s.items_per_key) && s.items_per_key >= 0 ? s.items_per_key : undefined,
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

  const result: PlanResult = { action, why, slots: slots.length > 0 ? slots : [{ name: 'answer', type: 'scalar' }], subqueries };

      if (corpusLanguage && corpusLanguage.code !== 'und' && !_didRetryForLanguage) {
    const allStrings = [
      ...result.slots.map((s) => s.name),
      ...result.slots.map((s) => s.description ?? ''),
      ...result.subqueries.map((q) => q.query),
    ].filter(Boolean);
    const mismatchCount = allStrings.filter((s) => looksLikeLanguageMismatch(s, corpusLanguage)).length;
    if (mismatchCount >= Math.max(2, Math.floor(allStrings.length * 0.5))) {
      const retry = await callPlan(apiKey, userMessage, corpusContext, corpusLanguage, true);
      return retry;
    }
  }

  return result;
}

function fallbackPlan(userMessage: string): PlanResult {
  return {
    action: 'retrieve',
    why: 'Fallback after parse error',
    slots: [{ name: 'answer', type: 'scalar', description: 'Information needed to answer the question' }],
    subqueries: [{ slot: 'answer', query: userMessage.trim().slice(0, 200) }],
  };
}