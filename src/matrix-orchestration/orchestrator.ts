// Matrix Orchestration — Top-level state machine (PRD §6 + §7)
//
// Drives the full pipeline from PRD ingest -> phase A -> inter-phase retro ->
// phase B -> final report -> learning loop. Stages are idempotent: resuming
// from a partial run reads `runState.completedStages` and skips ahead.
//
// Three modes per CLAUDE.md: `mode === 'prompt'` emits prompts to disk and
// returns; `mode === 'llm'` runs end-to-end; `mode === 'local'` falls back to
// heuristics where possible.

import path from 'node:path';
import fs from 'node:fs/promises';
import {
  appendAudit,
  ensureOrchDir,
  initRunState,
  loadOrch,
  markStageCompleted,
  patchRunState,
} from './state-io.js';
import { ORCH_DIR } from './types.js';
import { executePhaseA } from './phases/phase-a-runner.js';
import { executePhaseB, loadPhaseBArgsFromDisk } from './phases/phase-b-runner.js';
import { generateInterPhaseRetrospective } from './phases/inter-phase.js';
import { generateFinalReport } from './reporting/final-report.js';
import { capturePostRunLearning } from './learning/learning-loop.js';
import type {
  CapacityReport,
  CompetitiveUniverse,
  FrontierTarget,
  InterPhaseRetrospective,
  OrchestrationDimensionMatrix,
  OrchestrationStage,
  OrchestratorOptions,
  PhaseExecutionResult,
  ProjectIntent,
  RunState,
} from './types.js';

// ── Errors ──────────────────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
  constructor(public spentUsd: number, public capUsd: number) {
    super(`budget exceeded: $${spentUsd.toFixed(2)} > $${capUsd.toFixed(2)}`);
    this.name = 'BudgetExceededError';
  }
}

export class StageGateRefused extends Error {
  constructor(public stage: OrchestrationStage, message: string) {
    super(`stage ${stage} refused: ${message}`);
    this.name = 'StageGateRefused';
  }
}

// ── Public entry ────────────────────────────────────────────────────────────

export interface OrchestratorRunResult {
  runId: string;
  runState: RunState;
  finalReportPath?: string;
}

export interface OrchestratorSeams {
  /** Replace the PRD-reader step. */
  _readPrd?: (opts: OrchestratorOptions, runId: string) => Promise<ProjectIntent>;
  /** Replace the universe-discovery step. */
  _discoverUniverse?: (intent: ProjectIntent, opts: OrchestratorOptions) => Promise<CompetitiveUniverse>;
  /** Replace the analyze step (no return value; persists side artifacts). */
  _analyzeCompetitors?: (universe: CompetitiveUniverse, opts: OrchestratorOptions) => Promise<void>;
  /** Replace the synthesize-dimensions step. */
  _synthesizeDimensions?: (universe: CompetitiveUniverse, opts: OrchestratorOptions) => Promise<OrchestrationDimensionMatrix>;
  /** Replace current-state scoring. */
  _scoreCurrentState?: (matrix: OrchestrationDimensionMatrix, opts: OrchestratorOptions) => Promise<OrchestrationDimensionMatrix>;
  /** Replace capacity detection. */
  _detectCapacity?: (opts: OrchestratorOptions) => Promise<CapacityReport>;
  /** Override the Phase A executor (lets tests stub end-to-end). */
  _executePhaseA?: typeof executePhaseA;
  /** Override the Phase B executor. */
  _executePhaseB?: typeof executePhaseB;
  /** Override the retrospective + planner step. */
  _generateRetrospective?: typeof generateInterPhaseRetrospective;
  /** Override the final-report step. */
  _generateFinalReport?: typeof generateFinalReport;
  /** Override the learning-loop step. */
  _captureLearning?: typeof capturePostRunLearning;
}

