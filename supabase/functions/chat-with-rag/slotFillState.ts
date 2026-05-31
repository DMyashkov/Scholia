import type { SlotDb } from './types.ts';
import { SLOT_RETRIEVAL_RULES } from './prompts.ts';
import { normalizeSlotEntityString, slotValueDedupKey, splitListEntityValues } from './utils.ts';

export type SlotItemRow = {
  slot_id: string;
  key: string | null;
  value_json: unknown;
};

export type SlotFillStatus = {
  slotId: string;
  name: string;
  type: string;
  filled: number;
  effectiveTarget: number;
  atTarget: boolean;
  dependsOnName?: string;
  parentFilled: number;
  parentSatisfied: boolean;
  parentChangedThisStep: boolean;
  parentPreview: string[];
  listValues: string[];
  filledKeys: string[];
  unfilledKeys: string[];
  broadQueriesAttempted: string[];
  needsBroad: boolean;
  needsTargeted: boolean;
};

export function getEffectiveTarget(
  slot: SlotDb,
  counts: Map<string, number>,
  slotsById?: Map<string, SlotDb>,
): number {
  if (slot.type === 'scalar') return 1;
  if (slot.type === 'list') return slot.target_item_count ?? 0;
  if (slot.type === 'mapping' && slot.depends_on_slot_id) {
    const parentCount = counts.get(slot.depends_on_slot_id) ?? 0;
    const perKey = slot.items_per_key ?? 0;
    if (perKey >= 1) return parentCount * perKey;
    const parent = slotsById?.get(slot.depends_on_slot_id);
    const listTarget = parent?.target_item_count ?? 0;
    return listTarget > 0 ? listTarget : parentCount;
  }
  return 0;
}

function valueToLabel(valueJson: unknown): string {
  if (typeof valueJson === 'string') return valueJson;
  if (valueJson == null) return '';
  return String(valueJson);
}

function isNonEmptyValue(valueJson: unknown): boolean {
  if (valueJson == null) return false;
  if (typeof valueJson === 'string') return valueJson.trim().length > 0;
  return true;
}

export function groupItemsBySlotId(
  items: SlotItemRow[],
): Map<string, SlotItemRow[]> {
  const map = new Map<string, SlotItemRow[]>();
  for (const row of items) {
    const list = map.get(row.slot_id) ?? [];
    list.push(row);
    map.set(row.slot_id, list);
  }
  return map;
}

export function countFilledBySlotId(
  slots: SlotDb[],
  itemsBySlotId: Map<string, SlotItemRow[]>,
): Map<string, number> {
  const countBySlot = new Map<string, number>();
  for (const s of slots) countBySlot.set(s.id, 0);

  for (const slot of slots) {
    const rows = itemsBySlotId.get(slot.id) ?? [];
    if (slot.type === 'scalar') {
      countBySlot.set(slot.id, rows.some((r) => isNonEmptyValue(r.value_json)) ? 1 : 0);
      continue;
    }
    if (slot.type === 'list') {
      const set = new Set<string>();
      for (const r of rows) {
        const label = valueToLabel(r.value_json);
        for (const part of splitListEntityValues(label)) {
          set.add(slotValueDedupKey(part));
        }
      }
      countBySlot.set(slot.id, set.size);
      continue;
    }
    if (slot.type === 'mapping' && (slot.items_per_key ?? 0) === 0) {
      const keys = new Set<string>();
      for (const r of rows) {
        if (r.key != null && isNonEmptyValue(r.value_json)) keys.add(slotValueDedupKey(r.key));
      }
      countBySlot.set(slot.id, keys.size);
      continue;
    }
    countBySlot.set(slot.id, rows.length);
  }
  return countBySlot;
}

export function parentFingerprint(parentFilled: number, parentKeys: string[]): string {
  const sorted = [...parentKeys].map((k) => slotValueDedupKey(k)).sort();
  return `${parentFilled}|${sorted.join('\x1f')}`;
}

export const STAGNATION_STEPS_TO_FINISH = 2;

export type SlotQueryStrategy = 'broad' | 'targeted';

export type SlotStagnationTrack = {
  parentFingerprint: string | null;
  consecutiveStagnantBroadSteps: number;
  consecutiveStagnantTargetedSteps: number;
  
  stagnatedKeys: Set<string>;
};

export function createSlotStagnationTrack(): SlotStagnationTrack {
  return {
    parentFingerprint: null,
    consecutiveStagnantBroadSteps: 0,
    consecutiveStagnantTargetedSteps: 0,
    stagnatedKeys: new Set(),
  };
}

export function getRequiredStrategiesForMode(mode: SlotQueryMode): SlotQueryStrategy[] {
  switch (mode) {
    case 'broad_only':
      return ['broad'];
    case 'targeted_only':
      return ['targeted'];
    case 'broad_and_targeted':
      return ['broad', 'targeted'];
    default:
      return [];
  }
}

