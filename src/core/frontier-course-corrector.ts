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
  /** Non-integrity gate/court rejections (e.g. taste-gate, merge-court, red-team). */
  gateFailures: Array<{ gateName: string; detail?: string }>;
  /** checkOutcomeIntegrity violations scoped to this dim (kind = ORPHAN_CALLSITE / CALLSITE_DECOUPLED / SEAM_USAGE …). */
  integrityViolations: Array<{ kind: string; detail: string }>;
  /** Files the attempt changed, from the Time Machine diff of the build's commit(s). */
  filesChanged: number;
  /** How many course-corrections this dim has already had (the budget guard). */
  attemptsSoFar: number;
}

/** Max course-corrections before an honest ceiling — prevents infinite churn on misdiagnosis.
 *  3 (not 2): a dim can legitimately hit two distinct fixable problems (e.g. orphan-still, then a
 *  wrong-approach on a different angle) before a third try; 2 ceilinged genuinely-buildable dims too
 *  early. Still bounded. (A per-category budget would be tighter still — tracked as a refinement.) */
export const MAX_COURSE_CORRECTIONS = 3;

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

/**
 * Gather the live evidence for a stalled dim from the project (outcome-integrity
 * violations + changed-files count from git), then diagnose. Best-effort: any
 * source that can't be read contributes nothing rather than throwing, so a stall
 * is always diagnosable (it degrades to the score-delta branch). Seams let tests
 * drive it without a real repo. Command exit codes are not yet threaded (no
 * per-cycle RunLedger in ascend), so `commands` is empty — integrity + diff +
 * score-delta carry the diagnosis, which is exactly the honesty-stall path that
 * routes to ground-outcomes.
 */
export async function diagnoseStallFromProject(deps: {
  cwd: string; dimId: string; scoreBefore: number; scoreAfter: number; attemptsSoFar: number;
  /** Command results from the build attempt (exit codes). Threading these un-blinds the
   *  build-failed / unbuildable branches — without them every build failure misdiagnoses as
   *  wrong-approach. Empty when the caller has no command signal. */
  commands?: Array<{ command: string; exitCode: number }>;
  _integrityViolations?: () => Promise<Array<{ kind: string; detail: string }>>;
  _changedFiles?: () => Promise<number>;
}): Promise<StallDiagnosis> {
  let integrityViolations: Array<{ kind: string; detail: string }> = [];
  try {
    if (deps._integrityViolations) {
      integrityViolations = await deps._integrityViolations();
    } else {
      const { checkOutcomeIntegrity } = await import('../matrix/engines/outcome-integrity.js');
      const { loadMatrix } = await import('./compete-matrix.js');
      const m = await loadMatrix(deps.cwd);
      if (m) {
        const r = await checkOutcomeIntegrity(m.dimensions as never, deps.cwd);
        integrityViolations = r.violations
          .filter((v: { dimId: string }) => v.dimId === deps.dimId)
          .map((v: { kind: string; detail: string }) => ({ kind: v.kind, detail: v.detail }));
      }
    }
  } catch { /* best-effort */ }

  let filesChanged = 0;
  try { filesChanged = deps._changedFiles ? await deps._changedFiles() : await countChangedFiles(deps.cwd); } catch { /* best-effort */ }

  return diagnoseStall({
    dimId: deps.dimId, scoreBefore: deps.scoreBefore, scoreAfter: deps.scoreAfter,
    commands: deps.commands ?? [], gateFailures: [], integrityViolations, filesChanged, attemptsSoFar: deps.attemptsSoFar,
  });
}

async function countChangedFiles(cwd: string): Promise<number> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)('git', ['status', '--porcelain'], { cwd });
  return stdout.split('\n').filter(l => l.trim().length > 0).length;
}

/** What the orchestrator should do for a diagnosis: maybe run a self-correcting CLI
 *  command, and whether to plateau the dim (stop) or let it retry. Pure — the loop
 *  executes the side effects. */
export interface StallActionResult {
  /** A danteforge subcommand to run as the self-correction, or null (just retry). */
  exec: string | null;
  /** true = stop this dim (honest ceiling / unbuildable); false = retry next cycle. */
  plateau: boolean;
  /** For retry-decompose: the >=2 DEFINED child sub-problems the stall fans into (recorded by resolveStall). */
  children?: import('./obstacle-decomposition.js').ChildObstacle[];
}

export function routeStallAction(d: StallDiagnosis): StallActionResult {
  switch (d.action) {
    case 'ground-orphan':
    case 'fix-outcome':
      return { exec: 'ground-outcomes --apply', plateau: false }; // grounding fixes the honesty stall → retry
    case 'retry-decompose':
      // No longer a slogan: a "retry differently" wall fans into >=2 tracked, DEFINED sub-problems.
      return { exec: null, plateau: false, children: decomposeStall(d) };
    case 'mark-unbuildable':
    case 'honest-ceiling':
      return { exec: null, plateau: true };                        // nothing more will help — stop honestly
  }
}

/**
 * Make `retry-decompose` REAL (the operator's core ask: decompose large problems into many small ones, in the
 * autonomy loop). Turns a stall into >=2 DEFINED child sub-problems — a wall becomes a worklist, never a blind
 * retry. Pure; resolveStall records the children to the ledger via the canonical solveOrDecompose engine. The
 * children are category-specific so they are genuine angles (the "decomposition-as-noise" guard), not filler.
 */
