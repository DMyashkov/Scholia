import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Brain, CheckCircle2, AlertCircle, Info, Search, Circle, XCircle, FilePlus } from 'lucide-react';
import type { ThoughtProcess } from '@/types/chat';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** User-facing label for next_action (no technical terms). */
function nextActionLabel(nextAction: string): string {
  switch (nextAction) {
    case 'expand_corpus': return 'Suggest closest page from encoded discovered';
    case 'answer': return 'Answered from evidence';
    case 'retrieve': return 'Searched again';
    case 'clarify': return 'Asked for clarification';
    default: return nextAction;
  }
}

/** Outcome line for footer and header subtitle. */
function outcomeLabel(tp: ThoughtProcess): string | null {
  const last = tp.steps?.[tp.steps.length - 1];
  const action = last?.nextAction;
  if (action === 'expand_corpus') return 'Suggested a page';
  if (action === 'answer') return 'Answered from evidence';
  if (action === 'retrieve') return 'Searched again';
  if (action === 'clarify') return 'Asked for clarification';
  return null;
}

function PhaseContent({ tp, showBanner, suggestedPage }: { tp: ThoughtProcess; showBanner?: boolean; suggestedPage?: { title: string; url?: string; fromPageTitle?: string } | null }) {
  const outcome = outcomeLabel(tp);
  const hasStopOrNote = Boolean(tp.hardStopReason || tp.partialAnswerNote || (tp.extractionGaps?.length ?? 0) > 0 || tp.expandCorpusReason);

  return (
    <div className="px-4 pt-4 space-y-7">
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

      {tp.slots && tp.slots.length > 0 && (
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">Looking for</p>
          <div className="flex flex-wrap gap-2">
            {tp.slots.map((s) => {
              const tooltipBody = [s.description, s.dependsOn && `Depends on: ${s.dependsOn}`].filter(Boolean).join('\n\n');
              const pill = (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-muted/40 text-muted-foreground border border-border/50 max-w-full">
                  <span className="font-medium text-foreground/80 shrink-0">{s.name}</span>
                  <span className="text-[10px] opacity-80 shrink-0">· {s.type}</span>
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
                    </div>
                    {step.subqueries && step.subqueries.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <Search className="h-3 w-3 text-muted-foreground shrink-0" />
                        {step.subqueries.map((sq, qi) => (
                          <span
                            key={qi}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground border border-border/50 font-mono"
                            title={sq.slot ? `Slot: ${sq.slot}` : undefined}
                          >
                            &ldquo;{sq.query}&rdquo;{sq.slot ? ` (${sq.slot})` : ''}
                          </span>
                        ))}
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
                  outcome === 'Answered from evidence' &&
                    'border-green-700/20 bg-green-400/10 text-green-700/90 dark:text-green-600/80',
                  outcome === 'Suggested a page' &&
                    'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
                  (outcome === 'Searched again' || outcome === 'Asked for clarification') &&
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
                    <span>Answered from evidence</span>
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
  /** When present, show two phases: "First (no page)" and then the follow-up phase with no subtitle */
  thoughtProcessBefore?: ThoughtProcess | null;
  /** When set and outcome is "Suggested a page", footer shows "Suggested **{title}** (branching out from …)" when fromPageTitle is set */
  suggestedPage?: { title: string; url?: string; fromPageTitle?: string } | null;
  /** When true, show as live/streaming (no collapse, subtle pulse) */
  isLive?: boolean;
  /** When false (saved message), panel is collapsible and starts collapsed */
  defaultOpen?: boolean;
}

export function ThoughtProcessView({
  thoughtProcess: tp,
  thoughtProcessBefore = null,
  suggestedPage = null,
  isLive = false,
  defaultOpen = false,
}: ThoughtProcessViewProps) {
  const [open, setOpen] = useState(isLive || defaultOpen);
  const hasContent = (tp.slots?.length ?? 0) > 0 || (tp.steps?.length ?? 0) > 0;
  const hasTwoPhases = thoughtProcessBefore && ((thoughtProcessBefore.slots?.length ?? 0) > 0 || (thoughtProcessBefore.steps?.length ?? 0) > 0);

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

      {open && (hasTwoPhases && thoughtProcessBefore ? (
        <div className="border-t border-border/50">
          <PhaseContent tp={thoughtProcessBefore} showBanner={false} suggestedPage={suggestedPage} />
          <div className="border-t border-border/50">
            <PhaseContent tp={tp} showBanner={false} />
          </div>
        </div>
      ) : (
        <div className="border-t border-border/50">
          <PhaseContent tp={tp} showBanner suggestedPage={suggestedPage} />
        </div>
      ))}
    </div>
  );
}
