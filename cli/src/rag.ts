import { FUNCTIONS_URL } from './auth.js';
import {
  printPlanSlots,
  printIterationHeader,
  printSubqueries,
  printClaims,
  printCompleteness,
  printSlotFillSummary,
  printQueryGuidance,
  printDroppedClaims,
  printStepWhy,
  printError,
  printSuggestedPage,
  printHardStop,
  printDoneStats,
  printSystemLine,
  type SubqueryInfo,
  type ClaimInfo,
  type SlotFillEntry,
} from './display.js';

// ─── Types mirrored from the edge function ───────────────────────────────────

interface RagPlanEvent {
  plan?: { slots?: Array<{ name: string; type: string; description?: string; dependsOn?: string; target_item_count?: number }> };
}

interface RagStepEvent {
  step?: number;
  iter?: number;
  action?: string;
  label?: string;
  why?: string;
  quotesFound?: number;
  claims?: Array<{ slot: string; key?: string; value: unknown; confidence?: number }>;
  completeness?: number;
  fillStatusBySlot?: Record<string, string>;
}

interface ThoughtStep {
  iter: number;
  action: string;
  why?: string;
  subqueries?: SubqueryInfo[];
  claims?: ClaimInfo[];
  completeness?: number;
  fillStatusBySlot?: Record<string, string>;
  slotSnapshot?: Array<{ name: string; type: string; filled: number; target: number | null }>;
  queryGuidance?: string;
  droppedClaims?: Array<{ slot: string; reason: string }>;
  nextAction?: string;
}

interface ThoughtProcess {
  slots?: Array<{ name: string; type: string; description?: string; dependsOn?: string; target_item_count?: number }>;
  steps?: ThoughtStep[];
  completeness?: number;
  slotFillSummary?: SlotFillEntry[];
  hardStopReason?: string;
  partialAnswerNote?: string;
  expandCorpusReason?: string;
}

interface RagThoughtEvent {
  thoughtProcess?: ThoughtProcess;
}

interface RagDoneEvent {
  done: true;
  message?: { id: string; content: string; role: string };
  suggestedPage?: { url: string; title: string; snippet?: string };
  thoughtProcess?: ThoughtProcess;
}

interface RagErrorEvent {
  error: string;
}

type RagEvent = RagPlanEvent & RagStepEvent & RagThoughtEvent & RagDoneEvent & RagErrorEvent & { ping?: number };

export interface RagCallOptions {
  conversationId: string;
  userMessageId: string;
  userMessage: string;
  accessToken: string;
  debug: boolean;
}

// ─── stream consumer ─────────────────────────────────────────────────────────

export async function callRagStream(opts: RagCallOptions): Promise<string | null> {
  const { conversationId, userMessageId, userMessage, accessToken, debug } = opts;

  const res = await fetch(`${FUNCTIONS_URL}/chat-with-rag`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      conversationId,
      userMessage: userMessage.trim(),
      rootMessageId: userMessageId,
    }),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const b = await res.json() as Record<string, unknown>;
      detail = String(b.error ?? b.message ?? detail);
    } catch { /* ignore */ }
    printError(detail);
    return null;
  }

  if (!res.body) {
    printError('No response body');
    return null;
  }

  // Track what we've rendered so we only print new steps
  let lastRenderedStepIter = -1;
  let lastKnownSlots: ThoughtProcess['slots'] = undefined;
  let finalAnswer: string | null = null;

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let event: RagEvent;
      try {
        event = JSON.parse(trimmed) as RagEvent;
      } catch {
        continue;
      }

      // Heartbeat
      if (event.ping != null) continue;

      // Error
      if (event.error) {
        printError(event.error);
        return null;
      }

      // Thought process stream — pick out new steps as they arrive
      if (event.thoughtProcess) {
        const tp = event.thoughtProcess;

        // Plan slots (first time)
        if (tp.slots && !lastKnownSlots) {
          lastKnownSlots = tp.slots;
          printPlanSlots(tp.slots);
        }

        // Hard stop
        if (tp.hardStopReason) {
          printHardStop(tp.hardStopReason);
        }

        // Render any new steps
        if (tp.steps) {
          for (const step of tp.steps) {
            if (step.iter <= lastRenderedStepIter) continue;
            lastRenderedStepIter = step.iter;
            renderStep(step, debug);
          }
        }

        // Slot fill summary & completeness after last step
        if (tp.slotFillSummary) {
          printSlotFillSummary(tp.slotFillSummary);
        }
        continue;
      }

      // Step progress event (lightweight)
      if (event.iter != null && event.action && !event.thoughtProcess) {
        // already handled via thoughtProcess stream above
        continue;
      }

      // Done
      if (event.done) {
        const doneEvent = event as RagDoneEvent;
        if (doneEvent.suggestedPage) {
          printSuggestedPage(doneEvent.suggestedPage);
        }
        const lastCompleteness = doneEvent.thoughtProcess?.completeness;
        const iterCount = doneEvent.thoughtProcess?.steps?.length ?? 0;
        printDoneStats(iterCount, lastCompleteness);
        if (doneEvent.message?.content) {
          finalAnswer = doneEvent.message.content;
        }
      }
    }
  }

  // Flush leftover
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer.trim()) as RagEvent;
      if (event.done) {
        const doneEvent = event as RagDoneEvent;
        if (doneEvent.message?.content) finalAnswer = doneEvent.message.content;
      }
    } catch { /* ignore */ }
  }

  return finalAnswer;
}

function renderStep(step: ThoughtStep, debug: boolean): void {
  printIterationHeader(step.iter, step.action ?? 'retrieve');

  if (step.why) printStepWhy(step.why);

  if (step.subqueries?.length) {
    printSubqueries(step.subqueries);
  }

  if (step.claims?.length) {
    printClaims(step.claims);
  }

  if (step.completeness != null) {
    printCompleteness(step.completeness);
  }

  if (step.slotSnapshot?.length) {
    printSlotFillSummary(step.slotSnapshot);
  }

  if (debug) {
    if (step.queryGuidance) {
      printQueryGuidance(step.queryGuidance);
    }
    if (step.droppedClaims?.length) {
      printDroppedClaims(step.droppedClaims);
    }
  }
}
