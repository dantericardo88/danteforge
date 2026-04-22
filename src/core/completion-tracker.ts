// Completion Tracker — computes per-phase and overall project completion
// Pure, deterministic, idempotent computation from state + scores.
import fs from 'fs/promises';
import path from 'path';
import type { DanteState } from './state.js';
import type { ScoredArtifact, ScoreResult } from './pdse.js';
import { SCORE_THRESHOLDS } from './pdse-config.js';

export type ProjectType = 'web' | 'cli' | 'library' | 'unknown';

export interface ArtifactScore {
  score: number;
  complete: boolean;
}

export interface PlanningPhaseTracking {
  score: number;
  complete: boolean;
  artifacts: Record<'CONSTITUTION' | 'SPEC' | 'CLARIFY' | 'PLAN' | 'TASKS', ArtifactScore>;
}

export interface ExecutionPhaseTracking {
  score: number;
  complete: boolean;
  currentPhase: number;
  wavesComplete: number;
  totalWaves: number;
}

export interface VerificationPhaseTracking {
  score: number;
  complete: boolean;
  qaScore: number;
  testsPassing: boolean;
}

export interface SynthesisPhaseTracking {
  score: number;
  complete: boolean;
  retroDelta: number | null;
}

export interface CompletionTracker {
  overall: number;
  phases: {
    planning: PlanningPhaseTracking;
    execution: ExecutionPhaseTracking;
    verification: VerificationPhaseTracking;
    synthesis: SynthesisPhaseTracking;
  };
  lastUpdated: string;
  projectedCompletion: string;
}

// Phase weights for overall computation
const PHASE_WEIGHTS = {
  planning: 0.25,
  execution: 0.40,
  verification: 0.25,
  synthesis: 0.10,
} as const;

const EXECUTION_COMPLETE_STAGES = new Set(['verify', 'synthesize']);

// ── Primary computation — pure, idempotent ──────────────────────────────────

export function computeCompletionTracker(
  state: DanteState,
  scores: Record<ScoredArtifact, ScoreResult>,
): CompletionTracker {

  // ── Planning phase ──
  const artifactNames: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  const artifactScores: Record<string, ArtifactScore> = {};
  let planningTotal = 0;

  for (const name of artifactNames) {
    const result = scores[name];
    const artScore = result?.score ?? 0;
    artifactScores[name] = {
      score: artScore,
      complete: artScore >= SCORE_THRESHOLDS.ACCEPTABLE,
    };
    planningTotal += artScore;
  }

  const planningScore = Math.round(planningTotal / artifactNames.length);
  const planningComplete = artifactNames.every(
    name => (artifactScores[name]?.score ?? 0) >= SCORE_THRESHOLDS.ACCEPTABLE,
  );

  const planning: PlanningPhaseTracking = {
    score: planningScore,
    complete: planningComplete,
    artifacts: artifactScores as PlanningPhaseTracking['artifacts'],
  };

  // ── Execution phase ──
  const currentPhase = state.currentPhase ?? 1;
  const totalWaves = estimateTotalWaves(state);
  const wavesComplete = EXECUTION_COMPLETE_STAGES.has(state.workflowStage)
    ? Math.min(currentPhase, totalWaves)
    : Math.max(0, currentPhase - 1);
  const executionScore = totalWaves > 0
    ? Math.round((wavesComplete / totalWaves) * 100)
    : 0;
  const executionComplete = wavesComplete >= totalWaves && totalWaves > 0;

  const execution: ExecutionPhaseTracking = {
    score: executionScore,
    complete: executionComplete,
    currentPhase,
    wavesComplete,
    totalWaves,
  };

  // ── Verification phase ──
  const qaScore = typeof state.qaHealthScore === 'number'
    ? state.qaHealthScore
    : 0;
  const testsPassing = state.verifyEvidence
    ? state.verifyEvidence.status === 'pass' && state.verifyEvidence.fresh
    : state.lastVerifyStatus === 'pass';
  const isWebProject = state.projectType === 'web';

  let verificationScore: number;
  let verificationComplete: boolean;
  if (isWebProject) {
    verificationScore = Math.round((qaScore + (testsPassing ? 100 : 0)) / 2);
    verificationComplete = testsPassing && qaScore >= 80;
  } else {
    verificationScore = testsPassing ? 100 : 0;
    verificationComplete = testsPassing;
  }

  const verification: VerificationPhaseTracking = {
    score: verificationScore,
    complete: verificationComplete,
    qaScore,
    testsPassing,
  };

  // ── Synthesis phase ──
  const retroDelta = typeof state.retroDelta === 'number'
    ? state.retroDelta
    : null;
  const hasRetro = retroDelta !== null;
  const hasSynthesis = state.workflowStage === 'synthesize';
  const synthesisScore = (hasSynthesis ? 50 : 0) + (hasRetro ? 50 : 0);
  const synthesisComplete = hasSynthesis && hasRetro;

  const synthesis: SynthesisPhaseTracking = {
    score: synthesisScore,
    complete: synthesisComplete,
    retroDelta,
  };

  // ── Overall weighted average ──
  const overall = Math.round(
    planning.score * PHASE_WEIGHTS.planning +
    execution.score * PHASE_WEIGHTS.execution +
    verification.score * PHASE_WEIGHTS.verification +
    synthesis.score * PHASE_WEIGHTS.synthesis,
  );

  const projectedCompletion = computeProjectedCompletion(
    { planning, execution, verification, synthesis },
    state,
  );

  return {
    overall,
    phases: { planning, execution, verification, synthesis },
    lastUpdated: new Date().toISOString(),
    projectedCompletion,
  };
}

