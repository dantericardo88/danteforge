// Canonical progress indicator for long-running CLI operations.
// Output uses stderr by default so stdout stays clean for JSON and piped data.

const FRAMES = ['-', '\\', '|', '/'];
const FRAME_INTERVAL_MS = 80;

export type ProgressMode = 'auto' | 'spinner' | 'plain' | 'silent';

export interface ProgressHandle {
  /** Replace the current progress label without marking the operation terminal. */
  update(message: string): void;
  /** Mark the operation as done. */
  done(message?: string): void;
  /** Alias for done(), kept for callsites that use action-oriented wording. */
  succeed(message?: string): void;
  /** Mark the operation as failed. */
  fail(message?: string): void;
  /** Stop rendering without emitting a terminal success/failure line. */
  stop(): void;
}

export interface ProgressOptions {
  /** Explicit output mode. auto selects spinner only for interactive terminals. */
  mode?: ProgressMode;
  /** Spinner interval in milliseconds. */
  intervalMs?: number;
  /** Override stderr write function. */
  _writeFn?: (msg: string) => void;
  /** Compatibility alias for callers migrated from ux-progress. */
  _write?: (msg: string) => void;
  /** Override isTTY detection. */
  _isTTY?: boolean;
  /** Override terminal columns for truncation tests. */
  _columns?: number;
  /** Override clock for deterministic tests. */
  _now?: () => number;
  /** Override environment for deterministic mode tests. */
  _env?: NodeJS.ProcessEnv;
  /** Override timers for deterministic spinner tests. */
  _setInterval?: typeof setInterval;
  _clearInterval?: typeof clearInterval;
}

type TerminalState = 'running' | 'succeeded' | 'failed' | 'stopped';

function defaultWrite(msg: string): void {
  process.stderr.write(msg);
}

function isTTY(options: ProgressOptions): boolean {
  return options._isTTY ?? (process.stderr.isTTY === true);
}

function elapsed(startMs: number, now: () => number): string {
  const seconds = Math.max(0, Math.floor((now() - startMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function sanitizeLabel(label: string): string {
  return label
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateToWidth(line: string, columns: number): string {
  if (columns <= 0 || line.length <= columns) return line;
  if (columns <= 3) return line.slice(0, columns);
  return `${line.slice(0, columns - 3)}...`;
}

function normalizeMode(value: string | undefined): ProgressMode | undefined {
  const normalized = value?.toLowerCase();
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return 'silent';
  if (normalized === 'spinner' || normalized === 'plain' || normalized === 'silent') return normalized;
  return undefined;
}

function resolveMode(options: ProgressOptions): Exclude<ProgressMode, 'auto'> {
  const env = options._env ?? process.env;
  const explicit = options.mode && options.mode !== 'auto'
    ? options.mode
    : normalizeMode(env.DANTEFORGE_PROGRESS);

  if (explicit && explicit !== 'auto') return explicit;
  if (env.DANTEFORGE_NO_SPINNER === '1') return 'plain';
  if (env.CI === 'true' || env.CI === '1') return 'plain';
  if ((env.TERM ?? '').toLowerCase() === 'dumb') return 'plain';
  return isTTY(options) ? 'spinner' : 'plain';
}

function makeNoopHandle(): ProgressHandle {
  return {
    update: () => {},
    done: () => {},
    succeed: () => {},
    fail: () => {},
    stop: () => {},
  };
}

export function startProgress(initialLabel: string, options: ProgressOptions = {}): ProgressHandle {
  const mode = resolveMode(options);
  if (mode === 'silent') return makeNoopHandle();

  const write = options._writeFn ?? options._write ?? defaultWrite;
  const now = options._now ?? Date.now;
  const columns = options._columns ?? process.stderr.columns ?? 80;
  let label = sanitizeLabel(initialLabel);
  let frameIdx = 0;
  let state: TerminalState = 'running';
  const startMs = now();

  if (mode === 'plain') {
    write(`[progress] ${label}\n`);
    const complete = (terminalState: 'succeeded' | 'failed', next?: string): void => {
      if (state !== 'running') return;
      state = terminalState;
      label = sanitizeLabel(next ?? label);
      const tag = terminalState === 'succeeded' ? 'done' : 'failed';
      write(`[${tag}] ${label} (${elapsed(startMs, now)})\n`);
    };

    return {
      update(next: string) {
        if (state !== 'running') return;
        const nextLabel = sanitizeLabel(next);
        if (nextLabel === label) return;
        label = nextLabel;
        write(`[progress] ${label}\n`);
      },
      done(next?: string) {
        complete('succeeded', next);
      },
      succeed(next?: string) {
        complete('succeeded', next);
      },
      fail(next?: string) {
        complete('failed', next);
      },
      stop() {
        if (state !== 'running') return;
        state = 'stopped';
      },
    };
  }

  function render(): void {
    if (state !== 'running') return;
    const frame = FRAMES[frameIdx % FRAMES.length];
    const line = truncateToWidth(`${frame} ${label} (${elapsed(startMs, now)})`, columns);
    write(`\r${line}`);
  }

  const setTimer = options._setInterval ?? setInterval;
  const clearTimer = options._clearInterval ?? clearInterval;
  const timer = setTimer(() => {
    frameIdx++;
    render();
  }, options.intervalMs ?? FRAME_INTERVAL_MS);

  render();

  function clear(): void {
    clearTimer(timer);
    write('\r\x1b[K');
  }

  function complete(terminalState: 'succeeded' | 'failed', next?: string): void {
    if (state !== 'running') return;
    state = terminalState;
    clear();
    label = sanitizeLabel(next ?? label);
    const prefix = terminalState === 'succeeded' ? 'OK' : 'FAIL';
    write(`${prefix} ${label} (${elapsed(startMs, now)})\n`);
  }

  return {
    update(next: string) {
      if (state !== 'running') return;
      label = sanitizeLabel(next);
      render();
    },
    done(next?: string) {
      complete('succeeded', next);
    },
    succeed(next?: string) {
      complete('succeeded', next);
    },
    fail(next?: string) {
      complete('failed', next);
    },
    stop() {
      if (state !== 'running') return;
      state = 'stopped';
      clear();
    },
  };
}

export async function withProgress<T>(
  label: string,
  fn: (handle: ProgressHandle) => Promise<T>,
  options: ProgressOptions = {},
): Promise<T> {
  const handle = startProgress(label, options);
  try {
    const result = await fn(handle);
    handle.done();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    handle.fail(message);
    throw err;
  }
}
