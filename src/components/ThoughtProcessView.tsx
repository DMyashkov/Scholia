import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, CheckCircle2, AlertCircle, Info, Search, Circle, XCircle, FilePlus } from 'lucide-react';
import type {
  SlotFillSummaryRow,
  SlotSnapshotEntry,
  StepClaim,
  ThoughtProcess,
  ThoughtProcessSlot,
  ThoughtProcessSubquery,
  DroppedClaimInfo,
  DroppedSubqueryInfo,
} from '@/types/chat';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function inferSubqueryStrategy(sq: ThoughtProcessSubquery): 'broad' | 'targeted' | undefined {
  if (sq.strategy === 'broad' || sq.strategy === 'targeted') return sq.strategy;
  if (sq.query.includes(' for ')) return 'targeted';
  return undefined;
}

function SubqueryStrategyBadge({ strategy }: { strategy: 'broad' | 'targeted' }) {
  const isBroad = strategy === 'broad';
  return (
    <span
      className={cn(
        'shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1 py-px rounded border',
        isBroad
          ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/25'
          : 'bg-amber-500/10 text-amber-800 dark:text-amber-200 border-amber-500/25',
      )}
      title={isBroad ? 'Broad discovery query' : 'Targeted query (slot- or key-specific)'}
    >
      {isBroad ? 'broad' : 'targeted'}
    </span>
  );
}

function DroppedClaimsBlock({ dropped }: { dropped: DroppedClaimInfo[] }) {
  if (dropped.length === 0) return null;
  return (
    <details className="rounded-lg border border-destructive/25 bg-destructive/5 text-[11px]">
      <summary className="cursor-pointer px-3 py-2 text-destructive/80 font-medium">
        Dropped claims ({dropped.length})
      </summary>
      <div className="px-3 pb-2.5 space-y-2">
        {dropped.slice(0, 50).map((d, i) => (
          <div key={i} className="rounded border border-border/40 bg-background/50 px-2 py-1.5">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
              <span className="font-semibold text-foreground/85">{d.slot}</span>
              {d.key && <span className="text-muted-foreground">· key: {d.key}</span>}
            </div>
            {d.value && (
              <div className="text-muted-foreground font-mono whitespace-pre-wrap leading-snug mt-0.5">
                {d.value}
              </div>
            )}
            <div className="text-destructive/80 mt-0.5">{d.reason}</div>
            {d.chunkIds?.length ? (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                chunks: {d.chunkIds.slice(0, 3).join(', ')}
                {d.chunkIds.length > 3 ? ` (+${d.chunkIds.length - 3} more)` : ''}
              </div>
            ) : null}
          </div>
        ))}
        {dropped.length > 50 && (
          <div className="text-[10px] text-muted-foreground">Showing first 50 dropped claims.</div>
        )}
      </div>
    </details>
  );
}

function DroppedSubqueriesBlock({ dropped }: { dropped: DroppedSubqueryInfo[] }) {
  if (dropped.length === 0) return null;
  return (
    <details className="rounded-lg border border-border/50 bg-muted/20 text-[11px]">
      <summary className="cursor-pointer px-3 py-2 text-muted-foreground font-medium">
        Dropped subqueries ({dropped.length})
      </summary>
      <div className="px-3 pb-2.5 space-y-2">
        {dropped.slice(0, 50).map((d, i) => (
          <div key={i} className="rounded border border-border/40 bg-background/50 px-2 py-1.5">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
              <span className="font-semibold text-foreground/85">{d.slot}</span>
              <span className="text-muted-foreground font-mono whitespace-pre-wrap leading-snug">{d.query}</span>
            </div>
            <div className="text-muted-foreground mt-0.5">{d.reason}</div>
          </div>
        ))}
        {dropped.length > 50 && (
          <div className="text-[10px] text-muted-foreground">Showing first 50 dropped subqueries.</div>
        )}
      </div>
    </details>
  );
}