function strategiesUsedBySlot(
  subs: { slot: string; query: string }[],
  slotName: string,
  slot: SlotDb | undefined,
  fill: SlotFillStatus | undefined,
): Set<SlotQueryStrategy> {
  const used = new Set<SlotQueryStrategy>();
  for (const q of subs) {
    if (q.slot !== slotName) continue;
    const s = inferSubqueryStrategy(slot, fill, q.query);
    if (s) used.add(s);
  }
  return used;
}

export function pickDiversifiedBroadQuery(
  slot: SlotDb,
  fill: SlotFillStatus | undefined,
  seen: Set<string>,
): string | null {
  const base = (slot.description ?? slot.name).trim().replace(/\.+$/, '');
  const variants: string[] = [base];
  const prior = new Set(fill?.broadQueriesAttempted ?? []);
  const normalizeTokens = (s: string): string[] =>
    normalizeSlotEntityString(s)
      .toLowerCase()
      .split(/[^0-9\p{L}]+/gu)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  const isNearDuplicate = (a: string, b: string): boolean => {
    const ta = new Set(normalizeTokens(a));
    const tb = new Set(normalizeTokens(b));
    if (ta.size === 0 || tb.size === 0) return false;
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    const union = ta.size + tb.size - inter;
    const j = union > 0 ? inter / union : 0;
    return j >= 0.85;
  };
  for (const q of variants) {
    const trimmed = q.trim();
    if (!trimmed || prior.has(trimmed) || seen.has(`${slot.id}\0${trimmed}`)) continue;
    if ([...prior].some((p) => isNearDuplicate(p, trimmed))) continue;
    return trimmed;
  }
  return null;
}

function pickNewBroadQuery(
  slot: SlotDb,
  fill: SlotFillStatus | undefined,
  seen: Set<string>,
): string | null {
  return pickDiversifiedBroadQuery(slot, fill, seen);
}

export function ensureSubqueriesForSlotModes(
  subs: { slot: string; query: string }[],
  slots: SlotDb[],
  _slotIdByName: Map<string, string>,
  fillBySlotId: Map<string, SlotFillStatus>,
  seen: Set<string>,
): { slot: string; query: string }[] {
  const out = [...subs];

  for (const slot of slots) {
    if (slot.finished_querying) continue;
    const fill = fillBySlotId.get(slot.id);
    const mode = getSlotQueryMode(slot, fill);
    const required = getRequiredStrategiesForMode(mode);
    if (required.length === 0) continue;

    const used = strategiesUsedBySlot(out, slot.name, slot, fill);

    if (required.includes('broad') && !used.has('broad')) {
      const q = pickNewBroadQuery(slot, fill, seen);
      if (q) {
        out.push({ slot: slot.name, query: q });
        seen.add(`${slot.id}\0${q}`);
      }
    }

    if (required.includes('targeted') && !used.has('targeted')) {
      if (slot.type === 'mapping' && fill?.parentSatisfied) {
        const marker = '__map__';
        if (!seen.has(`${slot.id}\0${marker}`)) {
          out.push({ slot: slot.name, query: marker });
          seen.add(`${slot.id}\0${marker}`);
        }
      } else if (slot.type === 'scalar') {
        const q = pickNewBroadQuery(slot, fill, seen);
        if (q) {
          out.push({ slot: slot.name, query: q });
          seen.add(`${slot.id}\0${q}`);
        }
      }
    }
  }

  return out;
}

export function formatMappingKeyQuery(
  phrase: string,
  keyConnector: string | undefined,
  key: string,
): string {
  const p = phrase.trim();
  const k = key.trim();
  const c = (keyConnector ?? '').trim();
  if (!p) return c ? `${c} ${k}`.replace(/\s+/g, ' ').trim() : k;
  if (!c) return `${p} ${k}`.replace(/\s+/g, ' ').trim();
  return `${p} ${c} ${k}`.replace(/\s+/g, ' ').trim();
}

export function extractMappingKeyFromQuery(query: string, parentKeys: string[]): string | null {
  const qNorm = normalizeSlotEntityString(query);
  const sorted = [...parentKeys].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    const kNorm = normalizeSlotEntityString(key);
    if (qNorm === kNorm) return key;
    if (qNorm.length > kNorm.length && qNorm.endsWith(kNorm)) return key;
  }
  return null;
}

export function isMappingPerKeyQuery(query: string, parentKeys: string[]): boolean {
  if (parentKeys.length === 0) return false;
  if (countParentKeysInQuery(query, parentKeys) !== 1) return false;
  return extractMappingKeyFromQuery(query, parentKeys) != null;
}

export function countParentKeysInQuery(query: string, parentKeys: string[]): number {
  const q = normalizeSlotEntityString(query).toLowerCase();
  let hits = 0;
  for (const key of parentKeys) {
    const k = normalizeSlotEntityString(key).toLowerCase();
    if (k.length < 2) continue;
    if (q.includes(k)) hits++;
  }
  return hits;
}

export function getQueryableUnfilledKeys(unfilledKeys: string[], stagnatedKeys: Set<string>): string[] {
  return unfilledKeys.filter((k) => !stagnatedKeys.has(slotValueDedupKey(k)));
}

