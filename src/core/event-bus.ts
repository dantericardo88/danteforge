// Event Bus — lightweight in-process event emitter for real-time progress
// Used by executor, autoforge-loop, and dashboard SSE endpoint.
// All events are fire-and-forget — no error propagation to callers.

export type ProgressEventType =
  | 'wave-start'
  | 'task-start'
  | 'task-complete'
  | 'llm-call'
  | 'score-update'
  | 'cycle-complete'
  | 'phase-complete';

export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: string;
  // Payload fields — present depending on type
  wave?: number;
  total?: number;
  taskName?: string;
  score?: number;
  dimension?: string;
  provider?: string;
  cycle?: number;
  phase?: string;
}

type EventHandler = (event: ProgressEvent) => void;

// ── In-process bus ─────────────────────────────────────────────────────────────

const handlers = new Set<EventHandler>();

export const eventBus = {
  /** Emit a progress event to all subscribers. Never throws. */
  emit(event: ProgressEvent): void {
    for (const handler of handlers) {
      try { handler(event); } catch { /* best-effort */ }
    }
  },

  /** Subscribe to progress events. Returns an unsubscribe function. */
  on(handler: EventHandler): () => void {
    handlers.add(handler);
    return () => { handlers.delete(handler); };
  },

  /** Remove all handlers (for test cleanup). */
  clear(): void {
    handlers.clear();
  },

  /** Current subscriber count (for testing). */
  get subscriberCount(): number {
    return handlers.size;
  },
};

// ── Format as SSE data line ────────────────────────────────────────────────────

export function formatSSEEvent(event: ProgressEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ── Convenience emitters ──────────────────────────────────────────────────────

export function emitWaveStart(wave: number, total: number): void {
  eventBus.emit({ type: 'wave-start', timestamp: new Date().toISOString(), wave, total });
}

export function emitTaskStart(taskName: string): void {
  eventBus.emit({ type: 'task-start', timestamp: new Date().toISOString(), taskName });
}

export function emitTaskComplete(taskName: string, score?: number): void {
  eventBus.emit({ type: 'task-complete', timestamp: new Date().toISOString(), taskName, score });
}

export function emitLLMCall(provider: string): void {
  eventBus.emit({ type: 'llm-call', timestamp: new Date().toISOString(), provider });
}

export function emitScoreUpdate(dimension: string, score: number): void {
  eventBus.emit({ type: 'score-update', timestamp: new Date().toISOString(), dimension, score });
}

export function emitCycleComplete(cycle: number, score: number): void {
  eventBus.emit({ type: 'cycle-complete', timestamp: new Date().toISOString(), cycle, score });
}

export function emitPhaseComplete(phase: string): void {
  eventBus.emit({ type: 'phase-complete', timestamp: new Date().toISOString(), phase });
}
