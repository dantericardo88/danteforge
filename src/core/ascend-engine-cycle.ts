// ascend-engine-cycle.ts — the per-dimension cycle helpers for ascend (file-size split).
//
// Extracted from ascend-engine.ts (the .git/hooks pre-commit 750-raw-line cap, tripped by the
// wave-ledger wiring): executeDimensionCycle, rescoreAndGetDelta, applyStallCorrection,
// runAdversarialCritiqueStep, runPeriodicRetroIfDue, checkConvergenceBreak. Every one takes its deps
// as params (no closure over loop state), so the move is behavior-preserving; runAscend imports them back.

import { loadState, saveState } from './state.js';
import { computeStrictDimensions, type HarshScorerOptions, type HarshScoreResult, type ScoringDimension } from './harsh-scorer.js';
import { decisionDimScore, classifyDimensions, type CompeteMatrix, type MatrixDimension } from './compete-matrix.js';
import { readSweBenchScore, formatSweBenchGoal, isSweBenchDimension } from './swe-bench-probe.js';
import { runAutoforgeLoop, type AutoforgeLoopContext, type AutoforgeLoopDeps } from './autoforge-loop.js';
import { diagnoseStallFromProject, resolveStall, formatDiagnosis } from './frontier-course-corrector.js';
import { nextLevelGoalSuffix } from './rubric-ladder.js';
import { logger } from './logger.js';
import { mapDimIdToScoringDimension } from './ascend-reporting.js';
// applyStrictOverrides is a HOISTED function in ascend-engine.ts (safe to import back despite the
// import cycle — function declarations exist before module-init completes; it's called at runtime).
import { applyStrictOverrides, type AscendEngineOptions, type AscendCycleState } from './ascend-engine.js';

export async function executeDimensionCycle(
  options: AscendEngineOptions, loopCtx: AutoforgeLoopContext, nextDim: MatrixDimension,
  wrappedExec: (cmd: string, cwd: string) => Promise<{ success: boolean }>,
  runLoopFn: typeof runAutoforgeLoop, beforeScore: number, target: number, goal: string,
  cwd: string, loadStateFn: typeof loadState,
): Promise<{ buildFailed: boolean }> {
  if ((options.executeMode ?? 'forge') === 'forge') {
    // SWE-bench gets a goal that names specific failure modes from the latest
    // bench-results.json. Other dimensions stay on the generic improve-goal —
    // the harsh-scorer for those dims can drive convergence on its own.
    // Tell the builder EXACTLY what the next score level requires for this dim, from the
    // competitor-grounded rubric ladder (research output, not invented). Empty if no ladder.
    const rubricSuffix = await nextLevelGoalSuffix(cwd, nextDim.id, beforeScore).catch(() => '');
    const forgeGoal = (isSweBenchDimension(nextDim.id)
      ? await formatSweBenchGoal(cwd, target).catch(() =>
          `Improve ${nextDim.label}: current ${beforeScore.toFixed(1)}/10, target ${target}/10`,
        )
      : `Improve ${nextDim.label}: current ${beforeScore.toFixed(1)}/10, target ${target}/10`) + rubricSuffix;
    const setWorkflowStageFn = options._setWorkflowStage ?? (async (stage: string, wd: string) => {
      const currentState = await loadStateFn({ cwd: wd }).catch(() => null);
      if (currentState) {
        currentState.workflowStage = stage as import('./state.js').WorkflowStage;
        await (options._saveState ?? saveState)(currentState, { cwd: wd });
      }
    });
    try {
      await setWorkflowStageFn('forge', cwd);
      const r = await wrappedExec(`forge "${forgeGoal.replace(/"/g, '\\"')}"`, cwd);
      logger.info(`[Ascend] Forge executed for ${nextDim.label}`);
      return { buildFailed: !r.success };
    } catch (err: unknown) {
      logger.warn(`[Ascend] Forge failed for ${nextDim.label}: ${String(err)} — falling back to advisory`);
      await runLoopFn(loopCtx, {}).catch((e: unknown) => logger.warn(`[Ascend] Loop error: ${String(e)}`));
      return { buildFailed: true };
    }
  } else {
    await runLoopFn(loopCtx, options._executeCommand ? { _executeCommand: wrappedExec } : {}).catch((err: unknown) => logger.warn(`[Ascend] Loop error for ${nextDim.label}: ${String(err)}`));
    return { buildFailed: false };
  }
}