function getParentKeys(
  parentSlot: SlotDb | undefined,
  itemsBySlotId: Map<string, SlotItemRow[]>,
): string[] {
  if (!parentSlot) return [];
  const rows = itemsBySlotId.get(parentSlot.id) ?? [];
  if (parentSlot.type === 'scalar') {
    const labels = rows.map((r) => valueToLabel(r.value_json)).filter((s) => s.trim().length > 0);
    return labels.length > 0 ? [labels[0]!] : [];
  }
  if (parentSlot.type === 'list') {
    const set = new Set<string>();
    for (const r of rows) {
      const label = valueToLabel(r.value_json);
      for (const part of splitListEntityValues(label)) {
        if (part.trim()) set.add(part);
      }
    }
    return [...set];
  }
  return [];
}

function getMappingFilledKeys(rows: SlotItemRow[]): Set<string> {
  const filled = new Set<string>();
  for (const r of rows) {
    if (r.key == null || !isNonEmptyValue(r.value_json)) continue;
    filled.add(slotValueDedupKey(r.key));
  }
  return filled;
}

function getListValues(rows: SlotItemRow[]): string[] {
  const set = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const label = valueToLabel(r.value_json);
    for (const part of splitListEntityValues(label)) {
      const dk = slotValueDedupKey(part);
      if (set.has(dk)) continue;
      set.add(dk);
      out.push(part);
    }
  }
  return out;
}

export function computeSlotFillState(params: {
  slots: SlotDb[];
  itemsBySlotId: Map<string, SlotItemRow[]>;
  counts: Map<string, number>;
  lastParentFingerprintBySlotId: Map<string, string>;
  broadQueriesAttemptedBySlotId: Map<string, string[]>;
}): Map<string, SlotFillStatus> {
  const { slots, itemsBySlotId, counts, lastParentFingerprintBySlotId, broadQueriesAttemptedBySlotId } =
    params;
  const slotById = new Map(slots.map((s) => [s.id, s]));
  const result = new Map<string, SlotFillStatus>();

  for (const slot of slots) {
    const filled = counts.get(slot.id) ?? 0;
    const effectiveTarget = getEffectiveTarget(slot, counts, slotById);
    const atTarget = effectiveTarget > 0 && filled >= effectiveTarget;

    let parentFilled = 0;
    let parentSatisfied = false;
    let parentChangedThisStep = false;
    let parentPreview: string[] = [];
    let dependsOnName: string | undefined;
    const listValues = slot.type === 'list' ? getListValues(itemsBySlotId.get(slot.id) ?? []) : [];
    let filledKeys: string[] = [];
    let unfilledKeys: string[] = [];

    if (slot.depends_on_slot_id) {
      const parent = slotById.get(slot.depends_on_slot_id);
      dependsOnName = parent?.name;
      parentPreview = getParentKeys(parent, itemsBySlotId);
      parentFilled = counts.get(slot.depends_on_slot_id) ?? 0;
      parentSatisfied = parentFilled >= 1;
      const fp = parentFingerprint(parentFilled, parentPreview);
      const prev = lastParentFingerprintBySlotId.get(slot.id);
      parentChangedThisStep = parentSatisfied && (prev === undefined || prev !== fp);
    }

    if (slot.type === 'mapping' && slot.depends_on_slot_id) {
      const parent = slotById.get(slot.depends_on_slot_id);
      const parentKeys = getParentKeys(parent, itemsBySlotId);
      const filledSet = getMappingFilledKeys(itemsBySlotId.get(slot.id) ?? []);
      filledKeys = parentKeys.filter((k) => filledSet.has(slotValueDedupKey(k)));
      unfilledKeys = parentKeys.filter((k) => !filledSet.has(slotValueDedupKey(k)));
    }

    const broadQueriesAttempted = broadQueriesAttemptedBySlotId.get(slot.id) ?? [];
    let needsBroad = false;
    let needsTargeted = false;

    if (slot.finished_querying || atTarget) {
      needsBroad = false;
      needsTargeted = false;
    } else if (!slot.depends_on_slot_id) {
      if (slot.type === 'list') {
        needsBroad = effectiveTarget <= 0 || filled < effectiveTarget;
        needsTargeted = filled > 0 && effectiveTarget > 0 && filled < effectiveTarget;
      } else if (slot.type === 'scalar') {
        needsBroad = filled < 1;
      }
    } else {
      if (!parentSatisfied) {
        needsBroad = true;
        needsTargeted = false;
      } else {
        needsTargeted =
          slot.type === 'mapping'
            ? unfilledKeys.length > 0
            : slot.type === 'list'
              ? effectiveTarget <= 0 || filled < effectiveTarget
              : filled < 1;
        needsBroad = parentChangedThisStep;
      }
    }

    result.set(slot.id, {
      slotId: slot.id,
      name: slot.name,
      type: slot.type,
      filled,
      effectiveTarget,
      atTarget,
      dependsOnName,
      parentFilled,
      parentSatisfied,
      parentChangedThisStep,
      parentPreview,
      listValues,
      filledKeys,
      unfilledKeys,
      broadQueriesAttempted,
      needsBroad,
      needsTargeted,
    });
  }

  return result;
}

