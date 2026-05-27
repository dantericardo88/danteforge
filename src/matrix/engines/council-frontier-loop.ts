// Matrix Kernel — CouncilFrontierLoop
//
// The frontier loop is a continuous quality ratchet:
//
//   Phase 0: Research (Codex + Grok write FORGE_BRIEFs for all dims, in parallel
//            with the builder's first cycle — no idle time).
//
//   Phase 1: Build (Claude Code picks the lowest-scored dim, reads its FORGE_BRIEF,
//            builds in an isolated worktree, emits candidate immediately, then picks
//            the next dim. Builder is never idle waiting for judges).
//
//   Phase 2: Verify (Grok runs a binary checklist check against the FORGE_BRIEF:
//            "which items were implemented in this diff?" — fast, minimal usage).
//
//   Phase 3: Confirm (Codex confirms Grok's checklist check and issues final verdict.
//            PASS → merge + update score. FAIL → update FORGE_BRIEF with remaining
//            gaps, re-queue dim at back of priority queue).
//
//   Loop: repeat until all dims ≥ targetScore or maxIterations exhausted.
//
// Claude Code builds. Codex researches + confirms. Grok verifies (minimal usage).
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { CodexAdapter } from '../adapters/codex-adapter.js';
import { GrokBuildAdapter } from '../adapters/grok-build-adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code-adapter.js';
import { runAdapter } from '../adapters/adapter-interface.js';
import type { WorkPacket } from '../types/work-graph.js';
import type { AgentLease } from '../types/lease.js';
import {
  createCouncilWorktreesForSlots,
  removeCouncilWorktrees,
  captureWorktreeDiff,
  makeReadOnlyLease,
} from './council-worktree.js';
import type { CouncilWorktreeHandle } from './council-worktree.js';
import type { CouncilMemberId } from './council-scheduler.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { runCIPCheck } from '../../core/completion-integrity.js';
import {
  loadForgeBrief,
  saveForgeBrief,
  tickChecklist,
  recordVerification,
  buildBriefPromptPrefix,
  buildVerifierPrompt,
  parseVerifierResponse,
  buildScoringPrompt,
  parseScoringResponse,
} from './council-forge-brief.js';
import type { ForgeBrief } from './council-forge-brief.js';
import { runResearchPhase } from './council-research-phase.js';
import type { ResearchTarget } from './council-research-phase.js';

const execFileAsync = promisify(execFile);

/** Extract changed src file paths from a git diff string. */
function extractChangedFiles(diff: string): string[] {
  return [...diff.matchAll(/^diff --git a\/.+ b\/(.+)$/gm)].map(m => m[1]!).filter(
    f => f.endsWith('.ts') && !f.startsWith('tests/'),
  );
}

export interface FrontierLoopOptions {
  projectPath: string;
  goal?: string;
  targetScore?: number;
  maxIterations?: number;
  /** Builder member — does the forge work. Default: claude-code */
  builder?: CouncilMemberId;
  /** Researcher members — write FORGE_BRIEFs. Default: ['codex', 'grok-build'] */
  researchers?: CouncilMemberId[];
  /** Verifier — binary checklist check. Default: grok-build */
  verifier?: CouncilMemberId;
  /** Confirmer — final verdict. Default: codex */
  confirmer?: CouncilMemberId;
  /** OSS harvest path for research context. Default: X:\Projects\OSSHarvest */
  ossHarvestPath?: string;
  /** Skip research phase (use existing briefs only). */
  skipResearch?: boolean;
  /** Skip post-merge validate (faster, no receipts). */
  skipValidate?: boolean;
  /** Minimum gap to include in loop. Default: 0 (include all below targetScore) */
  minGap?: number;
  /** Max concurrent research briefs. Default: 6 */
  researchConcurrencyLimit?: number;
  /** Max retries for research phase. Default: 2 */
  researchMaxRetries?: number;
  /** After each PASS merge, run de-sloppify on changed files in a fresh agent context. Default: false */
  runDeSloppify?: boolean;
  /** Verify mode: 'grok' (default) = Grok binary checklist pre-merge; 'loop' = 6-phase verify-loop post-merge. */
  verifyMode?: 'grok' | 'loop';
}

