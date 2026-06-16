// swe-bench-grounding.ts — the honest first external-grounding harness (master-plan Phase 2).
//
// Drives a registered code-generation benchmark (the @dantecode/swe-bench-runner built-in instances)
// as a real capability measurement: for each instance the SOLVER sees ONLY the test spec (test_patch)
// and the instance id — NEVER the gold patch — and must generate a candidate that makes the test pass.
// pass_rate is the fraction solved: a WORLD-consistent measure of DanteForge-orchestrated code
// generation, not a self-authored claim. The output line is shaped for external-benchmark-runner's
// parsePassRate, so a real run mints a real `external-benchmark` grounding receipt.
//
// IMPORTANT (set expectations — sibling-chat audit): grounding MEASURES capability, it does not CREATE
// it. The first honest pass_rate will likely be modest (a true fraction, not 1.0) — that is a SUCCESS
// (the first >0% externally-grounded score), and the gap to a frontier 9 is the named depth backlog.
//
// This module is PURE and seamed: `solve` (the agent) and `runTest` (the sandbox) are injected, so the
// plumbing is fully unit-tested with fake solvers. The real, compute-bound agent solver is wired by the
// CLI entry (scripts/swe-bench-grounding.mjs) — the one step that needs LLM compute.

/** A built-in benchmark instance: id + gold patch + gold test. The gold patch is the answer key. */
export interface SweBenchInstance {
  instance_id: string;
  patch: string;
  test_patch: string;
}

/** What the solver is allowed to see — the spec ONLY. The gold `patch` is deliberately withheld. */
export interface SweBenchProblem {
  instance_id: string;
  test_patch: string;
}

export interface SweBenchRunResult {
  instance_id: string;
  resolved: boolean;
  error?: string;
  durationMs: number;
}

export interface SweBenchReport {
  total: number;
  resolved: number;
  /** 0..1 fraction of instances the solver's candidate actually passed. */
  pass_rate: number;
  results: SweBenchRunResult[];
}

/** The agent: given a problem (spec only), produce a candidate patch. */
export type Solver = (problem: SweBenchProblem) => Promise<string>;

/** The sandbox: run a candidate patch against the test (e.g. swe-bench-runner's runTestPatch). */
export type TestRunner = (
  patch: string,
  testPatch: string,
  instanceId: string,
) => Promise<{ passed: boolean; error?: string; durationMs: number }>;

/**
 * Run the grounding benchmark. For each instance: hand the solver ONLY the spec (gold patch withheld),
 * run its candidate against the gold test, and record whether it resolved. A solver that throws scores
 * that instance as unresolved (never a crash, never a silent pass). Returns the aggregate report.
 */
export async function runSweBenchGrounding(
  instances: SweBenchInstance[],
  solve: Solver,
  runTest: TestRunner,
): Promise<SweBenchReport> {
  const results: SweBenchRunResult[] = [];
  for (const inst of instances) {
    const problem: SweBenchProblem = { instance_id: inst.instance_id, test_patch: inst.test_patch };
    let candidate: string;
    try {
      candidate = await solve(problem);
    } catch (err) {
      results.push({
        instance_id: inst.instance_id, resolved: false,
        error: `solver error: ${err instanceof Error ? err.message : String(err)}`, durationMs: 0,
      });
      continue;
    }
    const r = await runTest(candidate, inst.test_patch, inst.instance_id);
    results.push({ instance_id: inst.instance_id, resolved: r.passed, error: r.error, durationMs: r.durationMs });
  }
  const resolved = results.filter(r => r.resolved).length;
  return { total: results.length, resolved, pass_rate: results.length ? resolved / results.length : 0, results };
}

/**
 * Emit a single stdout line the external-benchmark-runner's parsePassRate recognizes (the JSON
 * `"pass_rate"` shape is its first, unambiguous pattern). This is what the registered `command`
 * prints so the grounding receipt records the real fraction.
 */
export function formatPassRateLine(report: SweBenchReport): string {
  return JSON.stringify({ pass_rate: Number(report.pass_rate.toFixed(4)), resolved: report.resolved, total: report.total });
}
