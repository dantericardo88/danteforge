// Progress — spinner + progress bar wrapper over ora
// Only shows visuals in TTY mode — silent in CI/pipes/tests.
// Logger-compatible: logger.info() routes through active spinner.

// Type-only import for ora (dynamic import at runtime)
export interface SpinnerHandle {
  update(text: string): void;
  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

export interface ProgressOptions {
  _isTTY?: boolean;   // injection seam for testing (default: process.stdout.isTTY)
}

// ── Module-level active spinner reference ─────────────────────────────────────
// Used by logger.ts to route messages through active spinner

let _activeSpinner: SpinnerHandle | null = null;

export function getActiveSpinner(): SpinnerHandle | null {
  return _activeSpinner;
}

export function setActiveSpinner(spinner: SpinnerHandle | null): void {
  _activeSpinner = spinner;
}

// ── Spinner factory ───────────────────────────────────────────────────────────

export async function startSpinner(
  text: string,
  opts: ProgressOptions = {},
): Promise<SpinnerHandle> {
  const isTTY = opts._isTTY ?? (process.stdout.isTTY === true);

  if (!isTTY) {
    // Silent no-op handle in non-TTY mode
    const noop: SpinnerHandle = {
      update: () => {},
      succeed: () => { setActiveSpinner(null); },
      fail: () => { setActiveSpinner(null); },
      stop: () => { setActiveSpinner(null); },
    };
    setActiveSpinner(noop);
    return noop;
  }

  // Dynamic import — avoids loading ora in test environments unless needed
  const { default: ora } = await import('ora');
  const spinner = ora({ text, stream: process.stdout }).start();

  const handle: SpinnerHandle = {
    update(newText: string) { spinner.text = newText; },
    succeed(successText?: string) {
      spinner.succeed(successText);
      setActiveSpinner(null);
    },
    fail(failText?: string) {
      spinner.fail(failText);
      setActiveSpinner(null);
    },
    stop() {
      spinner.stop();
      setActiveSpinner(null);
    },
  };

  setActiveSpinner(handle);
  return handle;
}

// ── High-level helper ─────────────────────────────────────────────────────────

export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  successText?: string,
  opts: ProgressOptions = {},
): Promise<T> {
  const spinner = await startSpinner(text, opts);
  try {
    const result = await fn();
    spinner.succeed(successText ?? text);
    return result;
  } catch (err) {
    spinner.fail(text + ' failed');
    throw err;
  }
}

// ── Progress bar (text-based, no spinner) ────────────────────────────────────

export function progressBar(
  label: string,
  current: number,
  total: number,
  width = 20,
  opts: ProgressOptions = {},
): void {
  const isTTY = opts._isTTY ?? (process.stdout.isTTY === true);
  if (!isTTY) return;

  const pct = total > 0 ? Math.min(1, current / total) : 0;
  const filled = Math.round(pct * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pctStr = `${Math.round(pct * 100)}%`;
  process.stdout.write(`\r${label}  [${bar}] ${pctStr.padStart(4)} (${current}/${total})`);
  if (current >= total) process.stdout.write('\n');
}
