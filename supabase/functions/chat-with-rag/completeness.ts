import type { SlotType } from './types.ts';

export interface SlotForCompleteness {
  id: string;
  type: SlotType;
  depends_on_slot_id: string | null;
}

export interface SlotCompletenessMeta {
  target_item_count: number;
  finished_querying: boolean;
}







export function slotCompleteness(
  slot: SlotForCompleteness,
  slotItemCountBySlotId: Map<string, number>,
  slotMetaBySlotId?: Map<string, SlotCompletenessMeta>,
): number {
  if (slot.depends_on_slot_id) {
    const parentCount = slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0;
    if (parentCount === 0) return 0;
  }

  const count = slotItemCountBySlotId.get(slot.id) ?? 0;
  if (slot.type === 'scalar') {
    return count >= 1 ? 1 : 0;
  }
  const meta = slotMetaBySlotId?.get(slot.id);
  if (slot.type === 'list' || slot.type === 'mapping') {
    if (meta != null) {
      if (meta.target_item_count === 0) return count >= 1 ? 1 : 0;
      return Math.min(1, count / meta.target_item_count);
    }
    if (slot.type === 'list') return count >= 1 ? 1 : 0;
    if (slot.type === 'mapping' && slot.depends_on_slot_id) {
      const expected = slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0;
      if (expected === 0) return 0;
      return Math.min(1, count / expected);
    }
  }
  return 0;
}





export function overallCompleteness(
  slots: SlotForCompleteness[],
  slotItemCountBySlotId: Map<string, number>,
  slotMetaBySlotId?: Map<string, SlotCompletenessMeta>,
): number {
  if (slots.length === 0) return 1;
  let sum = 0;
  let weightSum = 0;
  for (const slot of slots) {
    const w = slot.type === 'mapping' ? 2 : 1;
    sum += slotCompleteness(slot, slotItemCountBySlotId, slotMetaBySlotId) * w;
    weightSum += w;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}