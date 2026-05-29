// cli-semaphore.ts — Fleet-wide concurrency governor for subscription-CLI spawns.
//
// The claude/codex/grok/gemini subscription rate limit is ONE shared per-account
// bucket. Across a fleet (many VS Code windows × Claude Code instances × agents),
// uncoordinated CLI spawns drain it and calls start returning empty. This caps the
// TOTAL number of concurrent subscription-CLI agents across ALL DanteForge processes
// on the machine, via N home-level O_EXCL slot lockfiles in ~/.danteforge/cli-slots/.
//
// HOME-level (not project-level) on purpose: the rate limit is per-account, so windows
// working on DIFFERENT projects must still share the same slots.
//
// Degrades gracefully: if the slot dir is unusable, or no slot frees within maxWaitMs,
// it runs WITHOUT a slot rather than blocking forever — occasionally exceeding the cap
// beats deadlocking the tool. Stale slots (crashed holders) are reclaimed by TTL.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SLOT_DIR = path.join(os.homedir(), '.danteforge', 'cli-slots');
const DEFAULT_SLOTS = 3;
const SLOT_TTL_MS = 5 * 60_000;        // crashed-holder reclaim (CLI calls are bounded ~300s)
const DEFAULT_MAX_WAIT_MS = 180_000;   // queue up to 3 min for a free slot
const POLL_MS = 250;

/** Global cap on concurrent subscription-CLI agents. Override with DANTEFORGE_CLI_SLOTS. */
export function cliSlotCount(): number {
  const env = Number.parseInt(process.env['DANTEFORGE_CLI_SLOTS'] ?? '', 10);
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_SLOTS;
}

interface SlotHandle { release: () => Promise<void>; index: number; }

/** Try once to grab any free slot (0..n-1). Reclaims stale slots in passing. */
async function tryAcquireSlot(n: number): Promise<SlotHandle | null> {
  const body = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
  for (let i = 0; i < n; i++) {
    const slotPath = path.join(SLOT_DIR, `slot-${i}.lock`);
    try {
      await fs.writeFile(slotPath, body, { flag: 'wx' });
      return { index: i, release: async () => { await fs.unlink(slotPath).catch(() => {}); } };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') continue; // odd error — skip this slot
      // Slot taken — reclaim if the holder is stale, freeing it for the next poll.
      try {
        const st = await fs.stat(slotPath);
        if (Date.now() - st.mtimeMs > SLOT_TTL_MS) await fs.unlink(slotPath).catch(() => {});
      } catch { /* vanished between stat calls — next poll picks it up */ }
    }
  }
  return null;
}

export interface CliSlotOptions {
  maxWaitMs?: number;
  /** Diagnostic label for logging contention (optional). */
  label?: string;
}

/**
 * Run `fn` while holding one of N fleet-wide CLI slots. Always runs `fn` exactly once;
 * the slot just throttles WHEN it starts. Releases the slot when `fn` settles.
 */
export async function withCliSlot<T>(fn: () => Promise<T>, opts: CliSlotOptions = {}): Promise<T> {
  const n = cliSlotCount();
  const maxWait = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  let handle: SlotHandle | null = null;
  try {
    await fs.mkdir(SLOT_DIR, { recursive: true });
    const start = Date.now();
    do {
      handle = await tryAcquireSlot(n).catch(() => null);
      if (handle) break;
      await sleep(POLL_MS);
    } while (Date.now() - start <= maxWait);
  } catch { /* slot dir unusable — proceed ungoverned rather than fail the call */ }

  try {
    return await fn();
  } finally {
    if (handle) await handle.release().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