function DroppedQuotesBlock({
  droppedQuotes,
  quoteDiagnostics,
}: {
  droppedQuotes?: string[];
  quoteDiagnostics?: ThoughtProcess['quoteDiagnostics'];
}) {
  const dropped = quoteDiagnostics?.dropped ?? [];
  const ids = droppedQuotes ?? (dropped.length ? dropped.map((d) => d.id) : []);
  if (ids.length === 0) return null;
  return (
    <details className="rounded-lg border border-amber-500/25 bg-amber-500/5 text-[11px]">
      <summary className="cursor-pointer px-3 py-2 text-amber-800 dark:text-amber-200 font-medium">
        Dropped quotes ({ids.length})
        {quoteDiagnostics?.verifiedQuotes != null && quoteDiagnostics?.placeholdersUnique != null
          ? ` · kept ${quoteDiagnostics.verifiedQuotes}/${quoteDiagnostics.placeholdersUnique}`
          : ''}
      </summary>
      <div className="px-3 pb-2.5 space-y-2">
        {dropped.length ? (
          dropped.slice(0, 50).map((d, i) => (
            <div key={i} className="rounded border border-border/40 bg-background/50 px-2 py-1.5">
              <div className="font-mono text-[10px] text-muted-foreground break-all">{d.id}</div>
              <div className="text-amber-800/80 dark:text-amber-200/80 mt-0.5">{d.reason}</div>
            </div>
          ))
        ) : (
          <div className="text-muted-foreground">Quote placeholders were removed during verification.</div>
        )}
        {dropped.length > 50 && <div className="text-[10px] text-muted-foreground">Showing first 50.</div>}
      </div>
    </details>
  );
}

