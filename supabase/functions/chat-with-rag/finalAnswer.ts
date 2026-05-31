



import type { SupabaseClient } from '@supabase/supabase-js';
import { OPENAI_CHAT_MODEL, fetchWithTimeout } from './config.ts';

export interface FinalAnswerResult {
  final_answer: string;
  cited_snippets: Record<string, string>;
  debug?: { request?: string; responseRaw?: string };
}



const FINAL_ANSWER_SYSTEM = `You write the final answer to the user's question from extracted slot state data.

Output JSON only:
{ "final_answer": "your formatted answer with [cite:slot:key] citation markers from the citation table" }

Rules:
- Write from the slot state provided. Do not add facts not present in the slot state.
- The citation table lists [cite:slot_name:key] markers for mapping/list slots and [cite:slot_name] for scalar slots.
- For each entity you write about, copy its cite marker verbatim from the citation table and append it at the end of that entity's line.
- If the key in the table is long (up to 40 chars) you may shorten it by keeping a unique prefix followed by "..." — e.g. [cite:отглеждане:СИНОР...] — but never change the slot_name part.
- If no citation is listed for a value or entity, write it without any citation marker — never invent a marker.
- Do NOT renumber or reorder the markers. Copy the exact slot_name and key from the table.
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
${quoteRefTable ? `\nCitation table — copy each [cite:slot_name:key] marker verbatim to the matching entity's line:\n${quoteRefTable}\n` : ''}
Output JSON with "final_answer".`;
  const requestDebug = `SYSTEM:\n${FINAL_ANSWER_SYSTEM}\n\nUSER:\n${userContent}`;

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
  const responseRaw = raw.choices?.[0]?.message?.content ?? '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseRaw);
  } catch {
    return {
      final_answer: "I couldn't format the answer from the evidence. Here's what was found in the sources.",
      cited_snippets: {},
      debug: { request: requestDebug.slice(0, 20000), responseRaw: responseRaw.slice(0, 20000) },
    };
  }
  const obj = parsed as Record<string, unknown>;
  const final_answer = typeof obj.final_answer === 'string' && obj.final_answer.trim().length > 0
    ? obj.final_answer.trim()
    : "I couldn't find enough in the sources to answer fully.";
  return {
    final_answer,
    cited_snippets: {},
    debug: { request: requestDebug.slice(0, 20000), responseRaw: responseRaw.slice(0, 20000) },
  };
}