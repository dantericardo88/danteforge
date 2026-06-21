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

/**
 * CH-047 (grade-in-the-loop): extract the GRADER's own regressions from a report.json — the failing
 * PASS_TO_PASS (must-stay-green) tests. This is the faithful regression signal the local pip-env gate
 * CANNOT produce on env-mismatch instances (CH-043: the gate self-disables when the local env can't
 * reproduce the grader's environment). Returns the failing test ids ONLY when the instance is
 * FIXED-BUT-REGRESSED (target fully fixed; regressions are the sole blocker) — the exact case where
 * feeding these back and re-solving can flip the instance to resolved. Returns null when there is nothing
 * actionable to feed back: resolved already, or the target isn't fixed yet (then the fix — not regressions —
 * is the blocker, a different feedback). Pure: the grade-in-the-loop driver pairs this with
 * formatRegressionFeedback (regression-gate.ts) to build the next-iteration prompt.
 */
export function regressionsFromGradeReport(
  report: SwebenchReport,
): { regressions: string[]; targetFixed: number } | null {
  const analysis = categorizeInstanceResult(report);
  if (analysis.category !== 'fixed-but-regressed') return null;
  const regressions = report.PASS_TO_PASS?.failure ?? [];
  if (regressions.length === 0) return null;
  return { regressions: [...regressions], targetFixed: analysis.targetFixed };
}

/** Wilson score 95% CI for a proportion — the honest uncertainty band on a small-n pass rate. At n=6 a
 *  "2/6 vs 1/6 = +100% lift" overlaps massively; reporting the band keeps a small-sample delta from becoming
 *  the new flattering headline (the exact self-flattery the measurement spine exists to kill). */
export function wilsonInterval(resolved: number, total: number, z = 1.96): { low: number; high: number } {
  if (total <= 0) return { low: 0, high: 0 };
  const p = resolved / total, z2 = z * z, denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export interface ResultsSummary {
  total: number;
  resolved: number;
  passRate: number;
  /** 95% Wilson CI on passRate — report this, never the bare rate, on small n. */
  passRateCI: { low: number; high: number };
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
    passRateCI: wilsonInterval(resolved, total),
    byCategory,
    regressionShareOfUnresolved: unresolved > 0 ? byCategory['fixed-but-regressed'] / unresolved : 0,
  };
}
