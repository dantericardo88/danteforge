// Matrix Orchestration CLI surface (PRD §8).
//
// Wires `danteforge matrix-orchestrate <prd-path>` plus subcommands (read,
// discover, analyze, synthesize-dimensions, score, detect-capacity,
// execute-phase-a, execute-phase-b, report, status, logs, learning-state,
// replay) onto the Commander program.
//
// Naming: the bare `matrix` noun is taken by the Matrix Development engine
// in register-late-commands.ts (claim/propose/merge/ascend for dimensions).
// We use `matrix-orchestrate` for the orchestration layer to avoid collision
// while keeping the layering visible: `matrix-kernel` = engine,
// `matrix-orchestrate` = headline orchestration command, `matrix` = dimension
// ascent.
//
// All heavy modules are imported dynamically inside actions so cold-start
// cost is paid lazily (mirrors register-matrix-commands.ts).

import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';

export function registerMatrixOrchestrationCommands(program: Command): void {
  const matrix = program
    .command('matrix-orchestrate [prd-path]')
    .description('PRD → frontier orchestration (the headline command)')
    .option('--target <target>', 'oss-frontier | closed-source-frontier | category-definer', 'closed-source-frontier')
    .option('--max-agents <n>', 'Cap parallel agent count', parseInt)
    .option('--max-cost <n>', 'Cap LLM spend in USD', parseFloat)
    .option('--providers <list>', 'Comma-separated allowed providers')
    .option('--skip-approval', 'Bypass user confirmation gates')
    .option('--social-signal', 'Enable social-signal pass')
    .option('--prompt', 'Emit prompts to disk and exit (mode=prompt)')
    .option('--mode <mode>', 'llm | prompt | local', 'llm')
    // NOTE: --cwd is NOT defined on the parent intentionally. Defining it
    // here would shadow each subcommand's own --cwd, leaving subcommand
    // opts.cwd=undefined at runtime. Users who want a non-default cwd via
    // the bare `matrix-orchestrate <prd>` form should cd into the project
    // root first, or invoke a subcommand explicitly.
    .action(async (prdPath: string | undefined, opts: Record<string, unknown>) => {
      await runSafely('matrix:run', async () => {
        if (!prdPath) {
          logger.error('Usage: danteforge matrix <prd-path>');
          process.exitCode = 1;
          return;
        }
        const { runOrchestration } = await import('../matrix-orchestration/orchestrator.js');
        const result = await runOrchestration({
          cwd: parseCwd(opts),
          prdPath,
          target: parseTarget(opts.target as string),
          maxAgents: opts.maxAgents as number | undefined,
          maxCostUsd: opts.maxCost as number | undefined,
          providers: parseProviders(opts.providers),
          skipApproval: Boolean(opts.skipApproval),
          socialSignalEnabled: Boolean(opts.socialSignal),
          mode: (opts.prompt ? 'prompt' : (opts.mode as 'llm' | 'prompt' | 'local')) ?? 'llm',
        });
        logger.success(`[matrix] Run ${result.runId} finished (stage: ${result.runState.stage})`);
        if (result.finalReportPath) logger.info(`[matrix] Final report: ${result.finalReportPath}`);
      });
    });

  registerRead(matrix);
  registerDetect(matrix);
  registerDiscover(matrix);
  registerAnalyze(matrix);
  registerSynthesize(matrix);
  registerScore(matrix);
  registerColdStart(matrix);
  registerDetectCapacity(matrix);
  registerExecutePhases(matrix);
  registerReport(matrix);
  registerStatus(matrix);
  registerLogs(matrix);
  registerLearningState(matrix);
  registerReplay(matrix);
}

// ── Subcommand registrars ───────────────────────────────────────────────────

