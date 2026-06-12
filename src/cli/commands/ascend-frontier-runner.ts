// ascend-frontier-runner.ts — the typed CLI runner + run-ledger plumbing for the orchestrator.
//
// The council flagged the orchestrator's old `df()` helper as "a side-effect shell pipeline that
// swallows failures and infers truth by re-reading state": it ran the CLI inside `.catch(() => {})`,
// throwing away exit code AND stderr, so a half-failed command looked identical to success.
//
// `runCli` replaces it: it NEVER throws, but it also never discards what happened — every invocation
// returns a typed {exitCode, stdout, stderr, ms, ok} and is recorded to the active RunLedger. A
// non-zero exit is now visible in the run bundle instead of being silently inferred away.

import { spawn } from 'node:child_process';
import type { RunLedger } from '../../core/run-ledger.js';
import { trackChild, untrackChild, killTree, SPAWN_DETACHED } from '../../core/process-tree.js';

/** Keep at most the last N bytes of each captured stream — a 30-min build must never buffer unbounded. */
const STREAM_TAIL_CAP = 256 * 1024;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
  ok: boolean;
}

// The orchestrator runs as a single sequential loop (parallel builds are separate CLI processes,
// not re-entrant in-process), so a module-scoped "active ledger" lets the deep push helpers record
// their sub-commands without threading the ledger through every signature.
let activeLedger: RunLedger | null = null;
export function setActiveLedger(ledger: RunLedger | null): void { activeLedger = ledger; }
export function getActiveLedger(): RunLedger | null { return activeLedger; }

/** When the last phase-timeout tree-kill fired — the next spawn waits out the reaper (see runCli). */
let lastTreeKillAt = 0;

/**
 * Phase-aware tree-kill cap (fleet run 2 dead-loop fix). The old UNIFORM 30-minute cap killed
 * build-to-7 mid-dim-001 every cycle: harden-crusade's inner per-dim autoresearch budget defaulted
 * to the SAME 30 minutes, so the outer kill always landed mid-cycle, the merge-back died with the
 * process, NOTHING persisted, and the next cycle restarted at dim001 — two fleet repos ran
 * identical no-progress cycles forever. Build phases (harden-crusade and the council crusades) now
 * get 60 minutes; paired with the 18m inner cycle budget + --max-minutes 55 checkpoint-exit they
 * finish and PERSIST on their own, so this cap is strictly a zombie guard, never the exit path.
 * Every other sub-command keeps the 30-minute cap.
 */
export function phaseTimeoutMs(args: string[]): number {
  const cmd = args[0] ?? '';
  if (cmd === 'harden-crusade' || cmd === 'council-crusade' || cmd === 'council') return 60 * 60_000;
  return 30 * 60_000;
}

function truncate(s: string | undefined, n = 4000): string | undefined {
  if (!s) return undefined;
  return s.length > n ? `${s.slice(0, n)}…[+${s.length - n} chars]` : s;
}

// ── Process-control seam (laws harness) ──────────────────────────────────────
// The L4 process-hygiene law (tests/laws/laws-l4-process-hygiene.test.ts) drives runCli with
// RECORDING implementations of the spawn/track/kill surface so the track↔untrack pairing and the
// timeout tree-kill (exit 124) path are machine-checked without real long-lived children.
// Production behavior is unchanged: the defaults below ARE the real functions, and nothing in
// src ever calls setRunnerProcessControl.

export interface RunnerProcessControl {
  spawnFn: typeof spawn;
  trackChildFn: typeof trackChild;
  untrackChildFn: typeof untrackChild;
  killTreeFn: typeof killTree;
  phaseTimeoutMsFn: (args: string[]) => number;
}

function realProcessControl(): RunnerProcessControl {
  return { spawnFn: spawn, trackChildFn: trackChild, untrackChildFn: untrackChild, killTreeFn: killTree, phaseTimeoutMsFn: phaseTimeoutMs };
}

let processControl: RunnerProcessControl = realProcessControl();

/** Install recording overrides (laws harness) or, with no argument, restore the real surface. */
export function setRunnerProcessControl(next?: Partial<RunnerProcessControl>): void {
  processControl = next ? { ...realProcessControl(), ...next } : realProcessControl();
}

// ── Budget-window awareness (self-challenge #7) ────────────────────────────────
// The agent CLIs share a session usage limit; when it fires, EVERY subsequent build/judge fails
// with the same error until the stated reset time ("You've hit your session limit · resets
// 7:10pm (America/New_York)"). Before this, a campaign near the limit burned its remaining cycles
// on guaranteed failures. The runner detects the error and records the reset instant; the
// orchestrator pauses the loop until then.

