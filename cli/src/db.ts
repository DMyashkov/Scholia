import type { SupabaseClient } from '@supabase/supabase-js';

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  was_multi_step: boolean;
}

export interface Source {
  id: string;
  conversation_id: string;
  initial_url: string;
  domain: string;
  created_at: string;
}

export interface CrawlJob {
  id: string;
  source_id: string;
  status: string;
  indexed_count: number | null;
}

export async function listConversations(
  client: SupabaseClient,
  limit = 20,
): Promise<Conversation[]> {
  const { data, error } = await client
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`listConversations: ${error.message}`);
  return (data ?? []) as Conversation[];
}

export async function getConversationByName(
  client: SupabaseClient,
  name: string,
): Promise<Conversation | null> {
  const { data, error } = await client
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .ilike('title', `%${name}%`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as Conversation;
}

export async function getConversation(
  client: SupabaseClient,
  id: string,
): Promise<Conversation | null> {
  const { data, error } = await client
    .from('conversations')
    .select('id, title, created_at, updated_at')
    .eq('id', id)
    .single();
  if (error) return null;
  return data as Conversation;
}

export async function listMessages(
  client: SupabaseClient,
  conversationId: string,
  limit = 30,
): Promise<Message[]> {
  const { data, error } = await client
    .from('messages')
    .select('id, conversation_id, role, content, created_at, was_multi_step')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`listMessages: ${error.message}`);
  return (data ?? []) as Message[];
}

export async function insertUserMessage(
  client: SupabaseClient,
  conversationId: string,
  content: string,
): Promise<Message> {
  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content: content.trim(),
      was_multi_step: false,
    })
    .select('id, conversation_id, role, content, created_at, was_multi_step')
    .single();
  if (error) throw new Error(`insertUserMessage: ${error.message}`);
  return data as Message;
}

export async function deleteMessagesFrom(
  client: SupabaseClient,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const { data: msg, error: fetchErr } = await client
    .from('messages')
    .select('created_at')
    .eq('id', messageId)
    .single();
  if (fetchErr || !msg) throw fetchErr ?? new Error('Message not found');
  const { error } = await client
    .from('messages')
    .delete()
    .eq('conversation_id', conversationId)
    .gte('created_at', (msg as { created_at: string }).created_at);
  if (error) throw new Error(`deleteMessagesFrom: ${error.message}`);
}

export async function listSources(
  client: SupabaseClient,
  conversationId: string,
): Promise<Source[]> {
  const { data, error } = await client
    .from('sources')
    .select('id, conversation_id, initial_url, domain, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`listSources: ${error.message}`);
  return (data ?? []) as Source[];
}

export async function listCrawlJobsForSources(
  client: SupabaseClient,
  sourceIds: string[],
): Promise<CrawlJob[]> {
  if (sourceIds.length === 0) return [];
  const { data, error } = await client
    .from('crawl_jobs')
    .select('id, source_id, status, indexed_count')
    .in('source_id', sourceIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`listCrawlJobsForSources: ${error.message}`);
  // Return only the latest job per source
  const seen = new Set<string>();
  const out: CrawlJob[] = [];
  for (const row of (data ?? []) as CrawlJob[]) {
    if (!seen.has(row.source_id)) {
      seen.add(row.source_id);
      out.push(row);
    }
  }
  return out;
}

export async function createConversation(
  client: SupabaseClient,
  title: string,
): Promise<Conversation> {
  const { data, error } = await client
    .from('conversations')
    .insert({ title })
    .select('id, title, created_at, updated_at')
    .single();
  if (error) throw new Error(`createConversation: ${error.message}`);
  return data as Conversation;
}