export async function runOrchestration(
  opts: OrchestratorOptions,
  seams: OrchestratorSeams = {},
): Promise<OrchestratorRunResult> {
  await ensureOrchDir(opts.cwd);
  const target: FrontierTarget = opts.target ?? 'closed_source_frontier';
  const maxCostUsd = opts.maxCostUsd ?? 200;
  const skipApproval = opts.skipApproval ?? false;
  const mode = opts.mode ?? 'llm';
  const now = opts._now ?? (() => new Date().toISOString());

  // 1. Initialize or resume run state.
  const existing = await loadOrch<RunState>(opts.cwd, 'runState');
  const runState = existing
    ? existing
    : await initRunState(opts.cwd, {
        runId: makeRunId(now()),
        prdPath: opts.prdPath,
        target,
        overrides: {
          maxAgents: opts.maxAgents,
          maxCostUsd: opts.maxCostUsd,
          providers: opts.providers,
          skipApproval: opts.skipApproval,
          socialSignalEnabled: opts.socialSignalEnabled,
        },
      });

  // Prompt mode: emit prompts and exit before any heavy work.
  if (mode === 'prompt') {
    await emitPromptsForResume(opts.cwd, runState);
    return { runId: runState.runId, runState };
  }

  // 2. Run the state machine, stage by stage. Each helper guards itself with
  //    `shouldRunStage()` so idempotent resume works.
  try {
    const intent = await runStage(opts, runState, 'reading_prd', async () => {
      assertBudget(runState, maxCostUsd);
      const reader = seams._readPrd ?? defaultReadPrd;
      return reader(opts, runState.runId);
    });

    const universe = await runStage(opts, runState, 'discovering_universe', async () => {
      assertBudget(runState, maxCostUsd);
      const discover = seams._discoverUniverse ?? defaultDiscover;
      return discover(intent, opts);
    });

    await runStage(opts, runState, 'analyzing_competitors', async () => {
      assertBudget(runState, maxCostUsd);
      const analyze = seams._analyzeCompetitors ?? (async () => undefined);
      await analyze(universe, opts);
    });

    const matrix = await runStage(opts, runState, 'synthesizing_dimensions', async () => {
      assertBudget(runState, maxCostUsd);
      const synth = seams._synthesizeDimensions ?? defaultSynthesize;
      return synth(universe, opts);
    });

    const scored = await runStage(opts, runState, 'scoring_current_state', async () => {
      assertBudget(runState, maxCostUsd);
      const score = seams._scoreCurrentState ?? (async (m: OrchestrationDimensionMatrix) => m);
      return score(matrix, opts);
    });

    const capacity = await runStage(opts, runState, 'detecting_capacity', async () => {
      const detect = seams._detectCapacity ?? defaultDetectCapacity;
      return detect(opts);
    });

    if (!skipApproval) {
      const ok = await confirm(opts, `Approve matrix + capacity before Phase A?`);
      if (!ok) throw new StageGateRefused('executing_phase_a', 'user declined approval');
    }

    const phaseA = await runStage(opts, runState, 'executing_phase_a', async () => {
      assertBudget(runState, maxCostUsd);
      const fn = seams._executePhaseA ?? executePhaseA;
      const result = await fn({ matrix: scored, capacity, universe }, {
        cwd: opts.cwd,
        mode,
        runId: runState.runId,
        maxCostUsd: maxCostUsd - runState.costSpentUsd,
        _now: now,
      });
      await patchRunState(opts.cwd, { costSpentUsd: runState.costSpentUsd + result.totalCostUsd });
      runState.costSpentUsd += result.totalCostUsd;
      return result;
    });

    let retro: InterPhaseRetrospective | null = null;
    if (target === 'closed_source_frontier') {
      retro = await runStage(opts, runState, 'inter_phase_retro', async () => {
        const fn = seams._generateRetrospective ?? generateInterPhaseRetrospective;
        return fn(phaseA, scored, { cwd: opts.cwd, _now: now });
      });
      if (!skipApproval && retro.recommendation === 'pause_for_user_input') {
        const proceed = await confirm(opts, `Phase A retro recommends pause (${retro.recommendationReason}). Proceed to Phase B?`);
        if (!proceed) throw new StageGateRefused('executing_phase_b', 'user declined retro gate');
      }
    }

    let phaseB: PhaseExecutionResult | null = null;
    if (target === 'closed_source_frontier' && retro?.recommendation !== 'stop') {
      phaseB = await runStage(opts, runState, 'executing_phase_b', async () => {
        assertBudget(runState, maxCostUsd);
        const fn = seams._executePhaseB ?? executePhaseB;
        const extra = await loadPhaseBArgsFromDisk(opts.cwd).catch(() => null);
        const result = await fn(
          {
            matrix: scored,
            capacity,
            universe,
            closedSourceProfiles: extra?.closedSourceProfiles ?? null,
            socialSignal: extra?.socialSignal ?? null,
          },
          { cwd: opts.cwd, mode, runId: runState.runId, maxCostUsd: maxCostUsd - runState.costSpentUsd, _now: now },
        );
        await patchRunState(opts.cwd, { costSpentUsd: runState.costSpentUsd + result.totalCostUsd });
        runState.costSpentUsd += result.totalCostUsd;
        return result;
      });
    }

    const finalReportPath = await runStage(opts, runState, 'generating_final_report', async () => {
      const fn = seams._generateFinalReport ?? generateFinalReport;
      const out = await fn(
        { runState, matrix: scored, phaseAResult: phaseA, phaseBResult: phaseB, retrospective: retro },
        { cwd: opts.cwd, _now: now },
      );
      const captureFn = seams._captureLearning ?? capturePostRunLearning;
      await captureFn(
        {
          finalReport: out.summary,
          phaseResults: [phaseA, ...(phaseB ? [phaseB] : [])],
          retrospective: retro,
        },
        { cwd: opts.cwd, _now: now },
      );
      return out.markdownPath;
    });

    // Final transition.
    await patchRunState(opts.cwd, { stage: 'completed' });
    await markStageCompleted(opts.cwd, runState.runId, 'completed');
    const finalState = (await loadOrch<RunState>(opts.cwd, 'runState')) ?? runState;
    return { runId: runState.runId, runState: finalState, finalReportPath };
  } catch (err) {
    await patchRunState(opts.cwd, {
      stage: 'errored',
      lastError: err instanceof Error ? err.message : String(err),
    });
    await appendAudit(opts.cwd, {
      ts: now(),
      runId: runState.runId,
      kind: 'stage_failed',
      stage: runState.stage,
      payload: { error: err instanceof Error ? err.message : String(err) },
    });
    throw err;
  }
}

