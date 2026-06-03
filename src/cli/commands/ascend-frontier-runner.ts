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

/**
 * Run `node <cli> <args>` in `cwd`, capturing exit code, stdout, stderr and duration.
 * NEVER throws — a failure is returned as `{ ok: false, exitCode }` and logged to the active
 * RunLedger, so the orchestrator can act on (or at least record) a failure rather than swallow it.
 */
export async function runCli(cwd: string, args: string[]): Promise<CliResult> {
  const node = process.execPath;
  const cli = process.argv[1] ?? 'dist/index.js';
  const start = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(node, [cli, ...args], {
      cwd, timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024,
    });
    const ms = Date.now() - start;
    activeLedger?.logCommand('danteforge', args, 0, ms, truncate(stdout), truncate(stderr));
    return { exitCode: 0, stdout: stdout ?? '', stderr: stderr ?? '', ms, ok: true };
  } catch (e) {
    const ms = Date.now() - start;
    const err = e as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const exitCode = typeof err.code === 'number' ? err.code : 1;
    const stdout = err.stdout ?? '';
    const stderr = err.stderr ?? err.message ?? '';
    activeLedger?.logCommand('danteforge', args, exitCode, ms, truncate(stdout), truncate(stderr));
    return { exitCode, stdout, stderr, ms, ok: false };
  }
}
