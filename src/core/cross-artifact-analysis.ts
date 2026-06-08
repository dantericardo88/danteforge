// cross-artifact-analysis.ts — the spec↔plan↔tasks consistency report.
//
// Score Ladder (planning_quality, rung 8) calls for a "cross-artifact analysis [that] reports
// coverage %, ambiguity count, and unmapped tasks" — proving requirement coverage before
// implementation, surfacing unresolved decisions, and catching hidden scope. Requirement coverage
// already lives in plan-quality-scorer's buildTraceabilityReport; this layer adds the two missing
// signals (ambiguity, unmapped tasks) and unifies all three into one persisted, observable artifact.
//
// It owns NO new "does this task cover this requirement?" heuristic — unmapped-task detection INVERTS
// buildTraceabilityReport's own output (the single source of truth), so the two can never drift.

import { buildTraceabilityReport, extractRequirements, type TraceabilityReport } from './plan-quality-scorer.js';

/** An unresolved-decision marker found in the spec (spec-kit's NEEDS CLARIFICATION convention + kin). */
export interface AmbiguityMarker { line: number; text: string; marker: string }

export interface CrossArtifactAnalysis {
  coverage: TraceabilityReport;
  /** Unresolved decisions still in the spec — each must be resolved before the plan is trustworthy. */
  ambiguities: AmbiguityMarker[];
  ambiguityCount: number;
  /** Plan/task lines that cover ZERO spec requirements — candidate hidden scope (build-not-asked-for). */
  unmappedTasks: string[];
  unmappedCount: number;
  /** True only when coverage is total, no decisions are unresolved, and nothing is unmapped. */
  clean: boolean;
}

// Unresolved-decision markers: the spec-kit convention the Score Ladder names, plus the common
// hand-authored equivalents enumerated below. Word-boundaried so longer words never false-match.
const AMBIGUITY_MARKERS: Array<{ marker: string; re: RegExp }> = [
  { marker: 'NEEDS CLARIFICATION', re: /NEEDS[\s_-]*CLARIFICATION/i },
  { marker: 'TBD', re: /\bTBD\b/ },
  { marker: '???', re: /\?\?\?/ },
  { marker: 'FIXME', re: /\bFIXME\b/ },
];

/** Count unresolved-decision markers in the spec, with the line each appears on. */
export function findAmbiguities(specText: string): AmbiguityMarker[] {
  const out: AmbiguityMarker[] = [];
  const lines = specText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { marker, re } of AMBIGUITY_MARKERS) {
      if (re.test(line)) { out.push({ line: i + 1, text: line.trim().slice(0, 120), marker }); break; }
    }
  }
  return out;
}

// The exact task-line shape buildTraceabilityReport recognises (numbered / bulleted). Kept in lockstep.
const TASK_LINE_RE = /^\s*(?:\d+[.)]\s+|\*\s+|-\s+)/;

/** Tasks that cover no requirement at all — the inverse of buildTraceabilityReport's coverage. We
 *  reuse the report's own `coveringTasks` (normalised identically: trim + 80-char slice) as the set
 *  of "tasks that covered something", so there is exactly one definition of coverage in the codebase. */
export function findUnmappedTasks(specText: string, planText: string): string[] {
  // No requirements → coverage is vacuously total and "unmapped" is meaningless; report none.
  if (extractRequirements(specText).length === 0) return [];
  const report = buildTraceabilityReport(specText, planText);
  const covered = new Set<string>();
  for (const row of report.rows) for (const t of row.coveringTasks) covered.add(t);

  const seen = new Set<string>();
  const unmapped: string[] = [];
  for (const raw of planText.split('\n')) {
    if (!TASK_LINE_RE.test(raw)) continue;
    const norm = raw.trim().slice(0, 80);
    if (covered.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    unmapped.push(norm);
  }
  return unmapped;
}

/** The full spec↔plan↔tasks analysis: coverage + ambiguity + unmapped, in one report. */
export function buildCrossArtifactAnalysis(specText: string, planText: string): CrossArtifactAnalysis {
  const coverage = buildTraceabilityReport(specText, planText);
  const ambiguities = findAmbiguities(specText);
  const unmappedTasks = findUnmappedTasks(specText, planText);
  return {
    coverage,
    ambiguities,
    ambiguityCount: ambiguities.length,
    unmappedTasks,
    unmappedCount: unmappedTasks.length,
    clean: coverage.uncoveredCount === 0 && ambiguities.length === 0 && unmappedTasks.length === 0,
  };
}

/** Render the persisted artifact (.danteforge/traceability.md). No timestamp in the body so the
 *  content is deterministic (the file mtime carries the time); receipts can diff it across runs. */
export function renderAnalysisMarkdown(a: CrossArtifactAnalysis): string {
  const c = a.coverage;
  const lines: string[] = [];
  lines.push('# Cross-Artifact Analysis (spec ↔ plan ↔ tasks)', '');
  lines.push('## Summary', '');
  lines.push(`- Requirement coverage: **${c.coveragePercent}%** (${c.totalRequirements - c.uncoveredCount}/${c.totalRequirements} covered, ${c.uncoveredCount} uncovered)`);
  lines.push(`- Unresolved decisions (ambiguity): **${a.ambiguityCount}**`);
  lines.push(`- Unmapped tasks (possible hidden scope): **${a.unmappedCount}**`);
  lines.push(`- Verdict: ${a.clean ? '✅ clean — coverage total, no unresolved decisions, no unmapped tasks' : '⚠ gaps remain (see below)'}`, '');

  if (c.uncoveredCount > 0) {
    lines.push('## Uncovered requirements', '');
    for (const row of c.rows.filter(r => !r.covered)) lines.push(`- \`${row.reqId}\` ${row.requirementText}`);
    lines.push('');
  }
  if (a.ambiguityCount > 0) {
    lines.push('## Unresolved decisions', '');
    for (const m of a.ambiguities) lines.push(`- L${m.line} [${m.marker}] ${m.text}`);
    lines.push('');
  }
  if (a.unmappedCount > 0) {
    lines.push('## Unmapped tasks (cover no requirement)', '');
    for (const t of a.unmappedTasks) lines.push(`- ${t}`);
    lines.push('');
  }
  return lines.join('\n');
}
