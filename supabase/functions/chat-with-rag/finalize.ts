


import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchWithTimeout } from './config.ts';
import type { PageRow, SourceRow } from './types.ts';
import type { QuoteOut } from './types.ts';
import {
  replaceCitationPlaceholders,
  attachQuotesToMessage,
  buildQuotesOut,
  updateQuoteContextFromPage,
} from './quotes.ts';
import { getLastMessages } from './chat.ts';

export interface SaveAnswerParams {
  supabase: SupabaseClient;
  conversationId: string;
  ownerId: string;
  finalAnswer: string;
  validQuoteIds: Set<string>;
  lastExtractResult: Record<string, unknown> | null;
  thoughtProcess: Record<string, unknown>;
  extractionGapsAccumulated: string[];
  iteration: number;
  appendToMessageId: string | undefined;
  scrapedPageDisplay: string | undefined;
  pageById: Map<string, PageRow>;
  sourceById: Map<string, SourceRow>;
}

export interface SaveAnswerResult {
  message: unknown;
  quotesOut: QuoteOut[];
}

export async function saveAssistantMessageWithQuotes(params: SaveAnswerParams): Promise<SaveAnswerResult> {
  const {
    supabase,
    conversationId,
    ownerId,
    finalAnswer,
    validQuoteIds,
    thoughtProcess,
    extractionGapsAccumulated,
    iteration,
    appendToMessageId,
    scrapedPageDisplay,
    pageById,
    sourceById,
  } = params;

  // Quotes are pre-created during extract steps. We just validate the IDs the LLM used,
  // replace placeholders with [N], then attach the pre-created quote rows to this message.
  const placeholderMatches = [...finalAnswer.matchAll(/\[\[quote:([^\]]+)\]\]/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  const placeholderUnique = [...new Set(placeholderMatches)];
  const { content, quoteIdsOrdered } = replaceCitationPlaceholders(finalAnswer, validQuoteIds);
  const droppedQuoteIds = placeholderUnique.filter((id) => !validQuoteIds.has(id));
  const dropped = droppedQuoteIds.map((id) => ({ id, reason: 'invalid_id (not in pre-created quote set)' }));

  const { data: assistantRow, error: msgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content,
      owner_id: ownerId,
      was_multi_step: iteration > 1,
      follows_message_id: appendToMessageId ?? null,
      scraped_page_display: scrapedPageDisplay ?? null,
      thought_process: {
        ...thoughtProcess,
        iterationCount: iteration,
        completeness: thoughtProcess.steps && Array.isArray(thoughtProcess.steps)
          ? thoughtProcess.steps[thoughtProcess.steps.length - 1]?.completeness
          : undefined,
        ...(extractionGapsAccumulated.length > 0 ? { extractionGaps: extractionGapsAccumulated } : {}),
        ...(thoughtProcess.partialAnswerNote ? { partialAnswerNote: thoughtProcess.partialAnswerNote } : {}),
        ...(droppedQuoteIds.length > 0 ? { droppedQuotes: droppedQuoteIds } : {}),
        quoteDiagnostics: {
          placeholdersFound: placeholderMatches.length,
          placeholdersUnique: placeholderUnique.length,
          verifiedQuotes: quoteIdsOrdered.length,
          ...(dropped.length > 0 ? { dropped: dropped.slice(0, 50) } : {}),
        },
      },
    })
    .select('*')
    .single();

  if (msgErr || !assistantRow) {
    throw new Error(msgErr?.message ?? 'Failed to save assistant message');
  }

  if (appendToMessageId) {
    await supabase.from('messages').update({ suggested_page: null }).eq('id', appendToMessageId);
  }

  // Attach the pre-created quote rows to this message.
  if (quoteIdsOrdered.length > 0) {
    await attachQuotesToMessage(supabase, assistantRow.id, quoteIdsOrdered);
  }

  const quotedPageIds = await (async () => {
    const { data: qlist } = await supabase.from('quotes').select('page_id').eq('message_id', assistantRow.id);
    return [...new Set((qlist ?? []).map((q: { page_id: string }) => q.page_id))];
  })();
  const { data: pagesWithContent = [] } = await supabase.from('pages').select('id, content').in('id', quotedPageIds);
  const pageContentById = new Map((pagesWithContent as { id: string; content: string | null }[]).map((p) => [p.id, p.content ?? '']));
  const { data: quoteRows } = await supabase
    .from('quotes')
    .select('id, page_id, snippet, page_title, page_path, domain, page_url, context_before, context_after')
    .eq('message_id', assistantRow.id)
    .order('citation_order', { ascending: true });
  const quoteRowsList = (quoteRows ?? []) as { id: string; page_id: string; snippet: string }[];
  for (const q of quoteRowsList) {
    const pageContent = pageContentById.get(q.page_id);
    if (pageContent) {
      await updateQuoteContextFromPage(supabase, q.id, q.snippet, pageContent);
    }
  }
  const quotesForOut = quoteRowsList.map((q) => ({ snippet: q.snippet, pageId: q.page_id }));
  const quotesOut = buildQuotesOut(conversationId, quotesForOut, pageById, sourceById, pageContentById);

  return { message: assistantRow, quotesOut };
}

export async function suggestConversationTitle(
  openaiKey: string,
  supabase: SupabaseClient,
  conversationId: string,
  userMessage: string,
  isFirstMessage: boolean,
): Promise<string | undefined> {
  if (!isFirstMessage) return undefined;
  const titleRes = await fetchWithTimeout('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'user', content: `Suggest a 3-6 word title for this conversation. Reply with only the title, no quotes.\n\nUser: ${userMessage.slice(0, 200)}` },
      ],
      max_tokens: 20,
    }),
  });
  if (!titleRes.ok) return undefined;
  const j = (await titleRes.json()) as { choices?: { message?: { content?: string } }[] };
  const t = j.choices?.[0]?.message?.content?.trim().slice(0, 80);
  if (!t) return undefined;
  await supabase.from('conversations').update({ title: t }).eq('id', conversationId);
  return t;
}