export function updateParentFingerprints(
  fillBySlotId: Map<string, SlotFillStatus>,
  slots: SlotDb[],
): Map<string, string> {
  const next = new Map<string, string>();
  for (const slot of slots) {
    if (!slot.depends_on_slot_id) continue;
    const fill = fillBySlotId.get(slot.id);
    if (!fill?.parentSatisfied) continue;
    next.set(
      slot.id,
      parentFingerprint(fill.parentFilled, fill.parentPreview),
    );
  }
  return next;
}

export type SlotQueryMode =
  | 'finished'
  | 'broad_only'
  | 'targeted_only'
  | 'broad_and_targeted'
  | 'none';

export function getSlotQueryMode(
  slot: SlotDb,
  fill: SlotFillStatus | undefined,
  track?: SlotStagnationTrack,
): SlotQueryMode {
  if (!fill || slot.finished_querying) return 'finished';
  if (!fill.needsBroad && !fill.needsTargeted) return 'none';

  if (slot.type === 'list') {
    const hasDependency = Boolean(slot.depends_on_slot_id);
    const hasAnyBroadAttempt = fill.broadQueriesAttempted.length > 0;
    const broadStagnant = (track?.consecutiveStagnantBroadSteps ?? 0) >= 1;

    if (!hasDependency) {
      if (!hasAnyBroadAttempt) return 'broad_only';
      if (fill.filled <= 0 && (track?.consecutiveStagnantBroadSteps ?? 0) >= STAGNATION_STEPS_TO_FINISH) return 'targeted_only';
      if (fill.filled <= 0) return 'broad_only';
      if (broadStagnant) return 'targeted_only';
      if (fill.effectiveTarget > 0 && fill.filled < fill.effectiveTarget) return 'broad_and_targeted';
    } else {
      if (!fill.parentSatisfied) return 'broad_only';
      if (fill.parentChangedThisStep) return 'broad_and_targeted';
      return 'targeted_only';
    }
  }

  if (fill.needsBroad && fill.needsTargeted) return 'broad_and_targeted';
  if (fill.needsBroad) return 'broad_only';
  return 'targeted_only';
}

function formatSlotQueryMode(mode: SlotQueryMode): string {
  switch (mode) {
    case 'finished':
      return 'finished — no subqueries';
    case 'broad_only':
      return 'BROAD only';
    case 'targeted_only':
      return 'TARGETED only';
    case 'broad_and_targeted':
      return 'BROAD + TARGETED';
    default:
      return 'no retrieval needed';
  }
}

export function buildQueryGuidance(
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
  stagnationBySlotId?: Map<string, SlotStagnationTrack>,
): string {
  const lines: string[] = [
    'Query guidance (authoritative for next retrieve subqueries):',
    SLOT_RETRIEVAL_RULES,
    '',
    'Per slot:',
  ];

  for (const slot of slots) {
    const fill = fillBySlotId.get(slot.id);
    if (!fill) continue;

    const mode = getSlotQueryMode(slot, fill, stagnationBySlotId?.get(slot.id));
    const progress =
      slot.type === 'mapping'
        ? `keys ${fill.filledKeys.length}/${fill.filledKeys.length + fill.unfilledKeys.length}`
        : fill.effectiveTarget > 0
          ? `${fill.filled}/${fill.effectiveTarget}`
          : `${fill.filled}`;
    const dep =
      fill.dependsOnName != null
        ? `depends on ${fill.dependsOnName} (${fill.parentFilled} items${fill.parentChangedThisStep ? ', updated this step' : ', stable'})`
        : 'no dependency';

    lines.push(`- [${fill.name}] (${slot.type}) ${progress} | ${dep} | ${formatSlotQueryMode(mode)}`);

    if (mode === 'targeted_only' || mode === 'broad_and_targeted') {
      if (slot.type === 'mapping' && fill.unfilledKeys.length > 0) {
        lines.push(
          `  unfilled_keys: ${JSON.stringify(fill.unfilledKeys.slice(0, 40))}${fill.unfilledKeys.length > 40 ? '...' : ''}`,
        );
      }
      if (slot.type === 'list') {
        lines.push('  targeted(list)=facets (4–5). Do not repeat broad with filler tokens; use materially different facets.');
      }
      if (slot.type !== 'mapping' && fill.parentSatisfied && fill.parentPreview.length > 0) {
        lines.push(
          `  dependency_values: ${JSON.stringify(fill.parentPreview.slice(0, 15))}${fill.parentPreview.length > 15 ? '...' : ''}`,
        );
      }
    }

    if (fill.broadQueriesAttempted.length > 0) {
      lines.push(
        `  prior broad (do not repeat): ${fill.broadQueriesAttempted.map((q) => `"${q}"`).join(', ')}`,
      );
    }
  }

  return lines.join('\n');
}

