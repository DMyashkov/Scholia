import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChunkRow, PageRow, SourceRow } from './types.ts';
import type { PlanResult, PlanSlot, PlanSubquery } from './types.ts';
import type { RagContext, RagContextReady, RagContextNoPages, RagContextError, SlotDb } from './types.ts';

export type SubqueryDb = { id: string; reasoning_step_id: string; slot_id: string; query_text: string };

export interface LoadRagBody {
  conversationId: string;
  userMessage: string;
  rootMessageId?: string;
  appendToMessageId?: string;
  scrapedPageDisplay?: string;
}

export async function loadRagContext(
  supabase: SupabaseClient,
  body: LoadRagBody,
  userId: string,
): Promise<RagContext> {
  const { conversationId, userMessage, rootMessageId: bodyRootMessageId, appendToMessageId } = body;

  const { data: conv } = await supabase
    .from('conversations')
    .select('owner_id, dynamic_mode')
    .eq('id', conversationId)
    .single();
  if (!conv) {
    return { kind: 'error', error: 'Conversation not found' };
  }
  const ownerId = (conv as { owner_id?: string }).owner_id ?? userId;
  const dynamicMode = (conv as { dynamic_mode?: boolean }).dynamic_mode !== false;

  const { data: sources } = await supabase
    .from('sources')
    .select('id')
    .eq('conversation_id', conversationId);
  const sourceIds = (sources ?? []).map((s: { id: string }) => s.id);

  const { data: pagesData, error: pagesError } =
    sourceIds.length > 0
      ? await supabase
          .from('pages')
          .select('id, source_id, title, path, url')
          .in('source_id', sourceIds)
          .eq('status', 'indexed')
      : { data: [] as PageRow[], error: null };
  const pages = (pagesData ?? []) as PageRow[];

  if (pagesError || !pages?.length) {
    const content = !pages?.length
      ? "I don't have any indexed sources for this conversation yet. Add a source and run a crawl, then ask again."
      : "I couldn't load the source pages. Please try again.";
    return { kind: 'noPages', conversationId, ownerId, content };
  }

  const pageIds = pages.map((p) => p.id);
  const pageById = new Map<string, PageRow>(pages.map((p) => [p.id, p]));
  const { data: sourceRows } = await supabase
    .from('sources')
    .select('id, domain')
    .in('id', [...new Set(pages.map((p) => p.source_id))]);
  const sourceById = new Map<string, SourceRow>(((sourceRows || []) as SourceRow[]).map((s) => [s.id, s]));
  const sourceDomainByPageId = new Map<string, string>();
  for (const p of pages) {
    const src = sourceById.get(p.source_id);
    sourceDomainByPageId.set(p.id, src?.domain ?? (p.url ? new URL(p.url).hostname : ''));
  }

  const { data: leadChunks = [] } = await supabase.rpc('get_lead_chunks', { match_page_ids: pageIds });
  const leadList = (leadChunks || []) as ChunkRow[];

  let rootMessageId: string;
  if (appendToMessageId) {
    const { data: assistantMsg } = await supabase
      .from('messages')
      .select('id, created_at')
      .eq('id', appendToMessageId)
      .single();
    if (!assistantMsg) {
      return { kind: 'error', error: 'appendToMessageId message not found' };
    }
    const prevCreated = (assistantMsg as { created_at?: string }).created_at;
    const { data: prevList } = await supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .lt('created_at', prevCreated ?? new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1);
    const prev = (prevList ?? []) as { id: string }[];
    if (!prev.length) {
      return { kind: 'error', error: 'Could not resolve root message for append' };
    }
    rootMessageId = prev[0].id;
  } else if (bodyRootMessageId) {
    rootMessageId = bodyRootMessageId;
  } else {
    // In the current app flow, the frontend always creates the user message
    // and passes its id as rootMessageId. Reaching this branch means the
    // conversation/message state is inconsistent.
    return { kind: 'error', error: 'Root message missing; conversation may be corrupted' };
  }

  let slots: SlotDb[] = [];
  let slotIdByName = new Map<string, string>();
  let planResult: PlanResult | null = null;
  const expansionCount = appendToMessageId ? 1 : 0;

  if (appendToMessageId) {
    const { data: slotRows } = await supabase
      .from('slots')
      .select('id, name, type, description, required, depends_on_slot_id')
      .eq('root_message_id', rootMessageId);
    slots = (slotRows ?? []) as SlotDb[];
    slotIdByName = new Map(slots.map((s) => [s.name, s.id]));
    const { data: firstStep } = await supabase
      .from('reasoning_steps')
      .select('id')
      .eq('root_message_id', rootMessageId)
      .eq('action', 'retrieve')
      .order('iteration_number', { ascending: true })
      .limit(1)
      .single();
    if (firstStep?.id) {
      const { data: subq } = await supabase
        .from('reasoning_subqueries')
        .select('id, reasoning_step_id, slot_id, query_text')
        .eq('reasoning_step_id', firstStep.id);
      const subqueries = (subq ?? []) as SubqueryDb[];
      const names = new Map(slots.map((s) => [s.id, s.name]));
      const queryTexts = subqueries.map((r) => r.query_text).filter(Boolean);
      planResult = {
        action: 'retrieve',
        why: 'Reusing plan after corpus expansion',
        slots: slots.map((s) => ({
          name: s.name,
          type: s.type as PlanSlot['type'],
          description: s.description ?? undefined,
          required: s.required,
          dependsOn: s.depends_on_slot_id ? slots.find((x) => x.id === s.depends_on_slot_id)?.name : undefined,
        })),
        subqueries: queryTexts.length > 0
          ? subqueries.map((r) => ({ slot: names.get(r.slot_id) ?? '', query: r.query_text }))
          : [{ slot: 'answer', query: userMessage.trim().slice(0, 200) }],
      };
    }
  }

  const ctx: RagContextReady = {
    kind: 'ready',
    conversationId,
    ownerId,
    userMessage: userMessage.trim(),
    dynamicMode,
    sourceIds,
    pages,
    pageIds,
    pageById,
    sourceById,
    sourceDomainByPageId,
    leadChunks: leadList,
    rootMessageId,
    slots,
    slotIdByName,
    planResult,
    expansionCount,
    appendToMessageId,
    scrapedPageDisplay: body.scrapedPageDisplay,
  };
  return ctx;
}