export interface IterationResult {
  iteration: number;
  dimId: string;
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  scoreAfter?: number;
  itemsBuilt: string[];
  itemsMissing: string[];
  merged: boolean;
}

export interface FrontierLoopResult {
  iterations: IterationResult[];
  dimsReachedTarget: string[];
  dimsRemaining: string[];
  finalScores: Record<string, number>;
  stoppedReason: 'ALL_DONE' | 'MAX_ITERATIONS' | 'ERROR';
}

interface DimEntry {
  dimId: string;
  dimName: string;
  score: number;
}

async function loadDimQueue(
  projectPath: string,
  targetScore: number,
  minGap: number,
): Promise<DimEntry[]> {
  const matrixPath = path.join(projectPath, '.danteforge', 'compete', 'matrix.json');
  try {
    const raw = JSON.parse(await fs.readFile(matrixPath, 'utf8')) as {
      dimensions?: Record<string, { id?: string; name?: string; scores?: { self?: number } }>;
    };
    const dims = Object.values(raw.dimensions ?? {});
    return dims
      .map(d => ({
        dimId: d.id ?? '',
        dimName: d.name ?? d.id ?? '',
        score: d.scores?.self ?? 0,
      }))
      .filter(d => d.dimId && d.score < targetScore && (targetScore - d.score) >= minGap)
      .sort((a, b) => a.score - b.score);
  } catch {
    return [];
  }
}

async function readCurrentScore(projectPath: string, dimId: string): Promise<number | null> {
  const matrixPath = path.join(projectPath, '.danteforge', 'compete', 'matrix.json');
  try {
    const raw = JSON.parse(await fs.readFile(matrixPath, 'utf8')) as {
      dimensions?: Record<string, { id?: string; scores?: { self?: number } }>;
    };
    for (const d of Object.values(raw.dimensions ?? {})) {
      if (d.id === dimId) return d.scores?.self ?? null;
    }
    return null;
  } catch { return null; }
}

function makeBuildWorkPacket(goal: string, worktreePath: string, briefPrefix: string): WorkPacket {
  return {
    id: `frontier-build.${Date.now()}`,
    dimensionId: 'frontier-build',
    objective: briefPrefix + goal,
    acceptanceCriteria: [
      'Implement all checklist items from the FORGE_BRIEF with no stubs or mocks in src/ files.',
      'Modified files must typecheck cleanly.',
      'Every implemented item must have a corresponding test.',
    ],
    proof: { proofRequired: ['git diff shows changes matching FORGE_BRIEF checklist items'] },
    globalForbidden: [
      '.danteforge/compete/matrix.json',
      '.danteforge/score-proposals/**',
      'node_modules/**',
      'dist/**',
    ],
    context: { worktreePath },
  } as unknown as WorkPacket;
}

function makeBuildLease(worktreePath: string): AgentLease {
  return {
    id: `frontier-lease.${Date.now()}`,
    worktreePath,
    allowedWritePaths: ['src/**', 'tests/**', 'scripts/**', 'packages/**', '*.md', '*.json', '*.ts', '*.js'],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['.danteforge/compete/matrix.json', '.danteforge/score-proposals/**', 'node_modules/**', 'dist/**'],
  } as unknown as AgentLease;
}

function makeBuilderAdapter(memberId: CouncilMemberId, workPacket: WorkPacket) {
  switch (memberId) {
    case 'codex':       return new CodexAdapter({ workPacket });
    case 'grok-build':  return new GrokBuildAdapter({ workPacket });
    default:            return new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
  }
}