function registerRead(matrix: Command): void {
  matrix
    .command('read <prd-path>')
    .description('Extract ProjectIntent from a PRD markdown file')
    .option('--cwd <path>', 'Project root')
    .option('--mode <mode>', 'llm | prompt | local', 'llm')
    .action(async (prdPath: string, opts: Record<string, unknown>) => {
      await runSafely('matrix:read', async () => {
        const { extractProjectIntent } = await import('../matrix-orchestration/prd-reader.js');
        const intent = await extractProjectIntent(prdPath, {
          cwd: parseCwd(opts),
          mode: (opts.mode as 'llm' | 'prompt' | 'local') ?? 'llm',
        });
        logger.success(`[matrix:read] Extracted intent for "${intent.projectName}" (confidence ${intent.confidence.toFixed(2)})`);
      });
    });
}

function registerDetect(matrix: Command): void {
  matrix
    .command('detect')
    .description('Auto-detect ProjectIntent from a COLD repo (package.json + README) — no PRD needed')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:detect', async () => {
        const { detectProjectIntent } = await import('../matrix-orchestration/discovery/project-detect.js');
        const { saveOrch, ensureOrchDir } = await import('../matrix-orchestration/state-io.js');
        const cwd = parseCwd(opts);
        const intent = await detectProjectIntent(cwd);
        await ensureOrchDir(cwd);
        await saveOrch(cwd, 'projectIntent', intent);
        logger.success(`[matrix:detect] ${intent.projectName} → ${intent.projectType} (confidence ${intent.confidence.toFixed(2)})`);
        logger.info(`  goal: ${intent.goal}`);
        logger.info(`  categories: ${intent.competitiveCategoryBoundary.direct.join(', ') || '(none)'}`);
        if (intent.confidence < 0.6) {
          logger.warn('  Low confidence (<0.60) — thin repo signal. Refine the saved intent, or author a PRD + `matrix read` for a stronger target.');
        } else {
          logger.info('  Next: danteforge matrix discover   (find competitors via gh + awesome-lists)');
        }
      });
    });
}

function registerDiscover(matrix: Command): void {
  matrix
    .command('discover')
    .description('Discover the competitive universe from the saved intent')
    .option('--cwd <path>', 'Project root')
    .option('--skip-approval', 'Bypass the universe approval prompt')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:discover', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { discoverUniverse } = await import('../matrix-orchestration/discovery/universe.js');
        const cwd = parseCwd(opts);
        const intent = await loadOrch('projectIntent' as never, 'projectIntent' as never)
          .catch(() => null) as unknown;
        const intent2 = (await loadOrch(cwd, 'projectIntent')) ?? intent;
        if (!intent2) throw new Error('No projectIntent saved — run `matrix read <prd>` first');
        const universe = await discoverUniverse(intent2 as never, {
          cwd,
          skipApproval: Boolean(opts.skipApproval),
        });
        logger.success(`[matrix:discover] ${universe.entries.length} entries`);
      });
    });
}

function registerAnalyze(matrix: Command): void {
  matrix
    .command('analyze')
    .description('Profile closed-source competitors + collect social signal')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:analyze', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { profileClosedSource } = await import('../matrix-orchestration/analysis/closed-source-profiler.js');
        const cwd = parseCwd(opts);
        const universe = await loadOrch<{ entries: unknown[] }>(cwd, 'competitiveUniverse');
        if (!universe) throw new Error('No competitiveUniverse — run `matrix discover` first');
        const report = await profileClosedSource(universe as never, { cwd });
        logger.success(`[matrix:analyze] Profiled ${report.profiles.length} closed-source competitor(s)`);
      });
    });
}