export function decomposeStall(d: StallDiagnosis): import('./obstacle-decomposition.js').ChildObstacle[] {
  const ev = d.evidence.map(e => e.detail).join('; ').slice(0, 180);
  const isolate = {
    kind: 'stall-isolate',
    signal: `Find the SMALLEST reversible step that moves ${d.dimId} past the ${d.category} stall: ${d.rationale}`.slice(0, 200),
    rationale: `A blind retry repeats the wall; the smallest reversible step makes the next attempt evidence-bearing. Evidence: ${ev}`,
  };
  switch (d.category) {
    case 'build-failed':
    case 'no-op-build':
      return [isolate, {
        kind: 'stall-rootcause',
        signal: `Reproduce the first failing build step for ${d.dimId} in isolation and name its TRUE root cause (not the likely-looking line).`,
        rationale: `build stalls burn cycles until the real cause is named, not pattern-matched. Evidence: ${ev}`,
      }];
    case 'wrong-approach':
      return [isolate, {
        kind: 'stall-assumption',
        signal: `Name the specific assumption in the current ${d.dimId} approach that the failing gate disproves, and a different approach that avoids it.`,
        rationale: `wrong-approach means the STRATEGY is wrong, not the execution — a new angle is required, not a retry. Evidence: ${ev}`,
      }];
    default:
      return [isolate, {
        kind: 'stall-altpath',
        signal: `Propose one genuinely DIFFERENT approach for ${d.dimId} than the last attempt (not a tweak of the same change).`,
        rationale: `retry-decompose requires a different path, not a repeat of the wall. Evidence: ${ev}`,
      }];
  }
}

export function formatDiagnosis(d: StallDiagnosis): string {
  const facts = d.evidence.map(e => `${e.kind}:${e.detail}`).join(' | ');
  return `[course-correct] ${d.dimId} → ${d.category} ⇒ ${d.action}  (${facts})`;
}

function extractFailedCommand(d: StallDiagnosis): string | undefined {
  const ev = d.evidence.find(e => e.kind === 'exit-code');
  return ev?.detail.match(/`([^`]+)`/)?.[1];
}

/**
 * Richard's DNA, applied to the stall brain: an env/operational blocker is a SOLVABLE sub-problem, not a
 * wall. Before `unbuildable` plateaus a dim (the old "we can't, mark unbuildable" dead-stop), route it
 * through the obstacle registry — diagnose -> 3 solutions -> execute the best under (kernel-derived,
 * deny-guarded) pre-granted authority. Solved -> UN-PLATEAU and retry; only if the registry genuinely
 * can't solve it does the honest ceiling stand — and only AFTER trying. Honesty/score stalls keep the
 * gated ground path (routeStallAction); they are not registry-auto-solvable by design.
 */
export async function resolveStall(
  d: StallDiagnosis, cwd: string,
  opts: {
    failedCommand?: string;
    /** Default true: record retry-decompose children to the ledger. Set false (or omit cwd) for dry runs/tests. */
    record?: boolean;
    _solve?: (o: import('./obstacle-registry.js').Obstacle) => Promise<{ solved: boolean; ceiling?: string }>;
    _recordStall?: (receipt: import('./obstacle-decomposition.js').DecompositionReceipt, cwd: string) => Promise<string[]>;
  } = {},
): Promise<StallActionResult & { solvedByRegistry?: boolean; solveDetail?: string }> {
  const base = routeStallAction(d);
  // retry-decompose is no longer a slogan: fan the stall into >=2 ledger sub-problems (the no-walls contract at the
  // loop's stall point — the operator's "decompose large into small, in the loop" ask). Reuses the canonical
  // solveOrDecompose engine: force-unsolved -> decompose -> record with title dedup, so a per-instance loop calling
  // this every cycle records each child ONCE, never spam.
  if (base.children?.length && cwd && opts.record !== false) {
    try {
      const obstacle: import('./obstacle-registry.js').Obstacle = {
        kind: `stall-${d.category}`,
        signal: d.rationale || d.evidence.map(e => e.detail).join('; ') || d.dimId,
        context: { dimId: d.dimId },
      };
      const { solveOrDecompose } = await import('./obstacle-solve-or-decompose.js');
      await solveOrDecompose(obstacle, {
        cwd,
        _solve: async () => ({ solved: false, obstacle, attempted: [], ceiling: 'a stall is not registry-auto-solvable — decompose into sub-problems' }),
        proposeChildren: () => base.children!,
        _record: opts._recordStall,
      });
    } catch { /* a stall-decomposition ledger write must NEVER break the loop's own course-correction */ }
  }
  if (d.category !== 'unbuildable') return base; // only env/operational blockers route to the registry
  const command = opts.failedCommand ?? extractFailedCommand(d);
  const obstacle: import('./obstacle-registry.js').Obstacle = {
    kind: /ENOENT|not found|not recognized|exit(?:\s*code)?\s*127/i.test(`${d.rationale} ${command ?? ''}`) ? 'spawn-failure' : 'env-blocked',
    signal: (d.evidence.map(e => e.detail).join(' ') || d.rationale),
    context: { command: command ?? '', cwd },
  };
  let solve: { solved: boolean; ceiling?: string };
  if (opts._solve) {
    solve = await opts._solve(obstacle);
  } else {
    const { registerCoreSolvers } = await import('./solvers/register-core.js');
    const { solveObstacle } = await import('./obstacle-registry.js');
    registerCoreSolvers();
    solve = await solveObstacle(obstacle);
  }
  if (solve.solved) {
    return { exec: null, plateau: false, solvedByRegistry: true, solveDetail: `${d.dimId}: env blocker auto-solved by the obstacle registry — un-plateau + retry (not a wall).` };
  }
  return base; // registry couldn't solve it → the honest ceiling stands, but only after trying 3 solutions
}