function formatSlotValue(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatTargetLabel(target: number | null, type: string): string {
  if (type === 'scalar') return '1';
  if (target == null || target <= 0) return '—';
  return String(target);
}


function targetPillLabelForSlot(slot: ThoughtProcessSlot): string | null {
  if (slot.type === 'list') {
    const n = slot.targetItemCount ?? 0;
    return n > 0 ? `target ${n}` : 'open target';
  }
  if (slot.type === 'mapping' && slot.itemsPerKey != null) {
    if (slot.itemsPerKey === 0) return 'key coverage';
    return `${slot.itemsPerKey}/key`;
  }
  return null;
}


function targetTooltipLineForSlot(slot: ThoughtProcessSlot): string | null {
  if (slot.type === 'list') {
    const n = slot.targetItemCount ?? 0;
    return n > 0 ? `Target: ${n}` : 'Target: open (no fixed count)';
  }
  if (slot.type === 'mapping' && slot.itemsPerKey != null) {
    return slot.itemsPerKey === 0 ? 'Mapping: key coverage (>=1 per key)' : `Mapping: ${slot.itemsPerKey} per key`;
  }
  return null;
}

function countFilledInSnapshot(entry: SlotSnapshotEntry, slotMeta?: ThoughtProcessSlot): number {
  if (entry.type === 'scalar') return entry.items.length > 0 ? 1 : 0;
  if (entry.type === 'mapping' && slotMeta?.itemsPerKey != null && slotMeta.itemsPerKey === 0) {
    const keys = entry.items
      .map((i) => i.key ?? null)
      .filter((k): k is string => k != null && String(k).trim().length > 0);
    return new Set(keys).size;
  }
  return entry.items.length;
}


function snapshotTargetForSlot(
  slotMeta: ThoughtProcessSlot,
  slots: ThoughtProcessSlot[],
  snapshot: Record<string, SlotSnapshotEntry>,
): number | null {
  if (slotMeta.type === 'scalar') return 1;
  if (slotMeta.type === 'list') {
    const n = slotMeta.targetItemCount ?? 0;
    return n > 0 ? n : null;
  }
  if (slotMeta.type === 'mapping' && slotMeta.dependsOn && slotMeta.itemsPerKey != null) {
    const parent = snapshot[slotMeta.dependsOn];
    const parentMeta = slots.find((s) => s.name === slotMeta.dependsOn);
    const parentFilled = parent ? countFilledInSnapshot(parent, parentMeta) : 0;
    if (parentFilled > 0) return slotMeta.itemsPerKey === 0 ? parentFilled : parentFilled * slotMeta.itemsPerKey;
    const parentPlanTarget = parentMeta?.targetItemCount ?? 0;
    if (parentPlanTarget > 0) return slotMeta.itemsPerKey === 0 ? parentPlanTarget : parentPlanTarget * slotMeta.itemsPerKey;
    return null;
  }
  return null;
}

function formatSnapshotFillLabel(
  slotMeta: ThoughtProcessSlot | undefined,
  entry: SlotSnapshotEntry,
  slots: ThoughtProcessSlot[],
  snapshot: Record<string, SlotSnapshotEntry>,
): string {
  const filled = countFilledInSnapshot(entry, slotMeta);
  if (!slotMeta) return `${filled}`;
  const target = snapshotTargetForSlot(slotMeta, slots, snapshot);
  if (target != null && target > 0) return `${filled} / ${target}`;
  return `${filled}`;
}

function SlotFillSummaryTable({ rows }: { rows: SlotFillSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent border-border/50">
            <TableHead className="h-8 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Slot</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Type</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">Target</TableHead>
            <TableHead className="h-8 text-[10px] uppercase tracking-wider text-muted-foreground font-medium text-right">Filled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const met = row.target != null && row.target > 0 ? row.filled >= row.target : row.filled > 0;
            const partial = row.target != null && row.target > 0 && row.filled > 0 && row.filled < row.target;
            return (
              <TableRow key={row.name} className="border-border/40 hover:bg-muted/20">
                <TableCell className="py-2 text-xs font-medium text-foreground/90">{row.name}</TableCell>
                <TableCell className="py-2 text-[11px] text-muted-foreground">{row.type}</TableCell>
                <TableCell className="py-2 text-[11px] text-muted-foreground text-right tabular-nums">
                  {formatTargetLabel(row.target, row.type)}
                </TableCell>
                <TableCell
                  className={cn(
                    'py-2 text-[11px] text-right tabular-nums font-medium',
                    met ? 'text-primary' : partial ? 'text-foreground/80' : 'text-muted-foreground'
                  )}
                >
                  {row.filled}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function buildClaimSnippetLookup(claims: StepClaim[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of claims) {
    if (!c.cited_snippet) continue;
    const valStr = c.value == null ? '' : typeof c.value === 'string' ? c.value : JSON.stringify(c.value);
    const key = `${c.slot}\0${c.key ?? ''}\0${valStr}`;
    if (!map.has(key)) map.set(key, c.cited_snippet);
  }
  return map;
}

function claimSnippet(lookup: Map<string, string>, slotName: string, value: unknown, key?: string | null): string | undefined {
  const valStr = value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  return lookup.get(`${slotName}\0${key ?? ''}\0${valStr}`);
}

function SlotSnapshotBlock({
  snapshot,
  slots = [],
  claims = [],
}: {
  snapshot: Record<string, SlotSnapshotEntry>;
  slots?: ThoughtProcessSlot[];
  claims?: StepClaim[];
}) {
  const snippetLookup = buildClaimSnippetLookup(claims);
  const [open, setOpen] = useState(false);
  const entries = Object.entries(snapshot);
  if (entries.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/40 bg-muted/15">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted/25 transition-colors rounded-lg">
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Slot snapshot</span>
        <span className="text-[10px] text-muted-foreground/80">({entries.length} slots)</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-2.5 pt-0 space-y-2 border-t border-border/30">
        {entries.map(([name, entry]) => {
          const slotMeta = slots.find((s) => s.name === name);
          const fillLabel = formatSnapshotFillLabel(slotMeta, entry, slots, snapshot);
          return (
          <div key={name} className="text-xs">
            <p className="font-medium text-foreground/85 mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>{name}</span>
              <span className="text-muted-foreground font-normal">· {entry.type}</span>
              <span className="text-[10px] font-medium tabular-nums text-primary/90">{fillLabel}</span>
            </p>
            {entry.type === 'scalar' && (
              <div className="pl-2 border-l-2 border-border/60 text-muted-foreground">
                {entry.items.length === 0 ? (
                  <span className="italic">empty</span>
                ) : (() => {
                  const item = entry.items[0];
                  const snippet = claimSnippet(snippetLookup, name, item?.value);
                  return (
                    <div className="space-y-0.5">
                      <span>{formatSlotValue(item?.value)}</span>
                      {snippet && (
                        <p className="text-[10px] text-muted-foreground/70 italic leading-snug border-l border-border/40 pl-1.5 ml-0.5">
                          &ldquo;{snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet}&rdquo;
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
            {entry.type === 'list' && (
              <ul className="pl-2 border-l-2 border-border/60 space-y-1 text-muted-foreground">
                {entry.items.length === 0 ? (
                  <li className="italic">no items</li>
                ) : (
                  entry.items.map((item, i) => {
                    const snippet = claimSnippet(snippetLookup, name, item.value);
                    return (
                      <li key={i} className="leading-snug space-y-0.5">
                        <span>{formatSlotValue(item.value)}</span>
                        {snippet && (
                          <p className="text-[10px] text-muted-foreground/70 italic leading-snug border-l border-border/40 pl-1.5">
                            &ldquo;{snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet}&rdquo;
                          </p>
                        )}
                      </li>
                    );
                  })
                )}
              </ul>
            )}
            {entry.type === 'mapping' && (
              <div className="pl-2 border-l-2 border-border/60 space-y-1 text-muted-foreground font-mono text-[11px]">
                {entry.items.length === 0 ? (
                  <p className="italic font-sans">no pairs</p>
                ) : (
                  (() => {
                    const valuesByKey = new Map<string, unknown[]>();
                    for (const item of entry.items) {
                      const key = (item.key ?? '—').toString();
                      const arr = valuesByKey.get(key) ?? [];
                      arr.push(item.value);
                      valuesByKey.set(key, arr);
                    }
                    return Array.from(valuesByKey.entries()).map(([key, values]) => (
                      <div key={key} className="leading-snug">
                        <div className="flex flex-wrap gap-x-1.5 items-baseline">
                          <span className="text-foreground/75">{key}:</span>
                        </div>
                        <ul className="pl-4 list-disc space-y-0.5">
                          {values.map((v, i) => {
                            const snippet = claimSnippet(snippetLookup, name, v, key);
                            return (
                              <li key={i} className="space-y-0.5">
                                <span>{formatSlotValue(v)}</span>
                                {snippet && (
                                  <p className="text-[10px] text-muted-foreground/70 italic leading-snug border-l border-border/40 pl-1.5">
                                    &ldquo;{snippet.length > 120 ? snippet.slice(0, 120) + '…' : snippet}&rdquo;
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ));
                  })()
                )}
              </div>
            )}
            {entry.type !== 'scalar' && entry.type !== 'list' && entry.type !== 'mapping' && (
              <p className="text-muted-foreground pl-2 text-[11px]">{entry.items.length} item(s)</p>
            )}
          </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}


function nextActionLabel(nextAction: string): string {
  switch (nextAction) {
    case 'expand_corpus': return 'Suggest closest page from encoded discovered';
    case 'answer': return 'Answered from evidence';
    case 'retrieve': return 'Searched again';
    case 'clarify': return 'Asked for clarification';
    default: return nextAction;
  }
}


function outcomeLabel(tp: ThoughtProcess): string | null {
  const last = tp.steps?.[tp.steps.length - 1];
  const action = last?.nextAction;
  if (action === 'expand_corpus') return 'Suggested a page';
  if (action === 'answer') {
    if (tp.completeness != null && tp.completeness === 0) {
      return 'No evidence found in current pages';
    }
    return 'Answered from evidence';
  }
  if (action === 'retrieve') return 'Searched again';
  if (action === 'clarify') return 'Asked for clarification';
  return null;
}

function PhaseContent({
  tp,
  showBanner,
  suggestedPage,
  stacked,
  isLive,
}: {
  tp: ThoughtProcess;
  showBanner?: boolean;
  suggestedPage?: { title: string; url?: string; fromPageTitle?: string } | null;
  
  stacked?: 'first' | 'middle' | 'last';
  
  isLive?: boolean;
}) {
  const outcome = outcomeLabel(tp);
  const answeringFromEvidence = isLive && outcome === 'Answered from evidence';
  const hasStopOrNote = Boolean(tp.hardStopReason || tp.partialAnswerNote || (tp.extractionGaps?.length ?? 0) > 0 || tp.expandCorpusReason);

  const paddingClass =
    stacked === 'first' ? 'pt-4 pb-1.5' : stacked === 'last' ? 'pt-1.5 pb-4' : stacked === 'middle' ? 'pt-1.5 pb-1.5' : 'pt-4 pb-4';

  return (
    <div className={cn('px-4 space-y-7', paddingClass)}>
      {showBanner && tp.steps?.length ? (() => {
        const last = tp.steps[tp.steps.length - 1];
        const needMore = last?.nextAction === 'expand_corpus' || (tp.completeness != null && tp.completeness < 1);
        if (needMore) {
          return (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-amber-500/10 border border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Couldn&apos;t find enough evidence in current pages</span>
            </div>
          );
        }
        return null;
      })() : null}

      {tp.planReason && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">Plan</p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {/reusing plan/i.test(tp.planReason) ? 'Same question, with the new page in the corpus.' : tp.planReason}
          </p>
        </div>
      )}

      {tp.slotFillSummary && tp.slotFillSummary.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Slot progress</p>
          <SlotFillSummaryTable rows={tp.slotFillSummary} />
        </div>
      )}

      {tp.slots && tp.slots.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Looking for</p>
          <div className="flex flex-wrap gap-2">
            {tp.slots.map((s) => {
              const targetPill = targetPillLabelForSlot(s);
              const targetTooltip = targetTooltipLineForSlot(s);
              const tooltipBody = [
                s.description,
                s.dependsOn && `Depends on: ${s.dependsOn}`,
                targetTooltip,
              ]
                .filter(Boolean)
                .join('\n\n');
              const pill = (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-muted/40 text-muted-foreground border border-border/50 max-w-full">
                  <span className="font-medium text-foreground/80 shrink-0">{s.name}</span>
                  <span className="text-[10px] opacity-80 shrink-0">· {s.type}</span>
                  {s.type === 'list' && targetPill && (
                    <span className="text-[10px] shrink-0 text-primary/90 font-medium">{targetPill}</span>
                  )}
                  {s.dependsOn && (
                    <span className="text-[10px] truncate min-w-0 text-amber-600 dark:text-amber-400" title={`Depends on: ${s.dependsOn}`}>
                      ↳ {s.dependsOn}
                    </span>
                  )}
                </span>
              );
              return tooltipBody ? (
                <Tooltip key={s.name}>
                  <TooltipTrigger asChild>
                    <span className="cursor-help inline-flex max-w-full">{pill}</span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-foreground whitespace-pre-line">
                    {tooltipBody}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <span key={s.name} className="inline-flex max-w-full">{pill}</span>
              );
            })}
          </div>
        </div>
      )}

      {tp.steps && tp.steps.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Steps</p>
          <div className="space-y-3">
            {tp.steps.map((step, i) => {
              const filled = step.completeness != null && step.completeness >= 1;
              const partial = step.completeness != null && step.completeness > 0 && !filled;
              const stepIcon = filled ? CheckCircle2 : partial ? Circle : XCircle;
              const stepIconClass = filled
                ? 'text-primary bg-primary/10 border-primary/20'
                : partial
                  ? 'text-primary/70 bg-primary/5 border-primary/10'
                  : 'text-muted-foreground bg-muted/40 border-border';
              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 flex gap-3',
                    filled ? 'bg-primary/5 border-primary/20' : 'bg-muted/20 border-border/50'
                  )}
                >
                  <div className={cn('shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border', stepIconClass)}>
                    {React.createElement(stepIcon, { className: 'h-4 w-4' })}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground/90">Step {step.iter}</span>
                      {step.completeness != null && (
                        <span className="text-[11px] text-muted-foreground">{Math.round(step.completeness * 100)}%</span>
                      )}
                      {step.timingMs && (
                        <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums">
                          {step.timingMs.total >= 1000
                            ? `${(step.timingMs.total / 1000).toFixed(1)}s`
                            : `${step.timingMs.total}ms`}
                        </span>
                      )}
                    </div>
                    {step.timingMs && (
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/60 tabular-nums">
                        <span title="Retrieve (vector search)">
                          retrieve {step.timingMs.retrieve >= 1000 ? `${(step.timingMs.retrieve / 1000).toFixed(1)}s` : `${step.timingMs.retrieve}ms`}
                        </span>
                        <span title="Extract & decide (LLM call)">
                          extract {step.timingMs.extract >= 1000 ? `${(step.timingMs.extract / 1000).toFixed(1)}s` : `${step.timingMs.extract}ms`}
                        </span>
                        <span title="Quote creation (DB inserts)">
                          quotes {step.timingMs.quoteCreate >= 1000 ? `${(step.timingMs.quoteCreate / 1000).toFixed(1)}s` : `${step.timingMs.quoteCreate}ms`}
                        </span>
                      </div>
                    )}
                    {step.subqueries && step.subqueries.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-start">
                        {(() => {
                          const bySlot = new Map<
                            string,
                            { slotLabel: string; queries: { text: string; strategy?: 'broad' | 'targeted' }[] }
                          >();
                          for (const sq of step.subqueries ?? []) {
                            const slotLabel = (sq.slot ?? '').trim();
                            const key = slotLabel.length > 0 ? slotLabel : '__no_slot__';
                            const existing = bySlot.get(key) ?? { slotLabel, queries: [] };
                            existing.queries.push({
                              text: sq.query,
                              strategy: inferSubqueryStrategy(sq),
                            });
                            bySlot.set(key, existing);
                          }
                          return Array.from(bySlot.entries()).map(([slotKey, group]) => {
                            const hasSlot = slotKey !== '__no_slot__' && group.slotLabel.length > 0;
                            return (
                              <div key={slotKey} className="flex flex-col gap-1">
                                {hasSlot && (
                                  <div
                                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90"
                                    title={`Slot: ${group.slotLabel}`}
                                  >
                                    <Search className="h-3 w-3 shrink-0" />
                                    <span className="px-2 py-0.5 rounded bg-muted/40 border border-border/50">
                                      {group.slotLabel}
                                    </span>
                                  </div>
                                )}
                                <div
                                  className={cn(
                                    'flex flex-wrap gap-1.5 items-center',
                                    hasSlot && 'pl-2 ml-1 border-l-2 border-border/50'
                                  )}
                                >
                                  {group.queries.map((q, qi) => (
                                    <span
                                      key={`${slotKey}-${qi}`}
                                      className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border/50 font-mono max-w-full"
                                    >
                                      {q.strategy && <SubqueryStrategyBadge strategy={q.strategy} />}
                                      <span className="truncate">&ldquo;{q.text}&rdquo;</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          }).flat();
                        })()}
                      </div>
                    )}
                    {step.statements?.length ? (
                      <ul className="space-y-1 text-sm leading-relaxed">
                        {step.statements
                          .filter((stmt) => !stmt.startsWith('Fill:'))
                          .map((stmt, j) => {
                            const isRetrievedLine = j === 0 && stmt.startsWith('Retrieved ') && stmt.includes(' quotes from this step');
                            const filteredLength = step.statements!.filter((s) => !s.startsWith('Fill:')).length;
                            const isConclusion = j === 1 && filteredLength > 2;
                            const isAchievedLine = stmt.startsWith('Achieved ') && stmt.includes('% completeness');
                            const achievedMatch = isAchievedLine && stmt.match(/^Achieved (.+)$/);
                            return (
                              <li
                                key={j}
                                className={cn(
                                  'pl-0',
                                  isRetrievedLine && 'text-muted-foreground',
                                  isConclusion && 'italic text-foreground',
                                  isAchievedLine && 'text-foreground/80'
                                )}
                              >
                                {achievedMatch ? (
                                  <>Achieved <span className="font-semibold">{achievedMatch[1]}</span></>
                                ) : (
                                  stmt
                                )}
                              </li>
                            );
                          })}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">{step.why ?? step.action}</p>
                    )}
                    {step.fillStatusBySlot && Object.keys(step.fillStatusBySlot).length > 0 && tp.slots && (
                      <div className="flex flex-wrap gap-1.5 items-center pt-1">
                        {Object.entries(step.fillStatusBySlot).map(([slotName, status]) => {
                          const filled = status === 'filled';
                          const slotMeta = tp.slots!.find((s) => s.name === slotName);
                          const typeStr = slotMeta?.type ?? '';
                          const dependsOn = slotMeta?.dependsOn;
                          return (
                            <span
                              key={slotName}
                              className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border max-w-full',
                                filled ? 'bg-primary/10 text-primary border-primary/20' : 'bg-muted/40 text-muted-foreground border-border/50 border-dashed'
                              )}
                              title={dependsOn ? `Depends on: ${dependsOn}` : undefined}
                            >
                              {filled ? (
                                <CheckCircle2 className="h-3 w-3 shrink-0" />
                              ) : (
                                <Circle className="h-3 w-3 shrink-0 stroke-dasharray-[2,2] stroke-[2]" />
                              )}
                              <span className="font-medium shrink-0">{slotName}</span>
                              {typeStr && <span className="text-[10px] opacity-80 shrink-0">· {typeStr}</span>}
                              {dependsOn && (
                                <span className="text-[10px] truncate min-w-0 text-amber-600 dark:text-amber-400" title={`Depends on: ${dependsOn}`}>
                                  ↳ {dependsOn}
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {step.queryGuidance && step.queryGuidance.trim().length > 0 && (
                      <details className="rounded-lg border border-border/40 bg-muted/10 text-[11px]">
                        <summary className="cursor-pointer px-3 py-2 text-muted-foreground font-medium">
                          Query guidance (model context)
                        </summary>
                        <pre className="px-3 pb-2.5 whitespace-pre-wrap font-mono text-muted-foreground leading-snug">
                          {step.queryGuidance}
                        </pre>
                      </details>
                    )}
                    {step.extractDebug && (step.extractDebug.request || step.extractDebug.responseRaw) && (
                      <details className="rounded-lg border border-border/40 bg-muted/10 text-[11px]">
                        <summary className="cursor-pointer px-3 py-2 text-muted-foreground font-medium">
                          Extract raw (request/response)
                        </summary>
                        <div className="px-3 pb-2.5 space-y-2">
                          {step.extractDebug.request && (
                            <div>
                              <div className="text-[10px] text-muted-foreground mb-1">Request (truncated)</div>
                              <pre className="whitespace-pre-wrap font-mono text-muted-foreground leading-snug">
                                {step.extractDebug.request}
                              </pre>
                            </div>
                          )}
                          {step.extractDebug.responseRaw && (
                            <div>
                              <div className="text-[10px] text-muted-foreground mb-1">Response (truncated)</div>
                              <pre className="whitespace-pre-wrap font-mono text-muted-foreground leading-snug">
                                {step.extractDebug.responseRaw}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                    {step.droppedClaims && step.droppedClaims.length > 0 && (
                      <DroppedClaimsBlock dropped={step.droppedClaims} />
                    )}
                    {step.droppedSubqueries && step.droppedSubqueries.length > 0 && (
                      <DroppedSubqueriesBlock dropped={step.droppedSubqueries} />
                    )}
                    {step.slotSnapshot && Object.keys(step.slotSnapshot).length > 0 && (
                      <SlotSnapshotBlock snapshot={step.slotSnapshot} slots={tp.slots ?? []} claims={step.claims ?? []} />
                    )}
                    {step.nextAction && (
                      <div className="pt-1.5">
                        <span
                          className={cn(
                            'inline-block text-[11px] px-2 py-1 rounded',
                            step.nextAction === 'answer'
                              ? 'text-foreground/90 bg-muted/60 border border-border/60'
                              : 'text-muted-foreground bg-muted/50 border border-border/50'
                          )}
                        >
                          Then: {nextActionLabel(step.nextAction)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {outcome && (
              <div
                className={cn(
                  'mt-3 flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm font-medium',
                  !answeringFromEvidence && outcome === 'Answered from evidence' &&
                    'border-green-700/20 bg-green-400/10 text-green-700/90 dark:text-green-600/80',
                  outcome === 'Suggested a page' &&
                    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
                  (answeringFromEvidence || outcome === 'Searched again' || outcome === 'Asked for clarification') &&
                    'border-border/60 bg-muted/40 text-foreground'
                )}
              >
                {outcome === 'Suggested a page' ? (
                  <>
                    <FilePlus className="h-4 w-4 shrink-0 text-violet-500" />
                    <span>
                      {suggestedPage?.title ? (
                        <>
                          Suggested <strong>{suggestedPage.title}</strong>
                          {suggestedPage.fromPageTitle ? ` (branching out from ${suggestedPage.fromPageTitle})` : ''}
                        </>
                      ) : (
                        'Suggested a page'
                      )}
                    </span>
                  </>
                ) : outcome === 'Answered from evidence' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600/70 dark:text-green-500/70" />
                    <span>{answeringFromEvidence ? 'Answering from evidence…' : 'Answered from evidence'}</span>
                  </>
                ) : (
                  <>
                    <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{outcome}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {hasStopOrNote && (
        <div className="space-y-1.5">
          {tp.hardStopReason && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400/90">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.25" />
              <span>{tp.hardStopReason}</span>
            </div>
          )}
          {tp.partialAnswerNote && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.25" />
              <span>{tp.partialAnswerNote}</span>
            </div>
          )}
          <DroppedQuotesBlock droppedQuotes={tp.droppedQuotes} quoteDiagnostics={tp.quoteDiagnostics} />
          {tp.expandCorpusReason && outcome !== 'Suggested a page' && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.25" />
              <span>{tp.expandCorpusReason}</span>
            </div>
          )}
          {tp.extractionGaps && tp.extractionGaps.length > 0 && (
            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400/90">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.25" />
              <span>{tp.extractionGaps.join('; ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ThoughtProcessViewProps {
  thoughtProcess: ThoughtProcess;
  
  thoughtProcessBefore?: ThoughtProcess | null;
  
  phases?: ThoughtProcess[] | null;
  
  suggestedPage?: { title: string; url?: string; fromPageTitle?: string } | null;
  
  isLive?: boolean;
  
  defaultOpen?: boolean;
}

function hasPhaseContent(tp: ThoughtProcess | null | undefined): boolean {
  return Boolean(tp && ((tp.slots?.length ?? 0) > 0 || (tp.steps?.length ?? 0) > 0));
}

export function ThoughtProcessView({
  thoughtProcess: tp,
  thoughtProcessBefore = null,
  phases: phasesProp = null,
  suggestedPage = null,
  isLive = false,
  defaultOpen = false,
}: ThoughtProcessViewProps) {
  const [open, setOpen] = useState(isLive || defaultOpen);
  const hasContent = hasPhaseContent(tp);

  const phases: ThoughtProcess[] =
    phasesProp && phasesProp.length > 0
      ? phasesProp.filter(hasPhaseContent)
      : thoughtProcessBefore && hasPhaseContent(thoughtProcessBefore)
        ? [thoughtProcessBefore, tp]
        : [tp];

  const hasMultiplePhases = phases.length > 1;

  if (!tp || !hasContent) return null;

  const completenessPct = tp.completeness != null ? Math.round(tp.completeness * 100) : null;
  const hasStopOrNote = Boolean(tp.hardStopReason || tp.partialAnswerNote || (tp.extractionGaps?.length ?? 0) > 0 || tp.expandCorpusReason);
  const outcome = outcomeLabel(tp);
  const suggestedOutcome =
    outcome === 'Suggested a page' && suggestedPage?.title
      ? `Suggested ${suggestedPage.title}${
          suggestedPage.fromPageTitle ? ` (branching out from ${suggestedPage.fromPageTitle})` : ''
        }`
      : outcome;
  const headerSubtitle = !isLive && suggestedOutcome
    ? (completenessPct === 100 ? `Answered (${completenessPct}%)` : suggestedOutcome)
    : null;

  return (
    <div
      className={cn(
        'mt-3 rounded-xl overflow-hidden transition-all duration-200',
        'bg-gradient-to-b from-muted/15 to-muted/5',
        'border border-border/50 shadow-sm',
        isLive && 'ring-1 ring-primary/10 animate-thought-process-glow'
      )}
    >
      <button
        type="button"
        onClick={() => !isLive && setOpen((o) => !o)}
        className={cn(
          'w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors',
          'hover:from-muted/25 hover:to-muted/10',
          isLive ? 'cursor-default' : 'cursor-pointer hover:bg-muted/10'
        )}
      >
        <div
          className={cn(
            'shrink-0 w-7 h-7 rounded-lg flex items-center justify-center',
            'bg-primary/10 text-primary',
            isLive && 'animate-pulse'
          )}
        >
          <Brain className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-medium text-foreground/90">
          {isLive ? 'Thinking…' : 'Reasoning'}
        </span>
        {!isLive && headerSubtitle && (
          <span className="text-xs text-muted-foreground font-normal">
            · {headerSubtitle}
          </span>
        )}
        {!isLive && completenessPct != null && !headerSubtitle && (
          <span className="text-xs text-muted-foreground font-normal">
            · {completenessPct}% evidence
          </span>
        )}
        {!isLive && (
          <span className="ml-auto shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/50">
          {phases.map((phase, i) => (
            <div key={i} className={i > 0 ? 'border-t border-border/50' : undefined}>
              <PhaseContent
                tp={phase}
                showBanner={i === phases.length - 1}
                suggestedPage={i === phases.length - 1 ? suggestedPage : null}
                stacked={hasMultiplePhases ? (i === 0 ? 'first' : i === phases.length - 1 ? 'last' : 'middle') : undefined}
                isLive={isLive && i === phases.length - 1}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}