const BUDGET_LIMIT_RE = /session limit[^]{0,80}?resets\s+(\d{1,2}):(\d{2})\s*([ap]m)/i;
const BUDGET_RESET_MARGIN_MS = 2 * 60_000;
let budgetPauseUntilMs: number | null = null;

/** Parse a session-limit error out of sub-command output; records (and returns) the pause-until
 *  instant — the NEXT occurrence of the stated local time, plus a small margin. Pure given nowMs. */
export function noteBudgetLimit(output: string, nowMs: number = Date.now()): number | null {
  const m = BUDGET_LIMIT_RE.exec(output);
  if (!m) return null;
  let hours = Number.parseInt(m[1]!, 10) % 12;
  if (m[3]!.toLowerCase() === 'pm') hours += 12;
  const at = new Date(nowMs);
  at.setHours(hours, Number.parseInt(m[2]!, 10), 0, 0);
  let t = at.getTime();
  if (t <= nowMs) t += 24 * 3600_000; // the stated time already passed today → it names tomorrow's reset
  t += BUDGET_RESET_MARGIN_MS;
  budgetPauseUntilMs = Math.max(budgetPauseUntilMs ?? 0, t);
  return budgetPauseUntilMs;
}

export function getBudgetPauseUntil(): number | null { return budgetPauseUntilMs; }
export function clearBudgetPause(): void { budgetPauseUntilMs = null; }

export interface CourtParse {
  verdict: 'VALIDATED' | 'REJECTED';
  passedByJudges: string[];
  /** True when we could NOT read the court's answer (non-zero exit / no JSON) — REJECTED defensively. */
  parseError: boolean;
}

/**
 * Parse `frontier-review --json` output into a verdict. The key honesty property: absent/garbage
 * JSON yields `parseError: true` (verdict defensively REJECTED) so the caller can record "we don't
 * actually know" rather than treating a corrupt stream as a clean rejection.
 *
 * Exit-code coherence (live pilot finding, fleet run 3): the frontier-review CLI exits 1 on an
 * honest REJECTED *by design* — so a complete court JSON carrying REJECTED on a non-zero exit IS
 * a court that ran, and must be recorded as a rejection. The old `!res.ok` short-circuit booked
 * EVERY honest rejection as "court didn't run" (build failure), churning re-convened judges on
 * retries and never feeding the attempt ledger. VALIDATED always exits 0, so a non-zero exit
 * claiming VALIDATED is incoherent (e.g. --write failed after printing) — fail CLOSED there only.
 */
export function parseCourtOutput(res: { ok: boolean; stdout: string }): CourtParse {
  const brace = res.stdout.indexOf('{');
  if (brace === -1) return { verdict: 'REJECTED', passedByJudges: [], parseError: true };
  try {
    const j = JSON.parse(res.stdout.slice(brace)) as { result?: { verdict?: string; judges?: { verdict: string; judgeId: string }[] } };
    if (typeof j?.result?.verdict !== 'string') return { verdict: 'REJECTED', passedByJudges: [], parseError: true };
    const verdict = j.result.verdict === 'VALIDATED' ? 'VALIDATED' : 'REJECTED';
    if (!res.ok && verdict === 'VALIDATED') return { verdict: 'REJECTED', passedByJudges: [], parseError: true };
    const passedByJudges = (j.result.judges ?? []).filter(x => x.verdict === 'PASS').map(x => x.judgeId);
    return { verdict, passedByJudges, parseError: false };
  } catch {
    return { verdict: 'REJECTED', passedByJudges: [], parseError: true };
  }
}

