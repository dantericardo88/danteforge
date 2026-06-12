// outcome-author.ts — productize the proven evidence-scout recipe (self-challenge #6).
//
// The fleet's bottleneck: re-authoring placeholder outcome suites at scale was operator-driven
// agent work. The recipe that earned DanteForge's 11 honest T5s is mechanical, though: run a REAL
// product command twice, require identical exits, select stdout patterns that are STABLE across
// both runs and safe for the cli-smoke runner (which evaluates patterns as case-insensitive
// regexes — "[daemon]"-style literals silently never match; that seam burned three receipts live),
// and write the declaration. What stays honest/manual: the production callsite (the caller must
// name it — inventing callsites is exactly what the fabrication era did) and the capability fit
// (the verifier/court judges that). Never weakens a gate: the declaration still has to RUN and
// pass validate to earn anything.

import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { looksLikeProductRun } from '../../core/frontier-spec.js';
import { isTestSuiteCommand } from './outcome-quality.js';

export interface AuthorRun { exitCode: number; stdoutText: string; ms: number }

export interface OutcomeAuthorOptions {
  cwd: string;
  dimId: string;
  /** The REAL product command to author from (e.g. `node dist/index.js lessons`). */
  command: string;
  /** Production src/ file this command's code path exercises — named by the caller, never invented. */
  callsite: string;
  write?: boolean;
  _run?: (cmd: string, cwd: string) => Promise<AuthorRun>;
}

export interface OutcomeAuthorResult {
  ok: boolean;
  reason: string;
  outcome?: Record<string, unknown>;
  proof?: { exitCodes: number[]; patterns: string[]; durationsMs: number[] };
  wrote: boolean;
}

async function defaultRun(cmd: string, cwd: string): Promise<AuthorRun> {
  const start = Date.now();
  return await new Promise((resolve) => {
    execFile(cmd, { cwd, shell: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ exitCode: typeof code === 'number' ? code : 1, stdoutText: String(stdout ?? ''), ms: Date.now() - start });
    });
  });
}

/** Regex metacharacters the cli-smoke runner would misinterpret (it compiles patterns as regexes). */
const REGEX_META = /[[\]().|^$*+?{}\\]/;
/** Run-varying content that flakes receipts: ISO timestamps, clock times, durations, hex ids, abs paths. */
const VOLATILE = /\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|\d+\s*ms\b|0x[0-9a-f]{4,}|[0-9a-f]{12,}|[A-Z]:\\|\/(?:home|Users)\//i;

/** Select 2-3 stdout patterns that are stable across BOTH runs, metachar-free, and distinctive.
 *  Exported for the pin. */
export function selectStablePatterns(runA: string, runB: string, max = 3): string[] {
  const linesB = new Set(runB.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of runA.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !linesB.has(line) || seen.has(line)) continue;
    seen.add(line);
    if (line.length < 8 || line.length > 90) continue;
    if (REGEX_META.test(line) || VOLATILE.test(line)) continue;
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export async function authorProductOutcome(options: OutcomeAuthorOptions): Promise<OutcomeAuthorResult> {
  const { cwd, dimId, command, callsite } = options;
  const run = options._run ?? defaultRun;

  if (isTestSuiteCommand(command)) {
    return { ok: false, wrote: false, reason: `"${command}" is a test-runner command — test-suite receipts cap at T4; a T5 outcome must run the actual product.` };
  }
  if (!looksLikeProductRun(command)) {
    return { ok: false, wrote: false, reason: `"${command}" is not a real product invocation (node dist/index.js <cmd> / danteforge <cmd>; --help/version screens prove nothing).` };
  }
  if (!callsite || !callsite.startsWith('src/') || /test/i.test(callsite)) {
    return { ok: false, wrote: false, reason: `callsite "${callsite}" must be a production src/ file (not a test) — name the real module this command executes.` };
  }

  const a = await run(command, cwd);
  if (a.exitCode !== 0) return { ok: false, wrote: false, reason: `run 1 exited ${a.exitCode} — an outcome must be authorable from a command that genuinely works.` };
  const b = await run(command, cwd);
  if (b.exitCode !== a.exitCode) return { ok: false, wrote: false, reason: `exit codes differ across consecutive runs (${a.exitCode} vs ${b.exitCode}) — nondeterministic commands make flaky receipts.` };

  const patterns = selectStablePatterns(a.stdoutText, b.stdoutText);
  if (patterns.length < 2) {
    return { ok: false, wrote: false, reason: `only ${patterns.length} stable, runner-safe stdout pattern(s) found across two runs — the receipt would be too weak (need ≥2; volatile/metachar lines are excluded).` };
  }

  // cli-smoke when the command is the dist CLI (the runner spawns `node dist/index.js <cli_args>`);
  // runtime-exec otherwise (still a product run per the guards above).
  const distMatch = /node\s+dist\/index\.js\s+(.+)$/.exec(command.trim());
  const outcome: Record<string, unknown> = distMatch
    ? { id: `${dimId}_t5_authored`, tier: 'T5', kind: 'cli-smoke', cli_args: distMatch[1]!.split(/\s+/), expected_exit: 0, expected_stdout_patterns: patterns, required_callsite: callsite, timeout_ms: 120_000, description: `Authored product run: \`${command}\` — patterns verified stable across two consecutive runs.` }
    : { id: `${dimId}_t5_authored`, tier: 'T5', kind: 'runtime-exec', command, expected_exit: 0, expected_output_pattern: patterns[0], required_callsite: callsite, timeout_ms: 120_000, description: `Authored product run: \`${command}\` — output verified stable across two consecutive runs.` };

  let wrote = false;
  if (options.write) {
    const mPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
    const raw = await fs.readFile(mPath, 'utf8');
    const bom = raw.charCodeAt(0) === 0xfeff;
    const matrix = JSON.parse(bom ? raw.slice(1) : raw) as { dimensions: Array<{ id: string; outcomes?: Array<{ id: string }> }> };
    const dim = matrix.dimensions.find(d => d.id === dimId);
    if (!dim) return { ok: false, wrote: false, reason: `dimension "${dimId}" not found in matrix.` };
    dim.outcomes = dim.outcomes ?? [];
    if (dim.outcomes.some(o => o.id === outcome['id'])) {
      return { ok: false, wrote: false, reason: `outcome id "${String(outcome['id'])}" already declared — drop it first or author under a different dim.`, outcome };
    }
    dim.outcomes.push(outcome as { id: string });
    await fs.writeFile(mPath, (bom ? '﻿' : '') + JSON.stringify(matrix, null, 2), 'utf8');
    wrote = true;
  }

  return {
    ok: true, wrote, outcome,
    proof: { exitCodes: [a.exitCode, b.exitCode], patterns, durationsMs: [a.ms, b.ms] },
    reason: `authored a T5 product-run declaration with ${patterns.length} stable patterns${wrote ? ' (written to matrix.json — run `danteforge validate` to earn the receipt)' : ' (dry-run: re-run with --write)'}.`,
  };
}