export function expandMapSubqueries(params: {
  slotName: string;
  slot: SlotDb;
  mapDescription?: string;
  keyConnector?: string;
  depSlot: SlotDb | undefined;
  fill: SlotFillStatus | undefined;
  parentItems: { value?: unknown; key?: string | null }[];
  stagnatedKeys?: Set<string>;
}): { slot: string; query: string }[] {
  const { slotName, slot, mapDescription, keyConnector, fill, parentItems, stagnatedKeys } = params;
  const phrase = mapDescription || slot.description || slotName;

  if (!fill?.parentSatisfied) {
    return [{ slot: slotName, query: phrase }];
  }

  const rawKeys = fill.unfilledKeys.length > 0
    ? fill.unfilledKeys
    : parentItems.map((item) =>
      typeof item.value === 'string'
        ? item.value
        : item.key != null
        ? String(item.key)
        : JSON.stringify(item.value)
    );

  const keys = getQueryableUnfilledKeys(rawKeys, stagnatedKeys ?? new Set());

  if (keys.length === 0) {
    return [{ slot: slotName, query: phrase }];
  }

  return keys.map((key) => ({
    slot: slotName,
    query: formatMappingKeyQuery(phrase, keyConnector, key),
  }));
}

export function filterSubqueriesForFilledKeys(
  subs: { slot: string; query: string }[],
  slotIdByName: Map<string, string>,
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
): { slot: string; query: string }[] {
  return subs.filter((q) => {
    const sid = slotIdByName.get(q.slot);
    if (!sid) return false;
    const slot = slots.find((s) => s.id === sid);
    const fill = fillBySlotId.get(sid);
    if (slot?.type !== 'mapping' || !fill?.parentSatisfied) return true;

    const parentKeys = [...fill.filledKeys, ...fill.unfilledKeys, ...fill.parentPreview];
    const matchedKey = extractMappingKeyFromQuery(q.query, parentKeys);
    if (matchedKey != null && fill.filledKeys.some((k) => slotValueDedupKey(k) === slotValueDedupKey(matchedKey))) {
      return false;
    }
    return true;
  });
}

export function filterSubqueriesForStagnatedKeys(
  subs: { slot: string; query: string }[],
  slotIdByName: Map<string, string>,
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
  stagnationBySlotId: Map<string, SlotStagnationTrack>,
): { slot: string; query: string }[] {
  return subs.filter((q) => {
    const sid = slotIdByName.get(q.slot);
    if (!sid) return false;
    const slot = slots.find((s) => s.id === sid);
    const fill = fillBySlotId.get(sid);
    const track = stagnationBySlotId.get(sid);
    if (slot?.type !== 'mapping' || !fill?.parentSatisfied || !track) return true;
    const matchedKey = extractMappingKeyFromQuery(q.query, fill.parentPreview);
    if (matchedKey == null) return true;
    return !track.stagnatedKeys.has(slotValueDedupKey(matchedKey));
  });
}

export function filterSubqueriesForUnknownMappingKeys(
  subs: { slot: string; query: string }[],
  slotIdByName: Map<string, string>,
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
): { slot: string; query: string }[] {
  return subs.filter((q) => {
    const sid = slotIdByName.get(q.slot);
    if (!sid) return false;
    const slot = slots.find((s) => s.id === sid);
    const fill = fillBySlotId.get(sid);
    if (slot?.type !== 'mapping' || !fill?.parentSatisfied) return true;

    const matchedKey = extractMappingKeyFromQuery(q.query, fill.parentPreview);
    if (matchedKey == null) return true;
    const parentKeys = new Set(fill.parentPreview.map((k) => slotValueDedupKey(k)));
    return parentKeys.has(slotValueDedupKey(matchedKey));
  });
}

export function filterMappingMegaQueries(
  subs: { slot: string; query: string }[],
  slotIdByName: Map<string, string>,
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
): { slot: string; query: string }[] {
  return subs.filter((q) => {
    if (q.query === '__map__') return true;
    const sid = slotIdByName.get(q.slot);
    if (!sid) return false;
    const slot = slots.find((s) => s.id === sid);
    const fill = fillBySlotId.get(sid);
    if (slot?.type !== 'mapping' || !fill?.parentSatisfied) return true;
    const parentKeys = fill.parentPreview;
    if (parentKeys.length === 0) return true;
    if (countParentKeysInQuery(q.query, parentKeys) >= 2) return false;
    if (!isMappingPerKeyQuery(q.query, parentKeys) && fill.needsTargeted && !fill.needsBroad) {
      return false;
    }
    return true;
  });
}

