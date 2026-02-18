import type { DecomposeResult } from './types.ts';
import { OPENAI_CHAT_MODEL } from './config.ts';
import { ROUND2_QUERIES_CAP } from './config.ts';

export async function decomposeAndReformulate(apiKey: string, userMessage: string): Promise<DecomposeResult> {
  const sys = `Plan semantic search for a question over indexed documents.

Single-step: Use multiple queries to cover the question—e.g. ["achievements", "earnings"] for "What were X's achievements and earnings?". Most questions need only this.

Multi-step (unfold): Use when the question has a dependency—you must first retrieve info from the docs to reformulate the search. Example: "From this children's book, what are the two things little Jake most loved? Then find their ancient archetype from this research paper." Here you must: (1) search the children's book for Jake's two loved things; (2) extract them; (3) search the research paper for archetype of each. The second search depends on what the first finds. Another: "List the offices X held, then for each find when elected" → first find offices, then search each for election date. Multi-step only when the question cannot be answered without first discovering something from the docs that enables a follow-up search.

Output JSON:
{"queries": ["q1","q2",...], "needsSecondRound": false}
If needsSecondRound true, add "round2": {"extractionPrompt":"...","queryInstructions":"..."}
Omit round2 when false.`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMessage },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI decompose: ${res.status}`);
  const raw = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { queries: [userMessage] };
  }
  const obj = parsed as Record<string, unknown>;
  const queries = Array.isArray(obj.queries) ? (obj.queries as unknown[]).filter((x): x is string => typeof x === 'string') : [userMessage];
  if (queries.length === 0) queries.push(userMessage);
  const r2 = obj.round2 as Record<string, unknown> | undefined;
  const getStr = (o: Record<string, unknown> | undefined, ...keys: string[]) => {
    if (!o) return undefined;
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return undefined;
  };
  const extractionPrompt = getStr(r2, 'extractionPrompt', 'extraction_prompt');
  const queryInstructions = getStr(r2, 'queryInstructions', 'query_instructions');
  const hasRound2 = obj.round2 && typeof obj.round2 === 'object' && extractionPrompt && queryInstructions;
  const needsSecondRound = obj.needsSecondRound === true && hasRound2;
  const round2 = needsSecondRound ? { extractionPrompt: extractionPrompt!, queryInstructions: queryInstructions! } : undefined;
  console.log('[RAG-2ROUND] decompose parsed:', { rawNeedsSecondRound: obj.needsSecondRound, hasRound2, needsSecondRound, hasExtractionPrompt: !!extractionPrompt, hasQueryInstructions: !!queryInstructions });
  return { queries, needsSecondRound: !!needsSecondRound, round2 };
}

export async function runExtraction(apiKey: string, context: string, extractionPrompt: string): Promise<Record<string, unknown>> {
  const truncated = context.length > 12000 ? context.slice(0, 12000) + '\n\n[...truncated]' : context;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You extract structured data. Output only valid JSON. No other text.' },
        { role: 'user', content: `Context:\n---\n${truncated}\n---\n\n${extractionPrompt}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI extraction: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const out = JSON.parse(content) as Record<string, unknown>;
    return typeof out === 'object' && out !== null ? out : {};
  } catch {
    return {};
  }
}

export async function buildRound2Queries(
  apiKey: string,
  userMessage: string,
  extracted: Record<string, unknown>,
  queryInstructions: string,
): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: OPENAI_CHAT_MODEL,
      messages: [
        {
          role: 'user',
          content: `User question: "${userMessage}"

Extracted data from round 1 context: ${JSON.stringify(extracted)}

Instructions for round 2 queries: ${queryInstructions}

Generate 3-${ROUND2_QUERIES_CAP} search queries (keyword-rich, for semantic search) to find the remaining evidence. Output JSON: {"queries": ["query1", "query2", ...]}`,
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI round2 queries: ${res.status}`);
  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? '{}';
  try {
    const out = JSON.parse(content) as { queries?: unknown[] };
    const q = Array.isArray(out.queries) ? out.queries.filter((x): x is string => typeof x === 'string').slice(0, ROUND2_QUERIES_CAP) : [];
    return q;
  } catch {
    return [];
  }
}