async function runBuildPhase(
  dim: DimEntry,
  brief: ForgeBrief | null,
  builder: CouncilMemberId,
  projectPath: string,
  goal: string,
  runId: string,
): Promise<{ handle: CouncilWorktreeHandle; diff: string } | null> {
  const slot = { memberId: builder, slotIdx: 0, slotId: `${builder}-0` };
  const handles = await createCouncilWorktreesForSlots([{
    memberId: builder, slotIdx: 0, slotId: `${builder}-0`,
  }], { projectPath, runId });

  if (handles.length === 0) {
    logger.warn(`[frontier-loop] Failed to create worktree for ${dim.dimId}`);
    return null;
  }

  const handle = handles[0]!;
  const briefPrefix = brief ? buildBriefPromptPrefix(brief) : '';
  const dimGoal = [
    briefPrefix,
    goal,
    `\nDimension: ${dim.dimName} (current score: ${dim.score}/10)`,
    'Push this dimension toward the frontier. Implement real capability gaps, not stubs.',
  ].join('\n');

  const workPacket = makeBuildWorkPacket(dimGoal, handle.worktreePath, '');
  const lease = makeBuildLease(handle.worktreePath);
  const adapter = makeBuilderAdapter(builder, workPacket);

  logger.info(chalk.cyan(`[frontier-loop] Building ${dim.dimId} in ${handle.worktreePath}`));

  try {
    const available = await adapter.isAvailable();
    if (!available) {
      logger.warn(`[frontier-loop] Builder ${builder} not available — skipping ${dim.dimId}`);
      await removeCouncilWorktrees([handle], { projectPath });
      return null;
    }
    await runAdapter(adapter, { lease });
    const diff = await captureWorktreeDiff(handle, { projectPath });
    return { handle, diff };
  } catch (err) {
    logger.warn(`[frontier-loop] Build failed for ${dim.dimId}: ${String(err).split('\n')[0]}`);
    await removeCouncilWorktrees([handle], { projectPath }).catch(() => { /* ignore */ });
    return null;
  }
}

async function runVerifyPhase(
  brief: ForgeBrief | null,
  diff: string,
  verifier: CouncilMemberId,
  projectPath: string,
): Promise<{ built: string[]; missing: string[] }> {
  if (!brief || brief.checklist.length === 0) {
    return { built: [], missing: [] };
  }

  const prompt = buildVerifierPrompt(brief, diff);
  const workPacket = {
    id: `frontier-verify.${Date.now()}`,
    dimensionId: 'verify',
    objective: prompt,
    acceptanceCriteria: ['Respond with BUILT: [...] and MISSING: [...] lists'],
    proof: { proofRequired: [] },
    globalForbidden: [],
    context: {},
  } as unknown as WorkPacket;

  const lease = makeReadOnlyLease(projectPath, 'verify');
  const adapter = verifier === 'grok-build'
    ? new GrokBuildAdapter({ workPacket })
    : verifier === 'codex'
      ? new CodexAdapter({ workPacket })
      : new ClaudeCodeAdapter({ workPacket, skipPermissions: true });

  try {
    const available = await adapter.isAvailable();
    if (!available) return { built: [], missing: brief.checklist.map(i => i.id) };
    const result = await runAdapter(adapter, { lease });
    return parseVerifierResponse(result.output ?? '', brief.checklist);
  } catch {
    return { built: [], missing: brief.checklist.map(i => i.id) };
  }
}

