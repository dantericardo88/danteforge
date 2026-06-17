// swebench-failure-analysis.ts — classify WHY a SWE-bench instance did not resolve, from its grade
// report.json. The first contamination-resistant grade showed the dominant failure mode is NOT "couldn't
// fix" but "fixed-but-regressed" (target FAIL_TO_PASS all pass, yet a few PASS_TO_PASS existing tests broke).
// Turning that by-hand forensic into a tested function makes every future grade an instant diagnosis and
// validates the regression-hypothesis at scale (is fixed-but-regressed still dominant at n=20?).

/** The subset of a SWE-bench grade report.json this analysis needs. */
export interface SwebenchReport {
  instance_id?: string;
  resolved?: boolean;
  FAIL_TO_PASS?: { success?: string[]; failure?: string[] };
  PASS_TO_PASS?: { success?: string[]; failure?: string[] };
}

/**
 * - resolved:            graded as resolved (target fixed AND no required regressions).
 * - fixed-but-regressed: ALL target (FAIL_TO_PASS) tests pass, but ≥1 PASS_TO_PASS existing test broke.
 *                        This is the tractable mode — the solver CAN fix; it lacks regression discipline.
 * - partial-fix:         some target tests pass, some still fail.
 * - no-fix:              no target test passes (the solver did not fix the bug).
 * - no-target-tests:     the instance declares no FAIL_TO_PASS tests (ill-posed for "did it fix").
 */
export type FailureCategory =
  | 'resolved' | 'fixed-but-regressed' | 'partial-fix' | 'no-fix' | 'no-target-tests';

export interface InstanceAnalysis {
  instanceId: string;
  category: FailureCategory;
  targetFixed: number;
  targetTotal: number;
  regressions: number;
}

export function categorizeInstanceResult(report: SwebenchReport): InstanceAnalysis {
  const f2p = report.FAIL_TO_PASS ?? {};
  const p2p = report.PASS_TO_PASS ?? {};
  const fs = (f2p.success ?? []).length, ff = (f2p.failure ?? []).length;
  const pf = (p2p.failure ?? []).length;
  const base = { instanceId: report.instance_id ?? '?', targetFixed: fs, targetTotal: fs + ff, regressions: pf };

  let category: FailureCategory;
  if (report.resolved) category = 'resolved';
  else if (fs + ff === 0) category = 'no-target-tests';
  else if (ff === 0 && pf > 0) category = 'fixed-but-regressed'; // target fully fixed, only regressions remain
  else if (fs > 0) category = 'partial-fix';
  else category = 'no-fix';
  return { ...base, category };
}

export interface ResultsSummary {
  total: number;
  resolved: number;
  passRate: number;
  byCategory: Record<FailureCategory, number>;
  /** Of the UNRESOLVED instances, the fraction in the tractable fixed-but-regressed mode. */
  regressionShareOfUnresolved: number;
}

export function summarizeResults(reports: SwebenchReport[]): ResultsSummary {
  const byCategory: Record<FailureCategory, number> = {
    resolved: 0, 'fixed-but-regressed': 0, 'partial-fix': 0, 'no-fix': 0, 'no-target-tests': 0,
  };
  for (const r of reports) byCategory[categorizeInstanceResult(r).category]++;
  const total = reports.length;
  const resolved = byCategory.resolved;
  const unresolved = total - resolved;
  return {
    total,
    resolved,
    passRate: total > 0 ? resolved / total : 0,
    byCategory,
    regressionShareOfUnresolved: unresolved > 0 ? byCategory['fixed-but-regressed'] / unresolved : 0,
  };
}