// ── Projected completion — human-readable ───────────────────────────────────

export function computeProjectedCompletion(
  phases: {
    planning: PlanningPhaseTracking;
    execution: ExecutionPhaseTracking;
    verification: VerificationPhaseTracking;
    synthesis: SynthesisPhaseTracking;
  },
  state: DanteState,
): string {
  const remaining: string[] = [];

  if (!phases.planning.complete) {
    const incomplete = (['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'] as const)
      .filter(a => !phases.planning.artifacts[a].complete);
    remaining.push(`improve ${incomplete.join(', ')}`);
  }

  if (!phases.execution.complete) {
    const waves = phases.execution.totalWaves - phases.execution.wavesComplete;
    remaining.push(`${waves} more forge wave${waves !== 1 ? 's' : ''}`);
  }

  if (!phases.verification.complete) {
    const needsReceiptRefresh = state.verifyEvidence?.status === 'pass' && !state.verifyEvidence.fresh;
    remaining.push(needsReceiptRefresh ? 'verify (refresh receipt)' : 'verify');
  }

  if (!phases.synthesis.complete) {
    remaining.push('synthesize');
  }

  if (remaining.length === 0) {
    return 'Ready for ship';
  }

  return remaining.join(' + ');
}

// ── Project type detection ──────────────────────────────────────────────────

export async function detectProjectType(cwd: string): Promise<ProjectType> {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const pkgContent = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgContent) as Record<string, unknown>;

    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const deps = {
      ...(pkg.dependencies ?? {}) as Record<string, string>,
      ...(pkg.devDependencies ?? {}) as Record<string, string>,
    };

    if (pkg.bin) return 'cli';

    // Check for web framework indicators
    const webIndicators = ['next', 'react', 'vue', 'angular', 'svelte', 'nuxt', 'vite', 'astro'];
    const hasWebDep = webIndicators.some(f => f in deps);
    const hasDevServer = 'dev' in scripts || 'start' in scripts;

    if (hasWebDep || hasDevServer) {
      // Distinguish between web app and library
      const hasMain = Boolean(pkg.main || pkg.exports);
      if (hasMain && !hasWebDep) return 'library';
      return 'web';
    }

    // Check for library indicators
    if (pkg.main || pkg.exports) return 'library';

    return 'unknown';
  } catch {
    // No package.json — check for other indicators
    const configFiles = [
      'next.config.js', 'next.config.ts', 'next.config.mjs',
      'vite.config.ts', 'vite.config.js',
      'nuxt.config.ts', 'angular.json',
      'svelte.config.js',
    ];

    for (const config of configFiles) {
      try {
        await fs.access(path.join(cwd, config));
        return 'web';
      } catch {
        // Not found, continue
      }
    }

    return 'unknown';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function estimateTotalWaves(state: DanteState): number {
  // Estimate from task phases if available
  const phaseKeys = Object.keys(state.tasks);
  if (phaseKeys.length > 0) {
    return phaseKeys.length;
  }
  // Default: assume 3 waves if no task data
  return 3;
}