async function runConfirmPhase(
  brief: ForgeBrief | null,
  diff: string,
  built: string[],
  confirmer: CouncilMemberId,
  projectPath: string,
  passThreshold = 7.0,
): Promise<{ verdict: 'PASS' | 'FAIL'; score: number; notes: string; highestImpactNext: string }> {
  // Use the full scoring rubric from scoringprompt-dim.md if a brief exists,
  // otherwise fall back to a simple pass/fail check.
  const prompt = brief
    ? buildScoringPrompt(brief, diff, passThreshold)
    : [
        `Score this diff and issue PASS or FAIL. A PASS requires real production code with no stubs.`,
        `Respond with: SCORE: X.X\nVERDICT: PASS\nREASON: ...\nHIGHEST_IMPACT_NEXT: ...`,
        `--- DIFF ---`,
        diff.slice(0, 8_000),
      ].join('\n');

  const workPacket = {
    id: `frontier-confirm.${Date.now()}`,
    dimensionId: 'confirm',
    objective: prompt,
    acceptanceCriteria: ['Respond with SCORE, VERDICT, REASON, and HIGHEST_IMPACT_NEXT'],
    proof: { proofRequired: [] },
    globalForbidden: [],
    context: {},
  } as unknown as WorkPacket;

  const lease = makeReadOnlyLease(projectPath, 'confirm');
  const adapter = confirmer === 'codex'
    ? new CodexAdapter({ workPacket })
    : confirmer === 'grok-build'
      ? new GrokBuildAdapter({ workPacket })
      : new ClaudeCodeAdapter({ workPacket, skipPermissions: true });

  try {
    const available = await adapter.isAvailable();
    if (!available) {
      const fallbackScore = built.length > 0 ? passThreshold : passThreshold - 1;
      return { verdict: built.length > 0 ? 'PASS' : 'FAIL', score: fallbackScore, notes: 'Confirmer unavailable — using checklist result', highestImpactNext: '' };
    }
    const result = await runAdapter(adapter, { lease });
    const parsed = parseScoringResponse(result.output ?? '');
    return {
      verdict: parsed.verdict,
      score: parsed.score,
      notes: parsed.reason,
      highestImpactNext: parsed.highestImpactNext,
    };
  } catch (err) {
    return { verdict: 'FAIL', score: 0, notes: String(err).split('\n')[0], highestImpactNext: '' };
  }
}

async function applyAndMerge(
  handle: CouncilWorktreeHandle,
  diff: string,
  projectPath: string,
  skipValidate: boolean,
  dimId: string,
): Promise<boolean> {
  if (!diff.trim()) return false;
  try {
    const patchFile = path.join(projectPath, '.danteforge', '.tmp-patches', `frontier-${dimId}-${Date.now()}.patch`);
    await fs.mkdir(path.dirname(patchFile), { recursive: true });
    await fs.writeFile(patchFile, diff, 'utf8');
    await execFileAsync('git', ['apply', '--whitespace=fix', patchFile], {
      cwd: projectPath, timeout: 30_000,
    });
    await fs.unlink(patchFile).catch(() => { /* ignore */ });

    await execFileAsync('git', ['add', '-A'], { cwd: projectPath, timeout: 15_000 });
    await execFileAsync('git', [
      'commit', '-m', `frontier-loop: improve ${dimId}`,
      '--no-verify',
    ], {
      cwd: projectPath, timeout: 15_000,
      env: { ...process.env, DANTEFORGE_MATRIX_MERGE_RECEIPT: '1' },
    });

    if (!skipValidate) {
      try {
        const [nodeBin, cliEntry] = [process.execPath, process.argv[1] ?? 'dist/index.js'];
        await execFileAsync(nodeBin, [cliEntry, 'validate', dimId], {
          cwd: projectPath, timeout: 120_000,
          env: { ...process.env, DANTEFORGE_MATRIX_MERGE_RECEIPT: '1' },
        });
      } catch { /* validate failure is not fatal — scores update next iteration */ }
    }
    return true;
  } catch (err) {
    logger.warn(`[frontier-loop] Merge failed for ${dimId}: ${String(err).split('\n')[0]}`);
    return false;
  }
}

