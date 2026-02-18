import { OPENAI_EMBEDDING_MODEL } from './config.ts';

export async function embedBatch(apiKey: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embed: ${res.status}`);
  const data = (await res.json()) as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}
