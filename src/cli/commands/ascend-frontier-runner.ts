// ascend-frontier-runner.ts — the typed CLI runner + run-ledger plumbing for the orchestrator.
//
// The council flagged the orchestrator's old `df()` helper as "a side-effect shell pipeline that
// swallows failures and infers truth by re-reading state": it ran the CLI inside `.catch(() => {})`,
// throwing away exit code AND stderr, so a half-failed command looked identical to success.
//
// `runCli` replaces it: it NEVER throws, but it also never discards what happened — every invocation
// returns a typed {exitCode, stdout, stderr, ms, ok} and is recorded to the active RunLedger. A
// non-zero exit is now visible in the run bundle instead of being silently inferred away.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunLedger } from '../../core/run-ledger.js';

const execFileAsync = promisify(execFile);

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

async function runOnce(cwd: string, args: string[]): Promise<CliResult> {
  const node = process.execPath;
  const cli = process.argv[1] ?? 'dist/index.js';
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(node, [cli, ...args], {
      cwd, timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024,
    });
    return { exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '', ms: Date.now() - start, ok: true };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    // ENOENT (binary not found) surfaces as a string code; a shell "command not found" is exit 127.
    const exitCode = typeof err.code === 'number' ? err.code : err.code === 'ENOENT' ? 127 : 1;
    return { exitCode, stdout: err.stdout ?? '', stderr: err.stderr ?? err.message ?? '', ms: Date.now() - start, ok: false };
  }
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
  let res = await runOnce(cwd, args);
  // Retry only a spawn-time 127/ENOENT (failed in <3s ⇒ nothing ran ⇒ transient spawn race).
  if (!res.ok && res.exitCode === 127 && res.ms < 3000) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] transient spawn failure (exit 127, ${res.ms}ms) for "danteforge ${args[0]}" — retrying once`);
    await new Promise(r => setTimeout(r, 750));
    res = await runOnce(cwd, args);
  }
  activeLedger?.logCommand('danteforge', args, res.exitCode, res.ms, truncate(res.stdout), truncate(res.stderr));
  if (!res.ok) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] sub-command FAILED (exit ${res.exitCode}, ${res.ms}ms): danteforge ${args.join(' ')}${res.stderr ? ` — ${truncate(res.stderr, 300)}` : ''}`);
  }
  return res;
}