// ── Stage harness ───────────────────────────────────────────────────────────

async function runStage<T>(
  opts: OrchestratorOptions,
  runState: RunState,
  stage: OrchestrationStage,
  fn: () => Promise<T>,
): Promise<T> {
  if (runState.completedStages.includes(stage)) {
    // Stage already completed in a prior session — load cached artifact if any.
    const cached = await tryLoadStageArtifact<T>(opts.cwd, stage);
    if (cached !== null) return cached;
  }
  const now = opts._now ?? (() => new Date().toISOString());
  await patchRunState(opts.cwd, { stage });
  await appendAudit(opts.cwd, {
    ts: now(), runId: runState.runId, kind: 'stage_started', stage,
  });
  const result = await fn();
  runState.completedStages = runState.completedStages.includes(stage)
    ? runState.completedStages
    : [...runState.completedStages, stage];
  await patchRunState(opts.cwd, { completedStages: runState.completedStages });
  await appendAudit(opts.cwd, {
    ts: now(), runId: runState.runId, kind: 'stage_completed', stage,
  });
  return result;
}

async function tryLoadStageArtifact<T>(cwd: string, stage: OrchestrationStage): Promise<T | null> {
  const map: Partial<Record<OrchestrationStage, Parameters<typeof loadOrch>[1]>> = {
    reading_prd: 'projectIntent',
    discovering_universe: 'competitiveUniverse',
    synthesizing_dimensions: 'dimensionMatrix',
    scoring_current_state: 'dimensionMatrix',
    detecting_capacity: 'capacityReport',
    executing_phase_a: 'phaseAResult',
    inter_phase_retro: 'phaseARetrospective',
    executing_phase_b: 'phaseBResult',
  };
  const name = map[stage];
  if (!name) return null;
  return loadOrch<T>(cwd, name);
}

// ── Budget enforcement ──────────────────────────────────────────────────────