function registerSynthesize(matrix: Command): void {
  matrix
    .command('synthesize-dimensions')
    .description('Build the orchestration dimension matrix')
    .option('--cwd <path>', 'Project root')
    .option('--mode <mode>', 'llm | prompt | local', 'llm')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:synthesize-dimensions', async () => {
        const { loadOrch, saveOrch } = await import('../matrix-orchestration/state-io.js');
        const { synthesizeOrchestrationDimensions } = await import('../matrix-orchestration/analysis/dimension-synthesizer.js');
        const cwd = parseCwd(opts);
        const intent = await loadOrch(cwd, 'projectIntent');
        const universe = await loadOrch(cwd, 'competitiveUniverse');
        if (!intent || !universe) {
          throw new Error('Run `matrix-orchestrate read` and `matrix-orchestrate discover` first.');
        }
        const matrixDoc = await synthesizeOrchestrationDimensions(
          { intent: intent as never, universe: universe as never },
          { cwd, mode: (opts.mode as 'llm' | 'prompt' | 'local') ?? 'llm' },
        );
        await saveOrch(cwd, 'dimensionMatrix', matrixDoc);
        logger.success(`[matrix:synthesize-dimensions] ${(matrixDoc as { dimensions?: unknown[] }).dimensions?.length ?? 0} dimension(s)`);
      });
    });
}

function registerScore(matrix: Command): void {
  matrix
    .command('score')
    .description('Score current state against the dimension matrix')
    .option('--cwd <path>', 'Project root')
    .option('--mode <mode>', 'llm | prompt | local', 'llm')
    .option('--strict', 'Apply strict scoring rules')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:score', async () => {
        const { loadOrch, saveOrch } = await import('../matrix-orchestration/state-io.js');
        const { scoreCurrentState } = await import('../matrix-orchestration/analysis/current-state-scorer.js');
        const cwd = parseCwd(opts);
        const matrixDoc = await loadOrch(cwd, 'dimensionMatrix');
        if (!matrixDoc) {
          throw new Error('Run `matrix-orchestrate synthesize-dimensions` first.');
        }
        const scored = await scoreCurrentState(matrixDoc as never, {
          cwd, mode: (opts.mode as 'llm' | 'prompt' | 'local') ?? 'llm',
          strict: Boolean(opts.strict),
        });
        await saveOrch(cwd, 'currentStateScore', scored);
        logger.success(`[matrix:score] Scored ${(scored as { dimensions?: unknown[] }).dimensions?.length ?? 0} dimension(s)`);
      });
    });
}