export function applySubqueryPriorityCaps(
  subs: { slot: string; query: string }[],
  slotIdByName: Map<string, string>,
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
  maxMappingPerIter: number,
): { slot: string; query: string }[] {
  const mappingSlotIds = slots.filter((s) => s.type === 'mapping').map((s) => s.id);
  const perSlotCap = mappingSlotIds.length > 0
    ? Math.max(1, Math.floor(maxMappingPerIter / mappingSlotIds.length))
    : maxMappingPerIter;

  const other: { slot: string; query: string }[] = [];
  const mappingPerKeyBySlotId = new Map<string, { slot: string; query: string }[]>();

  for (const q of subs) {
    const sid = slotIdByName.get(q.slot);
    const slot = sid ? slots.find((s) => s.id === sid) : undefined;
    const fill = sid ? fillBySlotId.get(sid) : undefined;
    const parentKeys = fill?.parentPreview ?? [];
    if (slot?.type === 'mapping' && sid && isMappingPerKeyQuery(q.query, parentKeys)) {
      const list = mappingPerKeyBySlotId.get(sid) ?? [];
      list.push(q);
      mappingPerKeyBySlotId.set(sid, list);
    } else {
      other.push(q);
    }
  }

  const cappedMapping: { slot: string; query: string }[] = [];
  for (const [, list] of mappingPerKeyBySlotId) {
    cappedMapping.push(...list.slice(0, perSlotCap));
  }

  return [...other, ...cappedMapping];
}

export function inferSubqueryStrategy(
  slot: SlotDb | undefined,
  fill: SlotFillStatus | undefined,
  query: string,
): 'broad' | 'targeted' | null {
  if (!slot || (slot.type !== 'list' && slot.type !== 'mapping')) return null;
  if (!fill) return slot.attempt_count > 0 ? 'targeted' : 'broad';
  const parentKeys = fill.parentPreview;
  if (slot.type === 'mapping' && fill.parentSatisfied && isMappingPerKeyQuery(query, parentKeys)) {
    return 'targeted';
  }
  if (fill.needsBroad && !isMappingPerKeyQuery(query, parentKeys)) return 'broad';
  if (!fill.parentSatisfied && slot.depends_on_slot_id) return 'broad';
  return 'targeted';
}

export function slotHasGuidedWorkRemaining(
  fill: SlotFillStatus | undefined,
  track?: SlotStagnationTrack,
  slot?: SlotDb,
): boolean {
  if (!fill || !slot) return false;
  if (slot.finished_querying) return false;
  const mode = getSlotQueryMode(slot, fill, track);
  if (mode === 'finished' || mode === 'none') return false;

  const required = getRequiredStrategiesForMode(mode);
  if (required.includes('broad') && (track?.consecutiveStagnantBroadSteps ?? 0) < STAGNATION_STEPS_TO_FINISH) {
    return true;
  }
  if (required.includes('targeted') && (track?.consecutiveStagnantTargetedSteps ?? 0) < STAGNATION_STEPS_TO_FINISH) {
    if (slot.type === 'mapping' && fill.parentSatisfied) {
      const stagnated = track?.stagnatedKeys ?? new Set();
      return getQueryableUnfilledKeys(fill.unfilledKeys, stagnated).length > 0;
    }
    return true;
  }
  return false;
}

export function updateSlotStagnationTrack(params: {
  slot: SlotDb;
  fill: SlotFillStatus | undefined;
  track: SlotStagnationTrack;
  hadSubqueriesThisStep: boolean;
  strategiesRun: Set<SlotQueryStrategy>;
  itemCountBefore: number;
  itemCountAfter: number;
}): { awakened: boolean; finishedByStagnation: boolean } {
  const { slot, fill, track, hadSubqueriesThisStep, strategiesRun, itemCountBefore, itemCountAfter } = params;

  const currentParentFp =
    fill && slot.depends_on_slot_id
      ? parentFingerprint(fill.parentFilled, fill.parentPreview)
      : null;

  if (
    currentParentFp != null &&
    track.parentFingerprint != null &&
    currentParentFp !== track.parentFingerprint
  ) {
    track.parentFingerprint = currentParentFp;
    track.consecutiveStagnantBroadSteps = 0;
    track.consecutiveStagnantTargetedSteps = 0;
    const currentKeySet = new Set(fill!.parentPreview.map((k) => slotValueDedupKey(k)));
    for (const dk of [...track.stagnatedKeys]) {
      if (!currentKeySet.has(dk)) track.stagnatedKeys.delete(dk);
    }
    return { awakened: true, finishedByStagnation: false };
  }

  if (currentParentFp != null) track.parentFingerprint = currentParentFp;

  const progressed = itemCountAfter > itemCountBefore;
  if (!hadSubqueriesThisStep) {
    return { awakened: false, finishedByStagnation: false };
  }

  if (progressed) {
    track.consecutiveStagnantBroadSteps = 0;
    track.consecutiveStagnantTargetedSteps = 0;
    return { awakened: false, finishedByStagnation: false };
  }

  const parentStable = fill ? !fill.parentChangedThisStep : true;

  if (parentStable) {
    if (strategiesRun.has('broad')) track.consecutiveStagnantBroadSteps += 1;
    else track.consecutiveStagnantBroadSteps = 0;

    if (strategiesRun.has('targeted')) track.consecutiveStagnantTargetedSteps += 1;
    else track.consecutiveStagnantTargetedSteps = 0;
  } else {
    track.consecutiveStagnantBroadSteps = strategiesRun.has('broad') ? 1 : 0;
    track.consecutiveStagnantTargetedSteps = strategiesRun.has('targeted') ? 1 : 0;
  }

  const mode = getSlotQueryMode(slot, fill);
  let finishedByStagnation = false;
  if (mode === 'broad_only' && track.consecutiveStagnantBroadSteps >= STAGNATION_STEPS_TO_FINISH) {
    finishedByStagnation = true;
  }
  if (mode === 'targeted_only' && track.consecutiveStagnantTargetedSteps >= STAGNATION_STEPS_TO_FINISH) {
    finishedByStagnation = true;
    if (slot.type === 'mapping' && fill) {
      for (const key of fill.unfilledKeys) {
        track.stagnatedKeys.add(slotValueDedupKey(key));
      }
    }
  }
  if (
    mode === 'broad_and_targeted' &&
    track.consecutiveStagnantBroadSteps >= STAGNATION_STEPS_TO_FINISH &&
    track.consecutiveStagnantTargetedSteps >= STAGNATION_STEPS_TO_FINISH
  ) {
    finishedByStagnation = true;
  }

  return { awakened: false, finishedByStagnation };
}