function runOnce(cwd: string, args: string[]): Promise<CliResult> {
  const node = process.execPath;
  const cli = process.argv[1] ?? 'dist/index.js';
  const start = Date.now();
  // spawn + size-capped streaming capture — NOT execFile's fixed maxBuffer, which a long build
  // overflows → destroyed pipe → EPIPE / exit 127 with no ledger (DanteSecurity DS-024). We always
  // consume the data events (no backpressure) and keep only the last STREAM_TAIL_CAP bytes.
  return new Promise<CliResult>((resolve) => {
    let out = '', err = '', settled = false;
    let lastOutputAt = Date.now();
    const cap = (s: string) => (s.length > STREAM_TAIL_CAP ? s.slice(s.length - STREAM_TAIL_CAP) : s);
    // stdin:'ignore' — an unattended sub-command that prompts gets EOF and fails fast instead of
    // blocking forever (the silent autoresearch hang the fleet hit). detached on POSIX for group-kill.
    const child = processControl.spawnFn(node, [cli, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: SPAWN_DETACHED });
    processControl.trackChildFn(child.pid);
    const done = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      processControl.untrackChildFn(child.pid);
      // Budget-window awareness (self-challenge #7): agent CLIs surface their shared usage limit
      // as an error naming the reset time. Detect it here so the orchestrator can PAUSE until the
      // window reopens instead of burning cycles on builds/judges that all fail the same way.
      noteBudgetLimit(out + '\n' + err);
      resolve({ exitCode, stdout: out, stderr: err, ms: Date.now() - start, ok: exitCode === 0 });
    };
    // On timeout, kill the WHOLE tree (harden-crusade + its autoresearch grandchildren), not just the
    // direct child — otherwise the grandchildren orphan and accumulate as zombies across sessions.
    const timer = setTimeout(() => { lastTreeKillAt = Date.now(); processControl.killTreeFn(child.pid); done(124); }, processControl.phaseTimeoutMsFn(args));
    // LIVE ECHO + HEARTBEAT — the fleet's "silent stall": piped output was captured but never shown,
    // so a 20-min build-to-7 looked frozen and operators killed healthy runs. Echo the child's lines
    // as they arrive (prefixed, so the operator sees the real sub-command working), and when the child
    // goes quiet, say so every 60s with how long it has been silent — a stall is now an OBSERVED fact
    // ("silent for 12m"), not an inference from a blank console.
    const label = args[0] ?? 'sub-command';
    // ALWAYS echo to stderr: the parent's stdout is a machine contract (--json prints the final
    // result there) — interleaving sub-command lines into it would break every JSON consumer.
    const echo = (d: Buffer) => {
      lastOutputAt = Date.now();
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) process.stderr.write(`  [${label}] ${line}\n`);
      }
      return text;
    };
    const heartbeat = setInterval(() => {
      const silentMs = Date.now() - lastOutputAt;
      if (silentMs >= 55_000) {
        process.stderr.write(`  [${label}] … still running (${Math.round((Date.now() - start) / 60_000)}m elapsed, no output for ${Math.round(silentMs / 60_000)}m)\n`);
      }
    }, 60_000);
    child.stdout?.on('data', (d: Buffer) => { out = cap(out + echo(d)); });
    child.stderr?.on('data', (d: Buffer) => { err = cap(err + echo(d)); });
    // ENOENT (binary not found) → 127, matching a shell "command not found".
    child.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'ENOENT' ? 127 : 1));
    child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Run `node <cli> <args>` in `cwd`, capturing exit code, stdout, stderr and duration.
 *
 * NEVER throws — a failure is returned as `{ ok: false, exitCode }`, **logged loudly**, and recorded
 * to the active RunLedger, so the orchestrator can act on a failure rather than swallow it (the
 * council asked for exactly this: surface the failing command + exit code instead of a silent abort).
 *
 * A *fast* exit 127 / ENOENT (a command-not-found that failed at spawn time, before doing any work)
 * is the intermittent Windows child-spawn glitch the fleet hit — it is retried once after a short
 * backoff. A 127 that arrives only after real work ran (a deep child died) is NOT retried (it would
 * re-run minutes of work); it's returned for the loop to handle as a build failure.
 */
export async function runCli(cwd: string, args: string[]): Promise<CliResult> {
  // Breadcrumb BEFORE the spawn: if this parent is killed while the child runs, the post-resolve
  // logCommand() below never fires — without this line the run's commands-live.jsonl is empty and the
  // crash is undebuggable (DanteSecurity DS-026). Synchronous append guarantees it's on disk first.
  activeLedger?.logCommandStart('danteforge', args, cwd);
  // Kill/spawn race guard (live DanteForge run: parent died 5s after a 124 tree-kill, no logs):
  // the previous phase's timeout fires a DETACHED `taskkill /T /F` that enumerates the old child's
  // tree asynchronously — spawning the next phase immediately puts fresh PIDs in the reuse window
  // while that enumeration is still walking. Let the reaper finish before populating new PIDs.
  if (lastTreeKillAt > 0 && Date.now() - lastTreeKillAt < 5_000) {
    await new Promise(r => setTimeout(r, 5_000 - (Date.now() - lastTreeKillAt)));
  }
  let res = await runOnce(cwd, args);
  // Retry only a spawn-time 127/ENOENT (failed in <3s ⇒ nothing ran ⇒ transient spawn race).
  if (!res.ok && res.exitCode === 127 && res.ms < 3000) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] transient spawn failure (exit 127, ${res.ms}ms) for "danteforge ${args[0]}" — retrying once`);
    await new Promise(r => setTimeout(r, 750));
    res = await runOnce(cwd, args);
  }
  activeLedger?.logCommand('danteforge', args, res.exitCode, res.ms, truncate(res.stdout), truncate(res.stderr), cwd);
  if (!res.ok) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] sub-command FAILED (exit ${res.exitCode}, ${res.ms}ms): danteforge ${args.join(' ')}${res.stderr ? ` — ${truncate(res.stderr, 300)}` : ''}`);
  }
  return res;
}