function registerColdStart(matrix: Command): void {
  matrix
    .command('cold-start')
    .description('ONE command on ANY repo: detect intent → discover competitors → synthesize dimensions → score. No PRD or matrix needed.')
    .option('--cwd <path>', 'Project root')
    .option('--mode <mode>', 'llm | prompt | local', 'llm')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:cold-start', async () => {
        const cwd = parseCwd(opts);
        const mode = (opts.mode as 'llm' | 'prompt' | 'local') ?? 'llm';
        const { saveOrch, ensureOrchDir } = await import('../matrix-orchestration/state-io.js');
        const { detectProjectIntent } = await import('../matrix-orchestration/discovery/project-detect.js');
        const { discoverUniverse } = await import('../matrix-orchestration/discovery/universe.js');
        const { synthesizeOrchestrationDimensions } = await import('../matrix-orchestration/analysis/dimension-synthesizer.js');
        const { scoreCurrentState } = await import('../matrix-orchestration/analysis/current-state-scorer.js');
        await ensureOrchDir(cwd);

        // Thin glue over the already-proven pieces (detect/discover/synthesize/score) — each step
        // saves its artifact under .danteforge/matrix-orchestration/, so a crash mid-chain leaves a
        // resumable trail. cold-start auto-approves discovery (bootstrap one-shot); the universe is
        // saved for review.
        const intent = await detectProjectIntent(cwd);
        await saveOrch(cwd, 'projectIntent', intent);
        logger.info(`[cold-start] 1/4 intent: ${intent.projectName} → ${intent.projectType} (confidence ${intent.confidence.toFixed(2)})`);
        if (intent.confidence < 0.6) {
          logger.warn('[cold-start] thin repo signal (confidence <0.60) — the detected intent is a starting point; refine .danteforge/matrix-orchestration/project-intent.json.');
        }

        const universe = await discoverUniverse(intent as never, { cwd, mode, skipApproval: true });
        logger.info(`[cold-start] 2/4 universe: ${universe.entries.length} competitor(s) discovered (auto-approved for bootstrap — review competitive-universe.json)`);

        const matrixDoc = await synthesizeOrchestrationDimensions(
          { intent: intent as never, universe: universe as never }, { cwd, mode },
        );
        await saveOrch(cwd, 'dimensionMatrix', matrixDoc);
        const dimCount = (matrixDoc as { dimensions?: unknown[] }).dimensions?.length ?? 0;
        logger.info(`[cold-start] 3/4 dimensions synthesized: ${dimCount}`);

        // Council pivot (2026-06-22): in local mode (no LLM), gather REAL repo signals so dimensions ground
        // from evidence (build/typecheck/lint) instead of the placeholder 0. Dims with no automatable signal
        // stay unscored (0) — honest, never fabricated. This is what makes cold-start useful on an arbitrary
        // repo without an API key. Tests are NOT auto-run (council hardware-risk guard).
        let repoSignals: import('../matrix-orchestration/analysis/repo-signal-grounding.js').RepoSignals | undefined;
        if (mode === 'local') {
          const { gatherRepoSignals } = await import('../matrix-orchestration/analysis/repo-signal-grounding.js');
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const { spawnSync } = await import('node:child_process');
          logger.info('[cold-start] gathering real repo signals (build/typecheck/lint — bounded) for honest grounding…');
          repoSignals = await gatherRepoSignals({
            exists: (rel) => existsSync(join(cwd, rel)),
            run: async (c) => { const r = spawnSync(c, { cwd, shell: true, timeout: 120_000, stdio: 'ignore' }); return r.status ?? 1; },
          });
          logger.info(`[cold-start]   stack=${repoSignals.stack} build=${repoSignals.buildPasses} typecheck=${repoSignals.typecheckPasses} lint=${repoSignals.lintPasses} tests=${repoSignals.testsPresent}`);
        }
        const scored = await scoreCurrentState(matrixDoc as never, { cwd, mode, strict: false, _repoSignals: repoSignals });
        await saveOrch(cwd, 'currentStateScore', scored);
        const scoredCount = (scored as { dimensions?: unknown[] }).dimensions?.length ?? dimCount;
        const grounded = ((scored as { dimensions?: Array<{ currentScore?: number }> }).dimensions ?? []).filter(d => (d.currentScore ?? 0) > 0).length;
        logger.success(`[cold-start] 4/4 scored ${scoredCount} dimension(s) — ${grounded} grounded from real signals, ${scoredCount - grounded} unscored (honest, need LLM assess or human).`);
        logger.info('  Artifacts under .danteforge/matrix-orchestration/. Review the dimension matrix, then build toward the frontier.');
      });
    });
}

function registerDetectCapacity(matrix: Command): void {
  matrix
    .command('detect-capacity')
    .description('Probe provider installs and benchmark concurrency')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:detect-capacity', async () => {
        const { saveOrch } = await import('../matrix-orchestration/state-io.js');
        const { detectCapacity } = await import('../matrix-orchestration/capacity/detector.js');
        const cwd = parseCwd(opts);
        const report = await detectCapacity({ cwd, runId: `cap.${Date.now()}` });
        await saveOrch(cwd, 'capacityReport', report);
        const available = report.providers.filter(p => p.installed).length;
        logger.success(`[matrix:detect-capacity] ${available}/${report.providers.length} provider(s) installed (total concurrency: ${report.totalPracticalConcurrency})`);
      });
    });
}

