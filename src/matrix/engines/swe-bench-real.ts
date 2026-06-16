// swe-bench-real.ts — the REAL SWE-bench-lite grounding harness (CH-033), distinct from the toy
// swe-bench-grounding.ts (which runs @dantecode's self-authored VM instances — fake grounding).
//
// Honest external grounding requires evidence the grader CANNOT author:
//   - REAL instances: 300 published GitHub issues + repos + test patches (princeton-nlp/SWE-bench_Lite).
//   - The solver sees the PROBLEM STATEMENT only (never the test_patch or gold patch — that would leak
//     the answer); it must produce a repo patch the way a human engineer would.
//   - The GRADER is the OFFICIAL `swebench` harness (docker, per-instance reproducible test env). We do
//     not author the test environment, so a passing instance is world-consistent, not self-consistent.
//
// This module is PURE + seamed: the dataset fetch, repo clone, agentic solve, and docker grade are I/O
// the CLI (scripts/run-swebench-grounding.mjs) performs; here we parse the dataset rows, shape the
// predictions the official harness reads, and parse its report into a pass_rate. Fully unit-testable.

/** One real SWE-bench-lite instance. The solver is given problem_statement (+ the cloned repo) ONLY. */
export interface RealSweBenchInstance {
  instance_id: string;
  repo: string;            // e.g. "astropy/astropy"
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  /** Withheld from the solver — used only by the official grader. */
  FAIL_TO_PASS?: string;
  PASS_TO_PASS?: string;
  version?: string;
}

/** What the solver may see — the issue, never the tests. */
export interface SweBenchSolverInput {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
}

/** Parse the HF datasets-server rows response into typed instances. Skips rows missing required fields. */
export function parseDatasetRows(json: unknown): RealSweBenchInstance[] {
  const rows = (json as { rows?: Array<{ row?: Record<string, unknown> }> })?.rows ?? [];
  const out: RealSweBenchInstance[] = [];
  for (const r of rows) {
    const o = r?.row;
    if (!o) continue;
    const id = o['instance_id'], repo = o['repo'], base = o['base_commit'], ps = o['problem_statement'];
    if (typeof id !== 'string' || typeof repo !== 'string' || typeof base !== 'string' || typeof ps !== 'string') continue;
    out.push({
      instance_id: id, repo, base_commit: base, problem_statement: ps,
      hints_text: typeof o['hints_text'] === 'string' ? o['hints_text'] : undefined,
      FAIL_TO_PASS: typeof o['FAIL_TO_PASS'] === 'string' ? o['FAIL_TO_PASS'] : undefined,
      PASS_TO_PASS: typeof o['PASS_TO_PASS'] === 'string' ? o['PASS_TO_PASS'] : undefined,
      version: typeof o['version'] === 'string' ? o['version'] : undefined,
    });
  }
  return out;
}

/** Strip an instance down to what the solver is allowed to see (no tests/gold patch). */
export function toSolverInput(inst: RealSweBenchInstance): SweBenchSolverInput {
  return {
    instance_id: inst.instance_id, repo: inst.repo, base_commit: inst.base_commit,
    problem_statement: inst.problem_statement, hints_text: inst.hints_text,
  };
}

/** One line of the predictions.jsonl the official harness reads: {instance_id, model_name_or_path, model_patch}. */
export function buildPredictionLine(instanceId: string, modelName: string, modelPatch: string): string {
  return JSON.stringify({ instance_id: instanceId, model_name_or_path: modelName, model_patch: modelPatch });
}

export interface SweBenchGradeReport {
  total: number;
  resolved: number;
  pass_rate: number;
  resolved_ids: string[];
}

/**
 * Parse the official swebench harness report json into a pass_rate. The harness writes counts like
 * `resolved_instances` / `total_instances` (+ `resolved_ids`); be defensive about the exact field names
 * across versions. pass_rate = resolved / total over instances actually evaluated.
 */
export function parseSwebenchReport(json: unknown): SweBenchGradeReport {
  const o = (json ?? {}) as Record<string, unknown>;
  const num = (...keys: string[]): number => {
    for (const k of keys) { const v = o[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; }
    return 0;
  };
  const resolvedIds = Array.isArray(o['resolved_ids']) ? (o['resolved_ids'] as unknown[]).filter(x => typeof x === 'string') as string[] : [];
  const resolved = num('resolved_instances', 'resolved') || resolvedIds.length;
  const total = num('total_instances', 'total', 'submitted_instances', 'completed_instances') || resolved;
  return { total, resolved, pass_rate: total > 0 ? resolved / total : 0, resolved_ids: resolvedIds };
}

/** The stdout line external-benchmark-runner.parsePassRate reads — same shape as the HumanEval runner. */
export function formatPassRateLine(report: { pass_rate: number; resolved: number; total: number }): string {
  return JSON.stringify({ pass_rate: Number(report.pass_rate.toFixed(4)), resolved: report.resolved, total: report.total });
}

/** The HF datasets-server rows URL for a page of SWE-bench-lite (real published dataset). */
export function datasetRowsUrl(offset: number, length: number, dataset = 'princeton-nlp/SWE-bench_Lite'): string {
  const ds = encodeURIComponent(dataset);
  return `https://datasets-server.huggingface.co/rows?dataset=${ds}&config=default&split=test&offset=${offset}&length=${length}`;
}