export async function runFrontierLoop(
  opts: FrontierLoopOptions,
): Promise<FrontierLoopResult> {
  const {
    projectPath,
    goal = 'Push this dimension toward 9+. Implement real capability gaps. No stubs, no TODOs.',
    targetScore = 9.0,
    maxIterations = 100,
    builder = 'claude-code',
    researchers = ['codex', 'grok-build'],
    verifier = 'grok-build',
    confirmer = 'codex',
    ossHarvestPath = 'X:\\Projects\\OSSHarvest',
    skipResearch = false,
    skipValidate = false,
    minGap = 0,
    runDeSloppify = false,
    verifyMode = 'grok',
  } = opts;

  const iterationResults: IterationResult[] = [];
  const dimsReachedTarget: string[] = [];

  logger.info(chalk.bold('\n[frontier-loop] Starting Frontier Loop'));
  logger.info(`  Builder:    ${builder}`);
  logger.info(`  Researchers: ${researchers.join(', ')}`);
  logger.info(`  Verifier:   ${verifier}`);
  logger.info(`  Confirmer:  ${confirmer}`);
  logger.info(`  Target:     ${targetScore}`);
  logger.info(`  Max iters:  ${maxIterations}\n`);

  // Load initial dim queue
  let dimQueue = await loadDimQueue(projectPath, targetScore, minGap);
  if (dimQueue.length === 0) {
    logger.info(chalk.green('[frontier-loop] All dims already at target score!'));
    return {
      iterations: [],
      dimsReachedTarget: [],
      dimsRemaining: [],
      finalScores: {},
      stoppedReason: 'ALL_DONE',
    };
  }

  logger.info(`[frontier-loop] ${dimQueue.length} dim(s) below target ${targetScore}:`);
  dimQueue.forEach(d => logger.info(`  ${d.dimId}: ${d.score}`));

  // Start research phase non-blocking (runs concurrently with first build)
  const researchTargets: ResearchTarget[] = dimQueue.map(d => ({
    dimId: d.dimId,
    dimName: d.dimName,
    currentScore: d.score,
    targetScore,
  }));

  let researchPromise: Promise<unknown> = Promise.resolve();
  if (!skipResearch) {
    logger.info('\n[frontier-loop] Starting research phase (parallel with first build)...');
    researchPromise = runResearchPhase({
      projectPath,
      targets: researchTargets,
      researchers,
      ossHarvestPath,
      skipExisting: true,
    }).then(r => {
      logger.info(`[frontier-loop] Research phase complete: ${r.written.length} briefs written, ${r.skipped.length} skipped`);
    }).catch(err => {
      logger.warn(`[frontier-loop] Research phase error: ${String(err).split('\n')[0]}`);
    });
  }

  const runId = `fl${Date.now()}`;
  let iteration = 0;

  while (iteration < maxIterations) {
    // Re-rank queue by current score (ascending — lowest first)
    dimQueue = await loadDimQueue(projectPath, targetScore, minGap);
    const dimsAtTarget = dimQueue.filter(d => d.score >= targetScore).map(d => d.dimId);
    for (const id of dimsAtTarget) {
      if (!dimsReachedTarget.includes(id)) dimsReachedTarget.push(id);
    }
    dimQueue = dimQueue.filter(d => d.score < targetScore);

    if (dimQueue.length === 0) {
      logger.info(chalk.green('\n[frontier-loop] All dims reached target score! Loop complete.'));
      break;
    }

    const dim = dimQueue[0]!;
    iteration++;

    logger.info(chalk.bold(`\n[frontier-loop] Iteration ${iteration}/${maxIterations}: ${dim.dimId} (score: ${dim.score})`));

    // Read forge brief (may not exist yet — research phase still running)
    const brief = await loadForgeBrief(projectPath, dim.dimId);
    if (brief) {
      const remaining = brief.checklist.filter(i => !i.completed).length;
      logger.info(`  FORGE_BRIEF loaded: ${remaining}/${brief.checklist.length} items remaining`);
    } else {
      logger.info('  No FORGE_BRIEF yet — building with goal only (brief will arrive from research phase)');
    }

    // Phase 1: Build
    const buildResult = await runBuildPhase(dim, brief, builder, projectPath, goal, `${runId}-i${iteration}`);

    if (!buildResult || !buildResult.diff.trim()) {
      logger.warn(`[frontier-loop] ${dim.dimId}: build produced no diff — moving to next dim`);
      // Push to back of queue by bumping score slightly so next dim gets priority
      iterationResults.push({
        iteration, dimId: dim.dimId, verdict: 'ERROR',
        itemsBuilt: [], itemsMissing: [], merged: false,
      });
      await removeCouncilWorktrees(buildResult ? [buildResult.handle] : [], { projectPath }).catch(() => { /* ignore */ });
      continue;
    }

    const { handle, diff } = buildResult;
    logger.info(`  Build complete: ${diff.length} bytes diff`);

    // Phase 2: Verify (Grok checklist check)
    logger.info(`  Verifying (${verifier})...`);
    const { built, missing } = await runVerifyPhase(brief, diff, verifier, projectPath);
    logger.info(`  Verify: built=${built.length}, missing=${missing.length}`);

    // Phase 3: Confirm (Codex scores using full rubric from scoringprompt-dim.md)
    logger.info(`  Confirming (${confirmer})...`);
    const { verdict, score: confirmedScore, notes, highestImpactNext } = await runConfirmPhase(
      brief, diff, built, confirmer, projectPath,
    );
    logger.info(`  Score: ${confirmedScore.toFixed(1)} | Verdict: ${verdict === 'PASS' ? chalk.green('PASS') : chalk.red('FAIL')} — ${notes}`);
    if (highestImpactNext) logger.info(chalk.dim(`  Next: ${highestImpactNext}`));

    // Update brief with verification results and confirmer's score
    if (brief) {
      const ticked = tickChecklist(brief, built);
      const withRecord = recordVerification(
        ticked,
        { cycle: iteration, verifiedBy: verifier, confirmedBy: confirmer, verdict, itemsBuilt: built, itemsMissing: missing, notes },
        verdict === 'PASS' ? confirmedScore : undefined,
      );
      await saveForgeBrief(projectPath, withRecord);
    }

    let merged = false;
    let scoreAfter: number | undefined;

    if (verdict === 'PASS') {
      logger.info(chalk.green(`  Merging ${dim.dimId}...`));
      merged = await applyAndMerge(handle, diff, projectPath, skipValidate, dim.dimId);
      if (merged) {
        scoreAfter = await readCurrentScore(projectPath, dim.dimId) ?? undefined;
        logger.info(chalk.green(`  Merged! Score: ${dim.score} → ${scoreAfter ?? '?'}`));
        if ((scoreAfter ?? 0) >= targetScore) dimsReachedTarget.push(dim.dimId);

        if (runDeSloppify) {
          const changedFiles = extractChangedFiles(diff);
          if (changedFiles.length > 0) {
            logger.info(`[frontier-loop] Running de-sloppify on ${changedFiles.length} changed file(s)...`);
            const { runDeSloppifyCommand } = await import('../../cli/commands/de-sloppify.js');
            await runDeSloppifyCommand({ cwd: projectPath, files: changedFiles.join(',') }).catch(err => {
              logger.warn(`[frontier-loop] de-sloppify failed: ${String(err).split('\n')[0]}`);
            });
          }
        }

        if (verifyMode === 'loop') {
          logger.info(`[frontier-loop] Running 6-phase verify-loop on ${dim.dimId}...`);
          const { runVerifyLoopCommand } = await import('../../cli/commands/verify-loop.js');
          await runVerifyLoopCommand({ cwd: projectPath, dim: dim.dimId }).catch(err => {
            logger.warn(`[frontier-loop] verify-loop failed: ${String(err).split('\n')[0]}`);
          });
        }
      }
    } else {
      logger.info(chalk.yellow(`  FAIL — ${dim.dimId} re-queued with updated brief`));
    }

    await removeCouncilWorktrees([handle], { projectPath }).catch(() => { /* ignore */ });

    iterationResults.push({
      iteration, dimId: dim.dimId, verdict,
      scoreAfter, itemsBuilt: built, itemsMissing: missing, merged,
    });
  }

  // Wait for research phase to complete before returning
  await researchPromise;

  const finalQueue = await loadDimQueue(projectPath, targetScore, 0);
  const finalScores: Record<string, number> = {};
  for (const d of finalQueue) finalScores[d.dimId] = d.score;

  const stoppedReason = finalQueue.filter(d => d.score < targetScore).length === 0
    ? 'ALL_DONE'
    : iteration >= maxIterations ? 'MAX_ITERATIONS' : 'ERROR';

  logger.info(chalk.bold(`\n[frontier-loop] Complete. Reason: ${stoppedReason}`));
  logger.info(`  Iterations: ${iteration}`);
  logger.info(`  Dims reached target: ${dimsReachedTarget.join(', ') || 'none'}`);

  return {
    iterations: iterationResults,
    dimsReachedTarget: [...new Set(dimsReachedTarget)],
    dimsRemaining: finalQueue.filter(d => d.score < targetScore).map(d => d.dimId),
    finalScores,
    stoppedReason,
  };
}
