// score-interrupt.ts — CH-022 (rung-9): the interrupt-before-score-write seam. depth_doctrine's 9-row
// requires that a campaign can be PAUSED at a clean boundary — specifically before a score is persisted —
// so a partially-built wave is never frozen into the matrix; the wave stays `running` and resume picks it
// up (see resolveResumeIndex in wave-replay.ts). This is the single pause primitive saveMatrix consults
// before it writes; it is fully seamed (env + file injectable) so it is testable with no disk or daemon,
// and it FAILS OPEN on any read error — a broken probe must never wedge a normal save.
//
// Two operator controls, checked in order:
//   1. env DANTEFORGE_INTERRUPT_BEFORE_SCORE (truthy) — process-scoped pause (CI / a single run).
//   2. sentinel file <cwd>/.danteforge/INTERRUPT — durable, operator-dropped pause (mirrors the
//      established file-as-control-channel convention, e.g. AUTOFORGE_PAUSED). Its contents become the reason.
// Default (neither set): { paused: false } — so placing the check on the hot save path is a no-op until
// an operator (or the capability_test) explicitly arms it.

import path from 'node:path';
import fs from 'node:fs/promises';

export interface InterruptResult {
  paused: boolean;
  reason: string;
}

export interface InterruptDeps {
  /** Read an env var (default: process.env). */
  readEnv?: (key: string) => string | undefined;
  /** Read a file's text, or null if absent (default: fs read, null on ENOENT/any error). */
  readFile?: (p: string) => Promise<string | null>;
}

export const INTERRUPT_ENV = 'DANTEFORGE_INTERRUPT_BEFORE_SCORE';
export const INTERRUPT_SENTINEL = '.danteforge/INTERRUPT';

function isTruthy(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no';
}

/**
 * Is a score write currently interrupted? Checked by saveMatrix before persisting any score / frontier
 * declaration. Fail-open: any unexpected error returns `{ paused: false }` so a normal save never wedges.
 */
export async function checkScoreInterrupt(cwd: string, deps: InterruptDeps = {}): Promise<InterruptResult> {
  try {
    const readEnv = deps.readEnv ?? ((k: string) => process.env[k]);
    if (isTruthy(readEnv(INTERRUPT_ENV))) {
      return { paused: true, reason: `${INTERRUPT_ENV} is set` };
    }
    const readFile = deps.readFile ?? (async (p: string) => {
      try { return await fs.readFile(p, 'utf8'); } catch { return null; }
    });
    const sentinel = await readFile(path.join(cwd, INTERRUPT_SENTINEL));
    if (sentinel !== null) {
      const note = sentinel.trim();
      return { paused: true, reason: note.length > 0 ? note.slice(0, 200) : 'operator interrupt file present (.danteforge/INTERRUPT)' };
    }
    return { paused: false, reason: '' };
  } catch {
    return { paused: false, reason: '' }; // fail open — never block a normal run on a probe error
  }
}
