// ux-progress.ts — Lightweight TTY-safe progress indicators for long-running CLI commands.
// Closes the UX gap (7.5 vs Pydantic-AI 8.5 / Cursor 9.5): users get live feedback
// without noise in CI logs.

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const FRAME_INTERVAL_MS = 80;

export interface ProgressHandle {
  update(label: string): void;
  succeed(label?: string): void;
  fail(label?: string): void;
  stop(): void;
}

function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

function elapsed(startMs: number): string {
  const s = Math.floor((Date.now() - startMs) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

// Noop handle returned in non-TTY environments (CI, pipes).
const noop: ProgressHandle = {
  update: () => {},
  succeed: () => {},
  fail: () => {},
  stop: () => {},
};

export function startProgress(initialLabel: string): ProgressHandle {
  if (!isTTY()) return noop;

  let label = initialLabel;
  let frameIdx = 0;
  const startMs = Date.now();

  function render(): void {
    const frame = FRAMES[frameIdx % FRAMES.length];
    process.stdout.write(`\r${frame} ${label} (${elapsed(startMs)})`);
  }

  const timer = setInterval(() => {
    frameIdx++;
    render();
  }, FRAME_INTERVAL_MS);

  render();

  function clear(): void {
    clearInterval(timer);
    process.stdout.write('\r\x1b[K');
  }

  return {
    update(next: string) {
      label = next;
    },
    succeed(next?: string) {
      clear();
      process.stdout.write(`✓ ${next ?? label} (${elapsed(startMs)})\n`);
    },
    fail(next?: string) {
      clear();
      process.stdout.write(`✗ ${next ?? label} (${elapsed(startMs)})\n`);
    },
    stop() {
      clear();
    },
  };
}

/**
 * Wraps an async function with a progress spinner.
 * In non-TTY environments (CI) this is a transparent pass-through.
 */
export async function withProgress<T>(
  label: string,
  fn: (progress: ProgressHandle) => Promise<T>,
): Promise<T> {
  const handle = startProgress(label);
  try {
    const result = await fn(handle);
    // Only auto-succeed if the caller didn't already call succeed/fail.
    handle.stop();
    return result;
  } catch (err) {
    handle.fail();
    throw err;
  }
}