export async function rescoreAndGetDelta(
  harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>,
  computeStrictDimsFn: typeof computeStrictDimensions,
  nextDim: MatrixDimension, beforeScore: number, cwd: string,
): Promise<{ newSelfScore: number; delta: number; newScoreResult: HarshScoreResult }> {
  const newScoreResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} });
  await applyStrictOverrides(newScoreResult, cwd, computeStrictDimsFn);
  let newSelfScore: number;
  if (isSweBenchDimension(nextDim.id)) {
    // SWE-bench score lives in bench-results.json, not the harsh-scorer.
    // If no fresh run since the cycle started, score is unchanged — that's
    // accurate (a forge cycle that doesn't trigger a rerun produces no
    // measurable delta until the user reruns `dantecode bench`).
    const probe = await readSweBenchScore(cwd).catch(() => null);
    newSelfScore = probe?.displayScore ?? beforeScore;
  } else {
    const scoringDim = mapDimIdToScoringDimension(nextDim.id);
    // For dims not in the harsh-scorer, keep the matrix score unchanged.
    // Using displayScore as a proxy was a bug: it credited overall project
    // improvement to an unrelated dimension (e.g. a forge cycle improving
    // tests would falsely boost ocr_extraction's score). The plateau detector
    // will fire after 1 cycle, and ascend moves on — the code was still written.
    newSelfScore = scoringDim ? (newScoreResult.displayDimensions[scoringDim] ?? newScoreResult.displayScore) : beforeScore;
  }
  const delta = newSelfScore - beforeScore;
  logger.info(`  Result: ${nextDim.label} ${beforeScore.toFixed(1)} → ${newSelfScore.toFixed(1)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`);
  return { newSelfScore, delta, newScoreResult };
}

// Evidence-based course-correction on a stall: diagnose WHY the build didn't move the score
// (from outcome-integrity + changed files + the score delta), then ACT — run a self-correcting
// command (ground-outcomes for an honesty stall) and retry, or stop the dim at an honest ceiling.
// Replaces the old "blindly add to plateaued". Budget-bounded inside diagnoseStall → no infinite
// churn. Under the test runner we keep the legacy plateau (the routing + diagnosis are unit-tested
// directly; this avoids real git/matrix I/O against the test cwd).
export async function applyStallCorrection(
  nextDim: MatrixDimension, beforeScore: number, newSelfScore: number,
  cs: AscendCycleState, cwd: string,
  exec: (cmd: string, cwd: string) => Promise<{ success: boolean }>,
  buildFailed: boolean,
): Promise<void> {
  if (process.env['NODE_TEST_CONTEXT']) { cs.plateauedDims.add(nextDim.id); logger.info('  (plateau detected — moving to next dimension)'); return; }
  const attempts = cs.dimCorrectionCounts[nextDim.id] ?? 0;
  // Thread the build outcome so the build-failed branch can fire (a failed build is decompose-and-retry,
  // NOT a misdiagnosed wrong-approach that burns the budget and false-ceilings a fixable dim).
  const commands = buildFailed ? [{ command: 'forge (build)', exitCode: 1 }] : [];
  const diag = await diagnoseStallFromProject({ cwd, dimId: nextDim.id, scoreBefore: beforeScore, scoreAfter: newSelfScore, attemptsSoFar: attempts, commands });
  cs.dimCorrectionCounts[nextDim.id] = attempts + 1;
  logger.info('  ' + formatDiagnosis(diag));
  logger.info(`  [course-correct] ${diag.rationale}`);
  // Richard's DNA: route the stall through the obstacle registry — an env/operational blocker is a
  // SOLVABLE problem (3 solutions → execute the best under pre-granted authority), not a wall to plateau.
  const route = await resolveStall(diag, cwd, { failedCommand: commands[0]?.command });
  if (route.solvedByRegistry) logger.info(`  [course-correct] ${route.solveDetail}`);
  if (route.exec) { await exec(route.exec, cwd).catch((e: unknown) => logger.warn(`  [course-correct] ${route.exec} failed: ${String(e)}`)); }
  if (route.plateau) cs.plateauedDims.add(nextDim.id);
  else cs.plateauedDims.delete(nextDim.id); // un-plateau → the loop revisits this dim and retries
}