function registerExecutePhases(matrix: Command): void {
  matrix
    .command('execute-phase-a')
    .description('Execute Phase A — close the OSS frontier gap')
    .option('--cwd <path>', 'Project root')
    .option('--max-cost <n>', 'Override phase budget in USD', parseFloat)
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:execute-phase-a', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { executePhaseA } = await import('../matrix-orchestration/phases/phase-a-runner.js');
        const { buildRunAdapter } = await import('./orchestration-adapter-dispatch.js');
        const cwd = parseCwd(opts);
        const matrixDoc = await loadOrch(cwd, 'dimensionMatrix');
        const capacity = await loadOrch(cwd, 'capacityReport');
        const universe = await loadOrch(cwd, 'competitiveUniverse');
        if (!matrixDoc || !capacity || !universe) {
          throw new Error('Missing matrix/capacity/universe — run the earlier stages first');
        }
        const result = await executePhaseA(
          { matrix: matrixDoc as never, capacity: capacity as never, universe: universe as never },
          { cwd, maxCostUsd: opts.maxCost as number | undefined, _runAdapter: buildRunAdapter() },
        );
        logger.success(`[matrix:execute-phase-a] ${result.attempts.length} attempt(s), ${result.dimensionsClosed.length} dim(s) closed`);
      });
    });

  matrix
    .command('execute-phase-b')
    .description('Execute Phase B — push toward the closed-source frontier')
    .option('--cwd <path>', 'Project root')
    .option('--max-cost <n>', 'Override phase budget in USD', parseFloat)
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:execute-phase-b', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { executePhaseB, loadPhaseBArgsFromDisk } = await import('../matrix-orchestration/phases/phase-b-runner.js');
        const { buildRunAdapter } = await import('./orchestration-adapter-dispatch.js');
        const cwd = parseCwd(opts);
        const matrixDoc = await loadOrch(cwd, 'dimensionMatrix');
        const capacity = await loadOrch(cwd, 'capacityReport');
        const universe = await loadOrch(cwd, 'competitiveUniverse');
        if (!matrixDoc || !capacity || !universe) {
          throw new Error('Missing matrix/capacity/universe — run earlier stages first');
        }
        const extra = await loadPhaseBArgsFromDisk(cwd);
        const result = await executePhaseB(
          {
            matrix: matrixDoc as never,
            capacity: capacity as never,
            universe: universe as never,
            closedSourceProfiles: extra?.closedSourceProfiles ?? null,
            socialSignal: extra?.socialSignal ?? null,
          },
          { cwd, maxCostUsd: opts.maxCost as number | undefined, _runAdapter: buildRunAdapter() },
        );
        logger.success(`[matrix:execute-phase-b] ${result.attempts.length} attempt(s), ${result.dimensionsClosed.length} dim(s) closed`);
      });
    });
}

function registerReport(matrix: Command): void {
  matrix
    .command('report')
    .description('Generate the final orchestration report + THIRD_PARTY_NOTICES')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:report', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { generateFinalReport } = await import('../matrix-orchestration/reporting/final-report.js');
        const cwd = parseCwd(opts);
        const runState = await loadOrch(cwd, 'runState');
        const matrixDoc = await loadOrch(cwd, 'dimensionMatrix');
        if (!runState || !matrixDoc) throw new Error('Missing runState or dimensionMatrix');
        const phaseA = await loadOrch(cwd, 'phaseAResult');
        const phaseB = await loadOrch(cwd, 'phaseBResult');
        const retro = await loadOrch(cwd, 'phaseARetrospective');
        const result = await generateFinalReport(
          {
            runState: runState as never,
            matrix: matrixDoc as never,
            phaseAResult: phaseA as never,
            phaseBResult: phaseB as never,
            retrospective: retro as never,
          },
          { cwd },
        );
        logger.success(`[matrix:report] Wrote ${result.markdownPath}`);
        if (result.noticesPath) logger.info(`[matrix:report] THIRD_PARTY_NOTICES: ${result.noticesPath}`);
      });
    });
}

function registerStatus(matrix: Command): void {
  matrix
    .command('status')
    .description('Print run state summary')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:status', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const cwd = parseCwd(opts);
        const state = await loadOrch<{ runId: string; stage: string; completedStages: string[]; costSpentUsd: number }>(cwd, 'runState');
        if (!state) { logger.info('[matrix:status] no run yet'); return; }
        logger.info(`[matrix:status] run=${state.runId} stage=${state.stage} cost=$${state.costSpentUsd.toFixed(2)}`);
        logger.info(`[matrix:status] completed: ${state.completedStages.join(', ') || '(none)'}`);
      });
    });
}

