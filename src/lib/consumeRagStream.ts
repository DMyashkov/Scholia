import type { ThoughtProcess } from '@/types/chat';

export type RagStreamOutcome = 'done' | 'error' | 'incomplete';

export type RagStreamEventHandlers = {
  onThoughtProcess?: (tp: ThoughtProcess) => void;
  onPlan?: (slots: ThoughtProcess['slots']) => void;
  onStepProgress?: (steps: Array<{ current: number; total: number; label: string }>) => void;
  onDone?: (event: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};


export async function consumeRagStream(
  body: ReadableStream<Uint8Array> | null,
  handlers: RagStreamEventHandlers,
): Promise<RagStreamOutcome> {
  if (!body) return 'incomplete';

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const steps: Array<{ current: number; total: number; label: string }> = [];
  let terminal: RagStreamOutcome | null = null;

  const processEvent = (event: Record<string, unknown>) => {
    if (event.ping != null) return;
    if (event.thoughtProcess != null && typeof event.thoughtProcess === 'object') {
      handlers.onThoughtProcess?.(event.thoughtProcess as ThoughtProcess);
    } else if (event.plan != null && typeof event.plan === 'object') {
      const plan = event.plan as { slots?: ThoughtProcess['slots'] };
      if (Array.isArray(plan.slots)) handlers.onPlan?.(plan.slots);
    }
    if (event.step != null && event.label && event.totalSteps != null) {
      const current = Number(event.step);
      const total = Number(event.totalSteps);
      const label = String(event.label);
      const idx = steps.findIndex((s) => s.current === current);
      if (idx >= 0) steps[idx] = { current, total, label };
      else {
        steps.push({ current, total, label });
        steps.sort((a, b) => a.current - b.current);
      }
      handlers.onStepProgress?.([...steps]);
    }
    if (event.done === true) {
      handlers.onDone?.(event);
      terminal = 'done';
    } else if (event.error) {
      handlers.onError?.(String(event.error));
      terminal = 'error';
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          processEvent(JSON.parse(line) as Record<string, unknown>);
          if (terminal) return terminal;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }

    if (buffer.trim()) {
      try {
        processEvent(JSON.parse(buffer) as Record<string, unknown>);
        if (terminal) return terminal;
      } catch (e) {
        if (!(e instanceof SyntaxError)) throw e;
      }
    }
  } catch (e) {
    handlers.onError?.(e instanceof Error ? e.message : 'Stream read failed');
    return 'error';
  }

  return terminal ?? 'incomplete';
}
