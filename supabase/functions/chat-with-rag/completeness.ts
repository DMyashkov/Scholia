import type { SlotType } from './types.ts';

export interface SlotForCompleteness {
  id: string;
  type: SlotType;
  required: boolean;
  depends_on_slot_id: string | null;
}

export interface SlotCompletenessMeta {
  target_item_count: number;
  finished_querying: boolean;
}

/**
 * Compute per-slot completeness score (0–1) for UI.
 * - Scalar: 1 if ≥1 slot_item, else 0.
 * - List/mapping with meta: target_item_count === 0 ? (finished_querying ? 1 : 0) : min(1, current_item_count / target_item_count).
 * - List/mapping without meta (fallback): list 1 if ≥1 item else 0; mapping count/expected.
 */
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
      if (meta.target_item_count === 0) return meta.finished_querying ? 1 : 0;
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

/**
 * Overall completeness: weighted average of required slot scores.
 * Mapping slots get weight 2, others weight 1.
 */
export function overallCompleteness(
  slots: SlotForCompleteness[],
  slotItemCountBySlotId: Map<string, number>,
  slotMetaBySlotId?: Map<string, SlotCompletenessMeta>,
): number {
  const required = slots.filter((s) => s.required);
  if (required.length === 0) return 1;
  let sum = 0;
  let weightSum = 0;
  for (const slot of required) {
    const w = slot.type === 'mapping' ? 2 : 1;
    sum += slotCompleteness(slot, slotItemCountBySlotId, slotMetaBySlotId) * w;
    weightSum += w;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}
