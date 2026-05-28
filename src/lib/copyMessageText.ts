import type { Message, SlotSnapshotEntry, ThoughtProcess } from '@/types/chat';
import type { Quote } from '@/types/source';

export type CopyFormat = 'plain' | 'evidence' | 'debug';

export const COPY_FORMAT_STORAGE_KEY = 'scholia-copy-format';

export function isCopyFormat(value: string | null): value is CopyFormat {
  return value === 'plain' || value === 'evidence' || value === 'debug';
}

export function copyFormatFromLegacy(includeEvidence: boolean): CopyFormat {
  return includeEvidence ? 'evidence' : 'plain';
}

export function getStoredCopyFormat(): CopyFormat | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem(COPY_FORMAT_STORAGE_KEY);
  return isCopyFormat(v) ? v : null;
}

export function setStoredCopyFormat(format: CopyFormat): void {
  localStorage.setItem(COPY_FORMAT_STORAGE_KEY, format);
}

export function stripCitations(content: string): string {
  return content
    .replace(/\s*\[\d+\]\s*/g, ' ')
    .replace(/  +/g, ' ')
    .replace(/ +([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildCopyWithEvidence(content: string, quotes: Quote[]): string {
  let out = content;
  if (quotes.length > 0) {
    const refLines: string[] = ['\n\nReferences:'];
    for (let i = 0; i < quotes.length; i++) {
      const q = quotes[i];
      const num = i + 1;
      const url = q.pageUrl ?? `https://${q.domain}${q.pagePath}`;
      refLines.push(`[${num}] "${q.snippet}" — ${q.pageTitle} (${url})`);
    }
    out += refLines.join('\n');
  }
  return out;
}

function formatSnapshotValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatSlotSnapshot(snapshot: Record<string, SlotSnapshotEntry>): string[] {
  const lines: string[] = [];
  for (const [name, entry] of Object.entries(snapshot)) {
    lines.push(`  ${name} (${entry.type}):`);
    if (entry.type === 'scalar') {
      const v = entry.items[0]?.value;
      lines.push(`    ${entry.items.length === 0 ? '(empty)' : formatSnapshotValue(v)}`);
    } else if (entry.type === 'mapping') {
      if (entry.items.length === 0) lines.push('    (no pairs)');
      for (const item of entry.items) {
        lines.push(`    ${item.key ?? '—'}: ${formatSnapshotValue(item.value)}`);
      }
    } else {
      if (entry.items.length === 0) lines.push('    (no items)');
      for (const item of entry.items) {
        lines.push(`    - ${formatSnapshotValue(item.value)}`);
      }
    }
  }
  return lines;
}

export function buildThoughtProcessSection(tp: ThoughtProcess | null | undefined): string {
  if (!tp) return '';

  const hasContent =
    Boolean(tp.planReason) ||
    (tp.slots?.length ?? 0) > 0 ||
    (tp.steps?.length ?? 0) > 0 ||
    (tp.slotFillSummary?.length ?? 0) > 0 ||
    Boolean(tp.hardStopReason) ||
    Boolean(tp.partialAnswerNote) ||
    (tp.extractionGaps?.length ?? 0) > 0 ||
    Boolean(tp.expandCorpusReason) ||
    (tp.clarifyQuestions?.length ?? 0) > 0;

  if (!hasContent) return '';

  const lines: string[] = ['\n\n---\n\n## Reasoning (debug)\n'];

  if (tp.planReason) {
    lines.push('\n### Plan\n', tp.planReason, '');
  }

  if (tp.slots && tp.slots.length > 0) {
    lines.push('\n### Looking for\n');
    for (const s of tp.slots) {
      const parts = [`- **${s.name}** (${s.type})`];
      if (s.description) parts.push(` — ${s.description}`);
      if (s.dependsOn) parts.push(` ↳ depends on ${s.dependsOn}`);
      if (s.type === 'list' && s.targetItemCount != null && s.targetItemCount > 0) {
        parts.push(` · target ${s.targetItemCount}`);
      }
      if (s.type === 'mapping' && s.itemsPerKey != null) {
        parts.push(s.itemsPerKey === 0 ? ' · key coverage' : ` · ${s.itemsPerKey}/key`);
      }
      lines.push(parts.join(''));
    }
  }

  if (tp.slotFillSummary && tp.slotFillSummary.length > 0) {
    lines.push('\n### Slot progress\n');
    lines.push('| Slot | Type | Target | Filled |');
    lines.push('| --- | --- | --- | --- |');
    for (const row of tp.slotFillSummary) {
      const target = row.type === 'scalar' ? '1' : row.target == null || row.target <= 0 ? '—' : String(row.target);
      lines.push(`| ${row.name} | ${row.type} | ${target} | ${row.filled} |`);
    }
  }

  if (tp.steps && tp.steps.length > 0) {
    lines.push('\n### Steps\n');
    for (const step of tp.steps) {
      lines.push(`\n#### Step ${step.iter} (${step.action})`);
      if (step.completeness != null) {
        lines.push(`- Completeness: ${Math.round(step.completeness * 100)}%`);
      }
      if (step.why) lines.push(`- Why: ${step.why}`);
      if (step.nextAction) lines.push(`- Next: ${step.nextAction}`);
      if (step.subqueries?.length) {
        lines.push('- Subqueries:');
        for (const sq of step.subqueries) {
          const strat =
            sq.strategy === 'broad' || sq.strategy === 'targeted'
              ? ` (${sq.strategy})`
              : sq.query.includes(' for ')
                ? ' (targeted)'
                : '';
          lines.push(`  - [${sq.slot || '?'}]${strat} "${sq.query}"`);
        }
      }
      if (step.statements?.length) {
        lines.push('- Statements:');
        for (const stmt of step.statements) {
          lines.push(`  - ${stmt}`);
        }
      }
      if (step.fillStatusBySlot && Object.keys(step.fillStatusBySlot).length > 0) {
        lines.push(
          `- Fill: ${Object.entries(step.fillStatusBySlot)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`,
        );
      }
      if (step.quotesFound != null) lines.push(`- Chunks retrieved: ${step.quotesFound}`);
      if (step.claims?.length) {
        lines.push('- Claims:');
        lines.push('```json');
        lines.push(JSON.stringify(step.claims, null, 2));
        lines.push('```');
      }
      if (step.slotSnapshot && Object.keys(step.slotSnapshot).length > 0) {
        lines.push('- Slot snapshot:');
        lines.push(...formatSlotSnapshot(step.slotSnapshot));
      }
    }
  }

  if (tp.completeness != null) {
    lines.push(`\n### Overall completeness: ${Math.round(tp.completeness * 100)}%`);
  }
  if (tp.iterationCount != null) {
    lines.push(`### Iterations: ${tp.iterationCount}`);
  }
  if (tp.hardStopReason) lines.push(`\n### Hard stop\n${tp.hardStopReason}`);
  if (tp.partialAnswerNote) lines.push(`\n### Partial answer note\n${tp.partialAnswerNote}`);
  if (tp.expandCorpusReason) lines.push(`\n### Expand corpus\n${tp.expandCorpusReason}`);
  if (tp.extractionGaps?.length) {
    lines.push(`\n### Extraction gaps\n${tp.extractionGaps.join('; ')}`);
  }
  if (tp.clarifyQuestions?.length) {
    lines.push('\n### Clarify questions\n');
    for (const q of tp.clarifyQuestions) lines.push(`- ${q}`);
  }

  return lines.join('\n');
}

export function buildMessageCopyText(
  message: Pick<Message, 'content' | 'quotes' | 'thoughtProcess'>,
  format: CopyFormat,
): string {
  const quotes = message.quotes ?? [];
  const base =
    format === 'plain'
      ? stripCitations(message.content)
      : buildCopyWithEvidence(message.content, quotes);

  if (format !== 'debug') return base;

  const reasoning = buildThoughtProcessSection(message.thoughtProcess);
  if (!reasoning) {
    return `${base}\n\n---\n\n## Reasoning (debug)\n\n(No thought process stored for this message.)`;
  }
  return base + reasoning;
}