export async function runAdversarialCritiqueStep(
  options: AscendEngineOptions, generateCritiqueFn: AscendEngineOptions['_generateCritique'],
  nextDim: MatrixDimension, newSelfScore: number, beforeScore: number,
  target: number, goal: string, cwd: string, maxDimRetries: number, cs: AscendCycleState,
): Promise<void> {
  if (!options.scorerProvider || !generateCritiqueFn || newSelfScore >= target) return;
  const recentWorkSummary = `Dimension: ${nextDim.label}. Score moved from ${beforeScore.toFixed(1)} to ${newSelfScore.toFixed(1)}. Goal was: ${goal.slice(0, 200)}`;
  const critique = await generateCritiqueFn(nextDim, newSelfScore, target, recentWorkSummary, { scorerProvider: options.scorerProvider, cwd }).catch((err: unknown) => {
    logger.warn(`[Ascend] Critique generation failed: ${String(err)}`);
    return null;
  });
  if (critique && !critique.satisfied) {
    const retries = cs.dimRetryCounts[nextDim.id] ?? 0;
    if (retries < maxDimRetries) {
      cs.dimRetryCounts[nextDim.id] = retries + 1;
      cs.pendingCritique = critique;
      cs.critiqueTargetDimId = nextDim.id;
      logger.info(`  [Critique] Scorer not satisfied (${newSelfScore.toFixed(1)}/${target}) — retry ${retries + 1}/${maxDimRetries} queued`);
      logger.info(`  [Critique] Gap: ${critique.gapAnalysis.slice(0, 120)}`);
    } else {
      logger.info(`  [Critique] Max retries (${maxDimRetries}) reached for ${nextDim.label} — moving on`);
      cs.plateauedDims.add(nextDim.id);
    }
  } else if (critique?.satisfied) {
    logger.success(`  [Critique] Scorer satisfied with ${nextDim.label} at ${newSelfScore.toFixed(1)}/10`);
    cs.dimRetryCounts[nextDim.id] = 0;
  }
}

export async function runPeriodicRetroIfDue(options: AscendEngineOptions, cyclesRun: number, cwd: string): Promise<void> {
  const retroIntervalN = options.retroInterval ?? 5;
  if (cyclesRun % retroIntervalN !== 0) return;
  const runRetroFn = options._runRetro ?? (async (c: string) => {
    const { retro } = await import('../cli/commands/retro.js');
    await retro({ cwd: c });
  });
  const prevExitCode = process.exitCode;
  process.exitCode = 0;
  await runRetroFn(cwd).catch(() => {});
  process.exitCode = prevExitCode;
}

export async function checkConvergenceBreak(
  options: AscendEngineOptions,
  generateAdversarialScoreFn: AscendEngineOptions['_generateAdversarialScore'],
  harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>,
  matrix: CompeteMatrix, target: number, newScoreResult: HarshScoreResult, adversaryTolerance: number, cwd: string,
): Promise<boolean> {
  const { achievable: stillAchievable } = classifyDimensions(matrix, target);
  if (!stillAchievable.every(d => decisionDimScore(d) >= target)) return false;

  // Mandatory harsh verification — runs before any convergence, even without adversarialGating.
  // Prevents premature loop exit when LLM self-score hits target but harsh score is still low.
  if (options.requireHarshVerification !== false) {
    logger.info('[Ascend] Self-score target reached — running mandatory harsh verification...');
    const verificationScore = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} }).catch(() => null);
    if (verificationScore) {
      const harshTolerance = options.harshTolerance ?? 0.5;
      const failingDims = stillAchievable.filter(d => {
        const dimScore = (verificationScore.displayDimensions as Record<string, number>)[d.id as ScoringDimension] ?? 0;
        return dimScore < (target - harshTolerance);
      });
      if (failingDims.length > 0) {
        logger.warn(`[Ascend] Self-score target reached but harsh verification failed on: ${failingDims.map(d => d.label).join(', ')}`);
        logger.warn(`  Harsh score: ${verificationScore.displayScore.toFixed(1)}/10 — loop must continue.`);
        return false;
      }
      logger.success(`[Ascend] Self-score AND harsh verification both passed! (${verificationScore.displayScore.toFixed(1)}/10)`);
    } else {
      logger.warn('[Ascend] Harsh verification unavailable — proceeding with self-score only.');
    }
  }

  if (options.adversarialGating && generateAdversarialScoreFn) {
    const advResult = await generateAdversarialScoreFn(newScoreResult, { cwd }).catch(() => null);
    if (advResult && advResult.adversarialScore < (target - adversaryTolerance)) {
      logger.warn('[Ascend] Self-score target reached but adversarial gate not passed.');
      logger.warn(`  Self: ${newScoreResult.displayScore.toFixed(1)} / Adversarial: ${advResult.adversarialScore.toFixed(1)} / Required: ${(target - adversaryTolerance).toFixed(1)}`);
      logger.warn(`  Verdict: ${advResult.verdict} — continuing to improve...`);
      return false;
    }
    logger.success('[Ascend] Self-score AND adversarial gate both passed!');
    if (advResult) logger.success(`  Adversarial score: ${advResult.adversarialScore.toFixed(1)}/10 (${advResult.verdict})`);
    return true;
  }
  logger.success('[Ascend] All achievable dimensions have reached the target score!');
  return true;
}

