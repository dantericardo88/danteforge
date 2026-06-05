// frontier-course-corrector.ts — evidence-only stall diagnosis for the autonomous loop.
//
// When a build attempt does NOT move a dimension's score, the loop today just
// increments a counter and eventually gives up. This classifies WHY from HARD
// EVIDENCE ONLY — command exit codes (RunLedger), gate/court verdicts, outcome-
// integrity violations, the score delta, and the Time Machine diff (files changed)
// — never LLM prose — and recommends a BOUNDED next action. Same honesty principle
// as the scoring gate: cite a fact or don't classify.
//
// PURE by design: it reads facts and returns a verdict. The orchestrator
// (planNextAction) is the only place that acts on it. A per-dim diagnosis budget
// forces an honest ceiling instead of infinite churn.

export type StallCategory =
  | 'build-failed'    // a build command exited non-zero — it couldn't even run
  | 'unbuildable'     // external/environment blocker (command-not-found, network, missing tool)
  | 'orphan-still'    // the touched module still isn't production-wired (ORPHAN_CALLSITE persists)
  | 'wrong-outcome'   // the outcome's evidence is mis-anchored (CALLSITE_DECOUPLED / SEAM_USAGE persists)
  | 'no-op-build'     // commands ran clean but ZERO files changed — nothing was actually built
  | 'wrong-approach'  // files changed + build clean, but the score didn't move — the change missed the gap
  | 'honest-ceiling'; // the diagnosis budget is spent / evidence is at its honest max — stop, don't churn

export type CourseAction =
  | 'ground-orphan'    // wire the callsite into production / re-run ground-outcomes
  | 'fix-outcome'      // redefine the outcome so its test exercises the real callsite, seam-free
  | 'retry-decompose'  // retry with a decomposed / different approach (NOT the same change)
  | 'mark-unbuildable' // environment blocker → record a ceiling with the reason
  | 'honest-ceiling';  // stop: this is the natural frontier for the current evidence

/** Every diagnosis must carry at least one of these — a HARD fact, never prose. */
export interface StallEvidence { kind: 'exit-code' | 'integrity' | 'gate' | 'diff' | 'score-delta' | 'budget'; detail: string }

export interface StallDiagnosis {
  dimId: string;
  category: StallCategory;
  action: CourseAction;
  /** Non-empty by construction — the facts that justify the classification. */
  evidence: StallEvidence[];
  /** A short, evidence-grounded explanation for the ledger (no invented reasons). */
  rationale: string;
}

export interface StallInputs {
  dimId: string;
  scoreBefore: number;
  scoreAfter: number;
  /** From the RunLedger for this dim's last attempt. */
  commands: Array<{ command: string; exitCode: number }>;
  /** Non-integrity gate/court rejections (e.g. no-stub, taste, merge-court). */
  gateFailures: Array<{ gateName: string; detail?: string }>;
  /** checkOutcomeIntegrity violations scoped to this dim (kind = ORPHAN_CALLSITE / CALLSITE_DECOUPLED / SEAM_USAGE …). */
  integrityViolations: Array<{ kind: string; detail: string }>;
  /** Files the attempt changed, from the Time Machine diff of the build's commit(s). */
  filesChanged: number;
  /** How many course-corrections this dim has already had (the budget guard). */
  attemptsSoFar: number;
}

/** Max course-corrections before an honest ceiling — prevents infinite churn on misdiagnosis. */
export const MAX_COURSE_CORRECTIONS = 2;

const ENV_BLOCK_RE = /not found|command not found|ENOENT|cannot find module|no such file|network|ECONN|ETIMEDOUT|getaddrinfo|EAI_AGAIN|permission denied/i;

/**
 * Classify why a build didn't move the score, from evidence only. Call ONLY when
 * scoreAfter <= scoreBefore (the build stalled). The order is deliberate: the most
 * concrete, least-ambiguous signals first (a non-zero exit code is unarguable; a
 * "wrong-approach" inference is last and weakest).
 */
