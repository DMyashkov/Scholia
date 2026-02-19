/**
 * Insert single assistant messages for RAG responses (no-pages, clarify, expand_corpus, hard-stop).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SuggestedPage } from './expand.ts';

export async function insertNoPagesMessage(
  supabase: SupabaseClient,
  conversationId: string,
  ownerId: string,
  content: string,
): Promise<{ data: unknown; error: Error | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role: 'assistant', content, owner_id: ownerId })
    .select('*');
  if (error) return { data: null, error: error as Error };
  return { data: Array.isArray(data) ? data[0] : data, error: null };
}

export async function insertClarifyMessage(
  supabase: SupabaseClient,
  conversationId: string,
  ownerId: string,
  content: string,
  thoughtProcess: Record<string, unknown>,
  questions: unknown,
): Promise<{ data: unknown; error: Error | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: 'I need a bit more detail to answer well:\n\n' + content,
      owner_id: ownerId,
      thought_process: { ...thoughtProcess, clarifyQuestions: questions },
    })
    .select('*')
    .single();
  return { data: data ?? null, error: error as Error | null };
}

export async function insertExpandCorpusMessage(
  supabase: SupabaseClient,
  conversationId: string,
  ownerId: string,
  stubContent: string,
  thoughtProcess: Record<string, unknown>,
  expandCorpusWhy: string | undefined,
  suggestedPage: SuggestedPage | null,
): Promise<{ data: unknown; error: Error | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: stubContent,
      owner_id: ownerId,
      suggested_page: suggestedPage ?? undefined,
      thought_process: { ...thoughtProcess, expandCorpusReason: expandCorpusWhy, planReason: thoughtProcess.planReason },
    })
    .select('*')
    .single();
  return { data: data ?? null, error: error as Error | null };
}

export async function insertRetrieveHardStopMessage(
  supabase: SupabaseClient,
  conversationId: string,
  ownerId: string,
  content: string,
  thoughtProcess: Record<string, unknown>,
  suggestedPage: SuggestedPage | null,
): Promise<{ data: unknown; error: Error | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content,
      owner_id: ownerId,
      suggested_page: suggestedPage ?? undefined,
      thought_process: { ...thoughtProcess, expandCorpusReason: thoughtProcess.expandCorpusReason },
    })
    .select('*')
    .single();
  return { data: data ?? null, error: error as Error | null };
}