export function slotShouldBeFinishedQuerying(
  slot: SlotDb,
  fill: SlotFillStatus | undefined,
  track: SlotStagnationTrack,
  itemCount: number,
): boolean {
  const effectiveTarget = fill?.effectiveTarget ?? 0;
  if (slot.type === 'list' && effectiveTarget > 0 && itemCount >= effectiveTarget) return true;
  if (slot.type === 'mapping' && fill?.parentSatisfied && fill.unfilledKeys.length === 0 && fill.atTarget) {
    return true;
  }
  if (slot.type === 'scalar' && itemCount >= 1) return true;

  const mode = getSlotQueryMode(slot, fill);
  if (mode === 'broad_only' && track.consecutiveStagnantBroadSteps >= STAGNATION_STEPS_TO_FINISH) return true;
  if (mode === 'targeted_only' && track.consecutiveStagnantTargetedSteps >= STAGNATION_STEPS_TO_FINISH) {
    return true;
  }
  if (
    mode === 'broad_and_targeted' &&
    track.consecutiveStagnantBroadSteps >= STAGNATION_STEPS_TO_FINISH &&
    track.consecutiveStagnantTargetedSteps >= STAGNATION_STEPS_TO_FINISH
  ) {
    return true;
  }
  return false;
}

export function prepareRunnableSubqueries(params: {
  subsInput: { slot: string; query: string; map_description?: string; key_connector?: string }[];
  slots: SlotDb[];
  slotIdByName: Map<string, string>;
  fillBySlotId: Map<string, SlotFillStatus>;
  stagnationBySlotId: Map<string, SlotStagnationTrack>;
  slotItemCountBySlotId: Map<string, number>;
  getParentItems: (depSlotName: string) => { value?: unknown; key?: string | null }[];
  maxMappingPerIter: number;
  maxPerIter: number;
  skipQuery?: (slotId: string, query: string) => boolean;
}): { runnable: { slot: string; query: string }[]; dropped: { slot: string; query: string; reason: string }[] } {
  const {
    subsInput,
    slots,
    slotIdByName,
    fillBySlotId,
    stagnationBySlotId,
    slotItemCountBySlotId,
    getParentItems,
    maxMappingPerIter,
    maxPerIter,
    skipQuery,
  } = params;

  const dropped: { slot: string; query: string; reason: string }[] = [];
  const normalizeQueryForDedup = (q: string): string => {
    if (q === '__map__') return '__map__';
    return normalizeSlotEntityString(q).replace(/\s+/g, ' ').trim().toLowerCase();
  };
  const dedup = (list: { slot: string; query: string }[], reason: string): { slot: string; query: string }[] => {
    const seen = new Set<string>();
    const out: { slot: string; query: string }[] = [];
    for (const q of list) {
      const sid = slotIdByName.get(q.slot) ?? '';
      const key = `${sid}\0${normalizeQueryForDedup(q.query)}`;
      if (seen.has(key)) {
        dropped.push({ slot: q.slot, query: q.query, reason });
        continue;
      }
      seen.add(key);
      out.push(q);
    }
    return out;
  };

  const expandPass = (input: typeof subsInput): { slot: string; query: string }[] => {
    const out: { slot: string; query: string }[] = [];
    for (const q of input) {
      if (q.query !== '__map__') {
        if (typeof q.query === 'string' && q.query.includes('__map__')) {
          dropped.push({ slot: q.slot, query: q.query, reason: 'invalid_map_syntax (use query="__map__" with map_description/key_connector)' });
          continue;
        }
        const sid2 = slotIdByName.get(q.slot) ?? '';
        if (skipQuery && skipQuery(sid2, q.query)) {
          dropped.push({ slot: q.slot, query: q.query, reason: 'already_run_in_prior_step' });
          continue;
        }
        out.push({ slot: q.slot, query: q.query });
        continue;
      }
      const sid = slotIdByName.get(q.slot);
      const slot = sid ? slots.find((s) => s.id === sid) : null;
      if (!slot || slot.type !== 'mapping' || !slot.depends_on_slot_id || !sid) {
        out.push({ slot: q.slot, query: q.map_description || q.slot });
        continue;
      }
      const depSlot = slots.find((s) => s.id === slot.depends_on_slot_id);
      const fill = fillBySlotId.get(sid);
      const depItems = depSlot ? getParentItems(depSlot.name) : [];
      const expanded = expandMapSubqueries({
        slotName: q.slot,
        slot,
        mapDescription: q.map_description,
        keyConnector: q.key_connector,
        depSlot,
        fill,
        parentItems: depItems,
        stagnatedKeys: stagnationBySlotId.get(sid)?.stagnatedKeys,
      });
      for (const eq of expanded) {
        if (skipQuery && skipQuery(sid, eq.query)) {
          dropped.push({ slot: eq.slot, query: eq.query, reason: 'already_run_in_prior_step' });
          continue;
        }
        out.push(eq);
      }
    }
    return out;
  };

  let subs = expandPass(subsInput);
  subs = dedup(subs, 'duplicate_after_expand');

  subs = subs.filter((q) => {
    const sid = slotIdByName.get(q.slot);
    if (!sid) return false;
    const slot = slots.find((s) => s.id === sid);
    if (!slot || slot.finished_querying) return false;
    const count = slotItemCountBySlotId.get(slot.id) ?? 0;
    if (slot.type === 'scalar' && count >= 1) return false;
    return true;
  });
  subs = filterSubqueriesForFilledKeys(subs, slotIdByName, slots, fillBySlotId);
  subs = filterSubqueriesForUnknownMappingKeys(subs, slotIdByName, slots, fillBySlotId);
  subs = filterSubqueriesForStagnatedKeys(subs, slotIdByName, slots, fillBySlotId, stagnationBySlotId);
  subs = filterMappingMegaQueries(subs, slotIdByName, slots, fillBySlotId);
  subs = dedup(subs, 'duplicate_after_filters');

  const seen = new Set<string>();
  for (const q of subs) {
    const sid = slotIdByName.get(q.slot);
    if (sid) seen.add(`${sid}\0${q.query}`);
  }
  subs = ensureSubqueriesForSlotModes(subs, slots, slotIdByName, fillBySlotId, seen);
  subs = dedup(subs, 'duplicate_after_ensure_modes');

  const withMapMarkers = subs.filter((q) => q.query === '__map__');
  const withoutMarkers = subs.filter((q) => q.query !== '__map__');
  const reExpanded = expandPass(
    withMapMarkers.map((q) => {
      const slot = slots.find((s) => s.name === q.slot);
      return {
        slot: q.slot,
        query: '__map__' as const,
        map_description: slot?.name ?? slot?.description ?? q.slot,
      };
    }),
  );
  subs = [...withoutMarkers, ...reExpanded];
  subs = dedup(subs, 'duplicate_after_reexpand');

  subs = filterSubqueriesForFilledKeys(subs, slotIdByName, slots, fillBySlotId);
  subs = filterSubqueriesForUnknownMappingKeys(subs, slotIdByName, slots, fillBySlotId);
  subs = filterSubqueriesForStagnatedKeys(subs, slotIdByName, slots, fillBySlotId, stagnationBySlotId);
  subs = filterMappingMegaQueries(subs, slotIdByName, slots, fillBySlotId);
  subs = applySubqueryPriorityCaps(subs, slotIdByName, slots, fillBySlotId, maxMappingPerIter);
  subs = dedup(subs, 'duplicate_after_caps');

  const runnable = subs.slice(0, maxPerIter);
  return { runnable, dropped };
}

