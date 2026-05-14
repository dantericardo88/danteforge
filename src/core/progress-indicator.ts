// Progress indicator for long-running CLI operations
// Uses stderr for output so stdout stays clean for JSON/piped data.
// Non-TTY aware: no spinners if stderr is not a TTY, just prints lines.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressHandle {
  /** Update the progress message without marking done/failed. */
  update(message: string): void;
  /** Mark the operation as done with an optional final message. */
  done(message?: string): void;
  /** Mark the operation as failed with an error message. */
  fail(message: string): void;
}

export interface ProgressOptions {
  /** Override stderr write function (for testing). */
  _writeFn?: (msg: string) => void;
  /** Override isTTY detection (for testing). */
  _isTTY?: boolean;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface InternalHandle {
  label: string;
  done: boolean;
  failed: boolean;
  frameIndex: number;
  timerId?: ReturnType<typeof setInterval>;
  write: (msg: string) => void;
  isTTY: boolean;
}

function defaultWrite(msg: string): void {
  process.stderr.write(msg);
}

function formatLine(frame: string, label: string, message: string): string {
  return `\r${frame} ${label}${message ? ': ' + message : ''}`;
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

/**
 * Start a progress indicator for a named operation.
 * Returns a handle to update, complete, or fail the indicator.
 */
export function startProgress(label: string, options: ProgressOptions = {}): ProgressHandle {
  const write = options._writeFn ?? defaultWrite;
  const isTTY = options._isTTY ?? (process.stderr.isTTY === true);

  const state: InternalHandle = {
    label,
    done: false,
    failed: false,
    frameIndex: 0,
    write,
    isTTY,
  };

  if (isTTY) {
    // Spin on TTY
    state.timerId = setInterval(() => {
      if (state.done || state.failed) return;
      const frame = SPINNER_FRAMES[state.frameIndex % SPINNER_FRAMES.length];
      state.frameIndex++;
      write(formatLine(frame, label, ''));
    }, 80);
  } else {
    // Non-TTY: just print a start line
    write(`[START] ${label}\n`);
  }

  const handle: ProgressHandle = {
    update(message: string): void {
      if (state.done || state.failed) return;
      if (isTTY) {
        const frame = SPINNER_FRAMES[state.frameIndex % SPINNER_FRAMES.length];
        write(formatLine(frame, label, message));
      } else {
        write(`[${label}] ${message}\n`);
      }
    },

    done(message?: string): void {
      if (state.done || state.failed) return;
      state.done = true;
      if (state.timerId !== undefined) {
        clearInterval(state.timerId);
      }
      if (isTTY) {
        const finalMsg = message ? `: ${message}` : '';
        write(`\r${isTTY ? '\x1B[2K' : ''}✓ ${label}${finalMsg}\n`);
      } else {
        write(`[DONE] ${label}${message ? ': ' + message : ''}\n`);
      }
    },

    fail(message: string): void {
      if (state.done || state.failed) return;
      state.failed = true;
      if (state.timerId !== undefined) {
        clearInterval(state.timerId);
      }
      if (isTTY) {
        write(`\r${isTTY ? '\x1B[2K' : ''}✗ ${label}: ${message}\n`);
      } else {
        write(`[FAIL] ${label}: ${message}\n`);
      }
    },
  };

  return handle;
}

// ---------------------------------------------------------------------------
// Convenience wrapper
// ---------------------------------------------------------------------------

/**
 * Run an async operation with a progress indicator.
 * The indicator is automatically marked done on resolution or failed on rejection.
 *
 * @example
 * const result = await withProgress('Building project', async (handle) => {
 *   handle.update('compiling...');
 *   const out = await buildProject();
 *   return out;
 * });
 */
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
