import type { SlotType } from './types.ts';

export interface SlotForCompleteness {
  id: string;
  type: SlotType;
  required: boolean;
  depends_on_slot_id: string | null;
}

/**
 * Compute per-slot completeness score (0–1).
 * - Scalar: 1 if ≥1 slot_item with evidence, else 0.
 * - List: 1 if ≥1 slot_item (simplified; "stable" can be added later via itemsAddedThisIteration).
 * - Mapping: filled_count / expected_count (expected = item count of depends_on list slot).
 */
export function slotCompleteness(
  slot: SlotForCompleteness,
  slotItemCountBySlotId: Map<string, number>,
): number {
  // If this slot depends on another slot, it cannot be complete until the parent has at least one item.
  if (slot.depends_on_slot_id) {
    const parentCount = slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0;
    if (parentCount === 0) return 0;
  }

  const count = slotItemCountBySlotId.get(slot.id) ?? 0;
  if (slot.type === 'scalar') {
    return count >= 1 ? 1 : 0;
  }
  if (slot.type === 'list') {
    return count >= 1 ? 1 : 0;
  }
  if (slot.type === 'mapping' && slot.depends_on_slot_id) {
    const expected = slotItemCountBySlotId.get(slot.depends_on_slot_id) ?? 0;
    if (expected === 0) return 0;
    return Math.min(1, count / expected);
  }
  return 0;
}

/**
 * Overall completeness: weighted average of required slot scores.
 * Mapping slots get weight 2, others weight 1 (plan: "mapping slot weight 2 each").
 */
export function overallCompleteness(
  slots: SlotForCompleteness[],
  slotItemCountBySlotId: Map<string, number>,
): number {
  const required = slots.filter((s) => s.required);
  if (required.length === 0) return 1;
  let sum = 0;
  let weightSum = 0;
  for (const slot of required) {
    const w = slot.type === 'mapping' ? 2 : 1;
    sum += slotCompleteness(slot, slotItemCountBySlotId) * w;
    weightSum += w;
  }
  return weightSum > 0 ? sum / weightSum : 0;
}