export function diagnoseStall(input: StallInputs): StallDiagnosis {
  const dimId = input.dimId;
  const mk = (category: StallCategory, action: CourseAction, evidence: StallEvidence[], rationale: string): StallDiagnosis =>
    ({ dimId, category, action, evidence, rationale });

  // 0. Budget guard FIRST — an honest ceiling beats churning on a shaky re-diagnosis.
  if (input.attemptsSoFar >= MAX_COURSE_CORRECTIONS) {
    return mk('honest-ceiling', 'honest-ceiling',
      [{ kind: 'budget', detail: `${input.attemptsSoFar} course-correction(s) already spent (max ${MAX_COURSE_CORRECTIONS})` }],
      `${dimId}: course-correction budget exhausted — record an honest ceiling rather than retry blindly.`);
  }

  // 1. A build command exited non-zero — it couldn't run. Distinguish env-blocked from a real build failure.
  const failed = input.commands.filter(c => c.exitCode !== 0);
  if (failed.length > 0) {
    const envBlocked = failed.find(c => c.exitCode === 127 || ENV_BLOCK_RE.test(c.command));
    const ev: StallEvidence[] = [{ kind: 'exit-code', detail: `\`${failed[0]!.command.slice(0, 70)}\` exited ${failed[0]!.exitCode}` }];
    if (envBlocked) {
      return mk('unbuildable', 'mark-unbuildable', ev,
        `${dimId}: an environment blocker (exit ${envBlocked.exitCode}) prevents the build — mark a ceiling with the reason, don't retry.`);
    }
    return mk('build-failed', 'retry-decompose', ev,
      `${dimId}: the build command failed (exit ${failed[0]!.exitCode}) — decompose and retry a smaller change.`);
  }

  // 2. Outcome-integrity still flags this dim — the evidence isn't honestly anchored, so the score can't rise.
  const orphan = input.integrityViolations.find(v => v.kind === 'ORPHAN_CALLSITE');
  if (orphan) {
    return mk('orphan-still', 'ground-orphan', [{ kind: 'integrity', detail: orphan.detail.slice(0, 90) }],
      `${dimId}: the callsite is still not wired into production (orphan) — wire it / re-ground, don't keep building tests.`);
  }
  const coupling = input.integrityViolations.find(v => v.kind === 'CALLSITE_DECOUPLED' || v.kind === 'SEAM_USAGE');
  if (coupling) {
    return mk('wrong-outcome', 'fix-outcome', [{ kind: 'integrity', detail: coupling.detail.slice(0, 90) }],
      `${dimId}: the outcome's evidence is mis-anchored (${coupling.kind}) — fix the outcome so a seam-free test exercises the real callsite.`);
  }

  // 3. Commands ran clean but NOTHING changed on disk — the build was a no-op.
  if (input.filesChanged === 0) {
    return mk('no-op-build', 'retry-decompose', [{ kind: 'diff', detail: 'Time Machine shows 0 files changed this attempt' }],
      `${dimId}: the attempt changed no files — the approach produced no real change; decompose into a concrete edit.`);
  }

  // 4. A non-integrity gate/court rejected the work.
  if (input.gateFailures.length > 0) {
    const g = input.gateFailures[0]!;
    return mk('wrong-approach', 'retry-decompose', [{ kind: 'gate', detail: `gate "${g.gateName}" failed${g.detail ? ': ' + g.detail.slice(0, 60) : ''}` }],
      `${dimId}: a court/gate rejected the change (${g.gateName}) — change approach to satisfy it.`);
  }

  // 5. Files changed, build clean, no integrity/gate issue — but the score held. The change missed the gap.
  return mk('wrong-approach', 'retry-decompose',
    [{ kind: 'score-delta', detail: `${input.filesChanged} file(s) changed but score held at ${input.scoreAfter.toFixed(1)}` }],
    `${dimId}: the build was clean but the score didn't move — the change didn't address the scored gap; try a different angle.`);
}

/** A diagnosis that ends the dim's campaign honestly (no further build will help). */
export function isCeiling(d: StallDiagnosis): boolean {
  return d.category === 'honest-ceiling' || d.category === 'unbuildable';
}

export function formatDiagnosis(d: StallDiagnosis): string {
  const facts = d.evidence.map(e => `${e.kind}:${e.detail}`).join(' | ');
  return `[course-correct] ${d.dimId} → ${d.category} ⇒ ${d.action}  (${facts})`;
}