function registerLogs(matrix: Command): void {
  matrix
    .command('logs')
    .description('Tail the orchestration audit log')
    .option('--cwd <path>', 'Project root')
    .option('--limit <n>', 'Max entries to show', parseInt)
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:logs', async () => {
        const { readAuditLog } = await import('../matrix-orchestration/state-io.js');
        const cwd = parseCwd(opts);
        const events = await readAuditLog(cwd);
        const limit = (opts.limit as number | undefined) ?? 50;
        for (const e of events.slice(-limit)) {
          logger.info(`${e.ts} ${e.kind.padEnd(24)} ${e.stage ?? ''}`);
        }
      });
    });
}

function registerLearningState(matrix: Command): void {
  matrix
    .command('learning-state')
    .description('Print the cumulative learning state across runs')
    .option('--cwd <path>', 'Project root')
    .action(async (opts: Record<string, unknown>) => {
      await runSafely('matrix:learning-state', async () => {
        const { loadLearningState } = await import('../matrix-orchestration/learning/learning-loop.js');
        const cwd = parseCwd(opts);
        const state = await loadLearningState(cwd);
        if (!state) { logger.info('[matrix:learning-state] no learning state yet'); return; }
        logger.info(`[matrix:learning-state] version=${state.version} updated=${state.updatedAt}`);
        for (const [pid, p] of Object.entries(state.providerPerformance)) {
          logger.info(`  ${pid.padEnd(12)} runs=${p.runs} succ=${p.totalSuccesses}/${p.totalAttempts}`);
        }
      });
    });
}

function registerReplay(matrix: Command): void {
  matrix
    .command('replay <run-id>')
    .description('Re-run from a prior run id (best-effort — reuses prior state)')
    .option('--cwd <path>', 'Project root')
    .option('--skip-approval', 'Bypass approval gates')
    .action(async (runId: string, opts: Record<string, unknown>) => {
      await runSafely('matrix:replay', async () => {
        const { loadOrch } = await import('../matrix-orchestration/state-io.js');
        const { runOrchestration } = await import('../matrix-orchestration/orchestrator.js');
        const cwd = parseCwd(opts);
        const state = await loadOrch<{ runId: string; prdPath: string }>(cwd, 'runState');
        if (!state) throw new Error('no prior run state to replay');
        if (state.runId !== runId) logger.warn(`[matrix:replay] state runId ${state.runId} ≠ requested ${runId}; continuing`);
        await runOrchestration({
          cwd,
          prdPath: state.prdPath,
          skipApproval: Boolean(opts.skipApproval),
        });
      });
    });
}

// ── Common helpers ──────────────────────────────────────────────────────────

function parseCwd(opts: Record<string, unknown>): string {
  return (opts.cwd as string | undefined) ?? process.cwd();
}

function parseTarget(t: string | undefined): 'oss_frontier' | 'closed_source_frontier' | 'category_definer' {
  if (t === 'oss-frontier' || t === 'oss_frontier') return 'oss_frontier';
  if (t === 'category-definer' || t === 'category_definer') return 'category_definer';
  return 'closed_source_frontier';
}

function parseProviders(raw: unknown): ('claude' | 'codex' | 'dantecode' | 'aider' | 'cursor' | 'ollama' | 'fake' | 'shell')[] | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined;
  const allowed = new Set(['claude', 'codex', 'dantecode', 'aider', 'cursor', 'ollama', 'fake', 'shell']);
  return raw.split(',').map(s => s.trim()).filter(s => allowed.has(s)) as never;
}

async function runSafely(label: string, fn: () => Promise<void>): Promise<void> {
  try { await fn(); }
  catch (err) {
    formatAndLogError(err, label);
    process.exitCode = 1;
  }
}
