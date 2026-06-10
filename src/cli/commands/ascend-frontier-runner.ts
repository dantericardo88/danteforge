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

function truncate(s: string | undefined, n = 4000): string | undefined {
  if (!s) return undefined;
  return s.length > n ? `${s.slice(0, n)}…[+${s.length - n} chars]` : s;
}

export interface CourtParse {
  verdict: 'VALIDATED' | 'REJECTED';
  passedByJudges: string[];
  /** True when we could NOT read the court's answer (non-zero exit / no JSON) — REJECTED defensively. */
  parseError: boolean;
}

/**
 * Parse `frontier-review --json` output into a verdict. The key honesty property: a non-zero exit
 * or absent/garbage JSON yields `parseError: true` (verdict defensively REJECTED) so the caller can
 * record "we don't actually know" rather than treating a corrupt stream as a clean rejection.
 */
export function parseCourtOutput(res: { ok: boolean; stdout: string }): CourtParse {
  const brace = res.stdout.indexOf('{');
  if (!res.ok || brace === -1) return { verdict: 'REJECTED', passedByJudges: [], parseError: true };
  try {
    const j = JSON.parse(res.stdout.slice(brace)) as { result?: { verdict?: string; judges?: { verdict: string; judgeId: string }[] } };
    const verdict = j?.result?.verdict === 'VALIDATED' ? 'VALIDATED' : 'REJECTED';
    const passedByJudges = (j?.result?.judges ?? []).filter(x => x.verdict === 'PASS').map(x => x.judgeId);
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
    const child = spawn(node, [cli, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: SPAWN_DETACHED });
    trackChild(child.pid);
    const done = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      untrackChild(child.pid);
      resolve({ exitCode, stdout: out, stderr: err, ms: Date.now() - start, ok: exitCode === 0 });
    };
    // On timeout, kill the WHOLE tree (harden-crusade + its autoresearch grandchildren), not just the
    // direct child — otherwise the grandchildren orphan and accumulate as zombies across sessions.
    const timer = setTimeout(() => { killTree(child.pid); done(124); }, 30 * 60_000);
    // LIVE ECHO + HEARTBEAT — the fleet's "silent stall": piped output was captured but never shown,
    // so a 20-min build-to-7 looked frozen and operators killed healthy runs. Echo the child's lines
    // as they arrive (prefixed, so the operator sees the real sub-command working), and when the child
    // goes quiet, say so every 60s with how long it has been silent — a stall is now an OBSERVED fact
    // ("silent for 12m"), not an inference from a blank console.
    const label = args[0] ?? 'sub-command';
    const echo = (d: Buffer, stream: NodeJS.WriteStream) => {
      lastOutputAt = Date.now();
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) stream.write(`  [${label}] ${line}\n`);
      }
      return text;
    };
    const heartbeat = setInterval(() => {
      const silentMs = Date.now() - lastOutputAt;
      if (silentMs >= 55_000) {
        process.stderr.write(`  [${label}] … still running (${Math.round((Date.now() - start) / 60_000)}m elapsed, no output for ${Math.round(silentMs / 60_000)}m)\n`);
      }
    }, 60_000);
    child.stdout?.on('data', (d: Buffer) => { out = cap(out + echo(d, process.stdout)); });
    child.stderr?.on('data', (d: Buffer) => { err = cap(err + echo(d, process.stderr)); });
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
