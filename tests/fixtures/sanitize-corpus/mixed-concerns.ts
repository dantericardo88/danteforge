// Fixture: types + utility functions + main orchestration logic
// Expected outcome: -types.ts + -utils.ts extracted; orchestrator retained.

export interface TaskRequest {
  id: string;
  payload: Record<string, unknown>;
  priority: number;
}

export interface TaskResult {
  id: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface SchedulerStats {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  avgDurationMs: number;
}

export type TaskHandler = (req: TaskRequest) => Promise<TaskResult>;

export enum TaskState {
  Pending = 'pending',
  Running = 'running',
  Done = 'done',
  Failed = 'failed',
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export function prioritySort(a: TaskRequest, b: TaskRequest): number {
  return b.priority - a.priority;
}

export function isHighPriority(req: TaskRequest): boolean {
  return req.priority >= 8;
}

export function summarizeResults(results: TaskResult[]): SchedulerStats {
  const succeeded = results.filter(r => r.ok).length;
  const failed = results.length - succeeded;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  return {
    totalProcessed: results.length,
    succeeded,
    failed,
    avgDurationMs: results.length > 0 ? totalMs / results.length : 0,
  };
}

export class TaskScheduler {
  private queue: TaskRequest[] = [];
  private results: TaskResult[] = [];

  enqueue(req: TaskRequest): void {
    this.queue.push(req);
    this.queue.sort(prioritySort);
  }

  async processAll(handler: TaskHandler): Promise<SchedulerStats> {
    while (this.queue.length > 0) {
      const req = this.queue.shift()!;
      const start = Date.now();
      try {
        const result = await handler(req);
        this.results.push(result);
      } catch (err) {
        this.results.push({
          id: req.id,
          ok: false,
          error: String(err),
          durationMs: Date.now() - start,
        });
      }
    }
    return summarizeResults(this.results);
  }
}