function assertBudget(runState: RunState, capUsd: number): void {
  if (runState.costSpentUsd > capUsd) {
    throw new BudgetExceededError(runState.costSpentUsd, capUsd);
  }
}

// ── Prompt-mode emitter ─────────────────────────────────────────────────────

async function emitPromptsForResume(cwd: string, runState: RunState): Promise<void> {
  const dir = path.join(cwd, ORCH_DIR, 'prompts');
  await fs.mkdir(dir, { recursive: true });
  const stages: OrchestrationStage[] = [
    'reading_prd',
    'discovering_universe',
    'analyzing_competitors',
    'synthesizing_dimensions',
    'scoring_current_state',
    'detecting_capacity',
  ];
  for (const stage of stages) {
    const filePath = path.join(dir, `${stage}.md`);
    const body = renderPromptStub(stage, runState);
    await fs.writeFile(filePath, body, 'utf8');
  }
}

function renderPromptStub(stage: OrchestrationStage, runState: RunState): string {
  return [
    `# Prompt for stage: ${stage}`,
    '',
    `**Run id:** ${runState.runId}`,
    `**PRD:** ${runState.prdPath}`,
    `**Target:** ${runState.target}`,
    '',
    'Fill in the stage output and re-run \`danteforge matrix\` to resume.',
    '',
  ].join('\n');
}

// ── User confirmation ──────────────────────────────────────────────────────

async function confirm(opts: OrchestratorOptions, msg: string): Promise<boolean> {
  if (opts.skipApproval) return true;
  if (opts._confirm) return opts._confirm(msg);
  // Default: in non-interactive runs we refuse and require explicit
  // --skip-approval to bypass. This is by design — silent auto-approval
  // would defeat the user-gate at PRD §6.
  return false;
}

// ── Defaults that lazily import the real ingest/analysis modules ────────────

async function defaultReadPrd(opts: OrchestratorOptions, runId: string): Promise<ProjectIntent> {
  const { extractProjectIntent } = await import('./prd-reader.js');
  return extractProjectIntent(opts.prdPath, {
    cwd: opts.cwd,
    mode: opts.mode,
    _llmCaller: opts._llmCaller,
    _isLLMAvailable: opts._isLLMAvailable,
    runId,
  });
}

async function defaultDiscover(
  intent: ProjectIntent,
  opts: OrchestratorOptions,
): Promise<CompetitiveUniverse> {
  const { discoverUniverse } = await import('./discovery/universe.js');
  return discoverUniverse(intent, {
    cwd: opts.cwd,
    mode: opts.mode,
    _llmCaller: opts._llmCaller,
    _isLLMAvailable: opts._isLLMAvailable,
    skipApproval: opts.skipApproval,
  });
}

async function defaultSynthesize(
  _universe: CompetitiveUniverse,
  opts: OrchestratorOptions,
): Promise<OrchestrationDimensionMatrix> {
  // Track B owns the synthesizer; if its export isn't ready yet, callers
  // should pass `_synthesizeDimensions` seam. We return a minimal stub here.
  const minimal: OrchestrationDimensionMatrix = {
    generatedAt: new Date().toISOString(),
    projectName: path.basename(opts.cwd),
    dimensions: [],
    overallCurrentScore: 0,
    overallOssFrontierScore: 0,
    overallClosedFrontierScore: 0,
    approvedByUser: false,
  };
  return minimal;
}

async function defaultDetectCapacity(opts: OrchestratorOptions): Promise<CapacityReport> {
  // Track C ships the real detector; until then, return a deterministic stub
  // so the orchestrator can complete end-to-end.
  return {
    generatedAt: new Date().toISOString(),
    hostMachineSignature: 'unknown',
    providers: (opts.providers ?? ['fake']).map(p => ({
      providerId: p,
      installed: true,
      authStatus: 'authenticated' as const,
      concurrentInstances: 1,
    })),
    totalPracticalConcurrency: opts.maxAgents ?? 1,
    benchmarkDurationMs: 0,
  };
}

function makeRunId(iso: string): string {
  return `orch.${iso.replace(/[:.]/g, '-').slice(0, 19)}`;
}

// ── Public re-exports for callers ───────────────────────────────────────────
export type { OrchestratorOptions };