export function anySlotHasGuidedWork(
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
  stagnationBySlotId: Map<string, SlotStagnationTrack>,
): boolean {
  return slots.some((s) => {
    if (s.finished_querying) return false;
    return slotHasGuidedWorkRemaining(fillBySlotId.get(s.id), stagnationBySlotId.get(s.id), s);
  });
}

export function buildRecoverySubqueries(
  slots: SlotDb[],
  fillBySlotId: Map<string, SlotFillStatus>,
  seen: Set<string>,
): { slot: string; query: string }[] {
  const out: { slot: string; query: string }[] = [];

  for (const slot of slots) {
    if (slot.finished_querying) continue;
    const fill = fillBySlotId.get(slot.id);
    if (!slotHasGuidedWorkRemaining(fill, undefined, slot)) continue;

    const mode = getSlotQueryMode(slot, fill);
    if (mode === 'broad_only' || mode === 'broad_and_targeted') {
      const q = pickDiversifiedBroadQuery(slot, fill, seen);
      if (q) out.push({ slot: slot.name, query: q });
    }

    if (slot.type === 'mapping' && (mode === 'targeted_only' || mode === 'broad_and_targeted') && fill!.unfilledKeys.length > 0) {
      const marker = '__map__';
      if (!seen.has(`${slot.id}\0${marker}`)) {
        out.push({ slot: slot.name, query: marker });
      }
    }

  }

  return out;
}
