// humaneval-grounding.ts — wire the grounding pattern to the REAL HumanEval suite (master-plan Phase 2).
//
// HumanEval (164 public Python problems) is a REGISTERED external suite, so a real pass_rate here is a
// LEGITIMATE external-grounding receipt — unlike the swe-bench-runner's toy built-ins. The solver sees
// only the prompt (function signature + docstring); the canonical_solution is WITHHELD. runHumanEvalTest
// assembles `prompt + completion + test + check(entry_point)` and executes it in a Python subprocess.
// pass_rate is the honest fraction solved.
//
// What is VERIFIED here (no LLM compute): the loader + the Python runner + the aggregation — a gold
// completion passes, a wrong one fails (see tests/humaneval-grounding.test.ts). The agent SOLVER is the
// one compute seam, wired by scripts/run-humaneval-grounding.mjs to a real agent at run time.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPassRateLine, type SweBenchReport as GroundingReport } from './swe-bench-grounding.js';

export { formatPassRateLine, type GroundingReport };

export interface HumanEvalProblem {
  task_id: string;
  /** Function signature + docstring shown to the solver. */
  prompt: string;
  entry_point: string;
  /** Defines `def check(candidate): ...` with the assertions. */
  test: string;
  /** The GOLD body — WITHHELD from the solver; used only to verify the runner. */
  canonical_solution: string;
}

/** What the solver is allowed to see — never the canonical_solution. */
export interface HumanEvalSpec { task_id: string; prompt: string; entry_point: string; }

export type HumanEvalSolver = (spec: HumanEvalSpec) => Promise<string>;

/** Execute a Python program, returning the exit status + stderr tail. Seam-injectable for tests. */
export type PythonRunner = (program: string) => { status: number | null; stderr: string };

const defaultPython: PythonRunner = (program) => {
  const dir = mkdtempSync(join(tmpdir(), 'humaneval-'));
  const file = join(dir, 'prog.py');
  try {
    writeFileSync(file, program, 'utf8');
    const r = spawnSync('python', [file], { encoding: 'utf8', timeout: 15_000 });
    return { status: r.status, stderr: (r.stderr ?? '') + (r.error ? `\n${String(r.error)}` : '') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/**
 * Run one HumanEval problem against a candidate completion. HumanEval convention: the completion is the
 * function BODY appended to the prompt; the test defines `check(candidate)`; we append `check(entry)`.
 * Passed = the Python process exits 0 (no assertion failed).
 */
export function runHumanEvalTest(
  problem: HumanEvalProblem,
  completion: string,
  python: PythonRunner = defaultPython,
): { passed: boolean; error?: string } {
  const program = `${problem.prompt}${completion}\n\n${problem.test}\n\ncheck(${problem.entry_point})\n`;
  const r = python(program);
  if (r.status === 0) return { passed: true };
  return { passed: false, error: (r.stderr || `python exit ${r.status}`).split('\n').slice(-6).join('\n') };
}

/**
 * Run the HumanEval grounding benchmark. For each problem: hand the solver ONLY the spec (canonical
 * withheld), execute its completion, record resolved/not. A throwing solver scores that problem unresolved
 * (never a crash, never a silent pass). Returns the aggregate report; formatPassRateLine emits the line
 * the external-benchmark-runner reads.
 */
export async function runHumanEvalGrounding(
  problems: HumanEvalProblem[],
  solve: HumanEvalSolver,
  runTest: (p: HumanEvalProblem, completion: string) => { passed: boolean; error?: string } = (p, c) => runHumanEvalTest(p, c),
): Promise<GroundingReport> {
  const results: GroundingReport['results'] = [];
  for (const p of problems) {
    let completion: string;
    try {
      completion = await solve({ task_id: p.task_id, prompt: p.prompt, entry_point: p.entry_point });
    } catch (err) {
      results.push({ instance_id: p.task_id, resolved: false, error: `solver error: ${err instanceof Error ? err.message : String(err)}`, durationMs: 0 });
      continue;
    }
    const start = Date.now();
    const r = runTest(p, completion);
    results.push({ instance_id: p.task_id, resolved: r.passed, error: r.error, durationMs: Date.now() - start });
  }
  const resolved = results.filter(r => r.resolved).length;
  return { total: results.length, resolved, pass_rate: results.length ? resolved / results.length : 0, results };
}

/** Parse a HumanEval .jsonl (one problem object per line) into typed problems. Skips blank/garbage lines. */
export function parseHumanEvalJsonl(text: string): HumanEvalProblem[] {
  const out: HumanEvalProblem[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Partial<HumanEvalProblem>;
      if (o.task_id && typeof o.prompt === 'string' && o.entry_point && typeof o.test === 'string') {
        out.push({ task_id: o.task_id, prompt: o.prompt, entry_point: o.entry_point, test: o.test, canonical_solution: o.canonical_solution ?? '' });
      }
    } catch { /* skip malformed line */ }
  }
  return out;
}
