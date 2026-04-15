/**
 * E2E Spec-Driven Pipeline scoring tests.
 *
 * Validates the specDrivenPipeline dimension scoring logic including the
 * execution-evidence bonuses added in the 9.5/10 masterplan.
 *
 * All tests use injection seams — zero real LLM calls, zero real filesystem I/O
 * (except where testing the evidence-detection path with temp dirs).
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  computeSpecDrivenPipelineScore,
  computeHarshScore,
  type PipelineEvidenceFlags,
  type HarshScorerOptions,
} from '../src/core/harsh-scorer.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { MaturityAssessment } from '../src/core/maturity-assessor.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScore(score: number): ScoreResult {
  return {
    artifact: 'SPEC' as ScoredArtifact,
    score,
    dimensions: {
      completeness: 15, clarity: 15, testability: 15,
      constitutionAlignment: 15, integrationFitness: 8, freshness: 7,
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'advance',
    hasCEOReviewBonus: false,
  };
}

function makeAllArtifacts(score = 80): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScore(score),
    SPEC: makeScore(score),
    CLARIFY: makeScore(score),
    PLAN: makeScore(score),
    TASKS: makeScore(score),
  };
}

function makeMinimalState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'verify',
    currentPhase: 1,
    tasks: { 1: [{ name: 'task1' }] },
    auditLog: Array(5).fill('entry'),
    profile: 'balanced',
    lastVerifyStatus: 'pass',
    autoforgeEnabled: false,
    ...overrides,
  } as DanteState;
}

function makeAssessment(): MaturityAssessment {
  return {
    level: 4,
    levelName: 'Beta',
    score: 70,
    dimensions: {
      functionality: 70, testing: 70, errorHandling: 65, security: 70,
      uxPolish: 60, documentation: 72, performance: 68, maintainability: 74,
    },
    gaps: [],
    founderExplanation: 'Beta quality.',
    recommendation: 'refine',
    timestamp: new Date().toISOString(),
  };
}

function makeTracker(): CompletionTracker {
  return { overallCompletion: 70, phaseScores: {}, blockingGaps: [], healthScore: 70 } as unknown as CompletionTracker;
}

function makeHarshOptions(overrides: Partial<HarshScorerOptions> = {}): HarshScorerOptions {
  return {
    cwd: '/fake/project',
    targetLevel: 5,
    _loadState: async () => makeMinimalState({ workflowStage: 'synthesize' }),
    _scoreAllArtifacts: async () => makeAllArtifacts(80),
    _assessMaturity: async () => makeAssessment(),
    _computeCompletionTracker: () => makeTracker(),
    _readFile: async () => 'const x = 1;',
    _listSourceFiles: async () => ['src/index.ts'],
    _readHistory: async () => [],
    _writeHistory: async () => {},
    _existsFn: async () => false, // no evidence by default
    ...overrides,
  };
}

// ── computeSpecDrivenPipelineScore ────────────────────────────────────────────

describe('computeSpecDrivenPipelineScore — base behavior', () => {
  it('base score is 20 with no artifacts and no recognized stage', () => {
    const score = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    assert.strictEqual(score, 20);
  });

  it('each PDSE artifact present adds exactly 12 points', () => {
    const one = computeSpecDrivenPipelineScore(
      { CONSTITUTION: makeScore(80) },
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    assert.strictEqual(one, 32); // 20 + 12

    const five = computeSpecDrivenPipelineScore(
      makeAllArtifacts(80),
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    assert.strictEqual(five, 80); // 20 + 60
  });

  it('stageIndex >= 5 (plan/tasks/forge/verify/synthesize) adds 20 points', () => {
    for (const stage of ['plan', 'tasks', 'forge', 'verify', 'synthesize'] as DanteState['workflowStage'][]) {
      const score = computeSpecDrivenPipelineScore(
        {},
        makeMinimalState({ workflowStage: stage }),
      );
      assert.strictEqual(score, 40, `stage=${stage} should add 20`); // 20 + 20
    }
  });

  it('stageIndex 3-4 (specify/clarify) adds 10 points', () => {
    for (const stage of ['specify', 'clarify'] as DanteState['workflowStage'][]) {
      const score = computeSpecDrivenPipelineScore(
        {},
        makeMinimalState({ workflowStage: stage }),
      );
      assert.strictEqual(score, 30, `stage=${stage} should add 10`); // 20 + 10
    }
  });

  it('score is capped at 95 (ceiling change from 100)', () => {
    // Max possible without evidence: 20+60+20 = 100 → capped at 95
    const score = computeSpecDrivenPipelineScore(
      makeAllArtifacts(80),
      makeMinimalState({ workflowStage: 'synthesize' }),
    );
    assert.strictEqual(score, 95);
  });
});

describe('computeSpecDrivenPipelineScore — evidence bonuses', () => {
  it('hasPipelineEvidence: true adds 15 points', () => {
    const noEvidence = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    const withEvidence = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
      { hasPipelineEvidence: true, hasE2ETest: false },
    );
    assert.strictEqual(withEvidence - noEvidence, 15);
  });

  it('hasE2ETest: true adds 10 points', () => {
    const noTest = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    const withTest = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
      { hasPipelineEvidence: false, hasE2ETest: true },
    );
    assert.strictEqual(withTest - noTest, 10);
  });

  it('both evidence flags stack: +25 total', () => {
    const base = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
    );
    const withBoth = computeSpecDrivenPipelineScore(
      {},
      makeMinimalState({ workflowStage: 'initialized' }),
      { hasPipelineEvidence: true, hasE2ETest: true },
    );
    assert.strictEqual(withBoth - base, 25);
  });

  it('score is capped at 95 even with all bonuses (125 → 95)', () => {
    // 20 + 60 + 20 + 15 + 10 = 125 → capped at 95
    const score = computeSpecDrivenPipelineScore(
      makeAllArtifacts(80),
      makeMinimalState({ workflowStage: 'synthesize' }),
      { hasPipelineEvidence: true, hasE2ETest: true },
    );
    assert.strictEqual(score, 95);
  });

  it('evidence flags are optional — undefined behaves same as all-false', () => {
    const noFlags = computeSpecDrivenPipelineScore(makeAllArtifacts(80), makeMinimalState());
    const falseFlags = computeSpecDrivenPipelineScore(
      makeAllArtifacts(80), makeMinimalState(),
      { hasPipelineEvidence: false, hasE2ETest: false },
    );
    assert.strictEqual(noFlags, falseFlags);
  });
});

// ── computeHarshScore + _existsFn injection ───────────────────────────────────

describe('computeHarshScore evidence detection via _existsFn', () => {
  it('specDrivenPipeline gains evidence bonus when _existsFn returns true for pipeline-run.json path', async () => {
    // Use 'constitution' stage (stageIndex=2, no +20 bonus) so base=80 and doesn't pre-cap at 95
    const lowStageOpts = { _loadState: async () => makeMinimalState({ workflowStage: 'constitution' }) };
    const withEvidence = await computeHarshScore(makeHarshOptions({
      ...lowStageOpts,
      _existsFn: async (p) => p.includes('pipeline-run.json'),
    }));
    const withoutEvidence = await computeHarshScore(makeHarshOptions({
      ...lowStageOpts,
      _existsFn: async () => false,
    }));
    assert.ok(
      withEvidence.dimensions.specDrivenPipeline > withoutEvidence.dimensions.specDrivenPipeline,
      'evidence path should raise specDrivenPipeline score',
    );
    // base=80 without evidence, 80+15=95 with evidence → difference=15
    assert.strictEqual(
      withEvidence.dimensions.specDrivenPipeline - withoutEvidence.dimensions.specDrivenPipeline,
      15,
    );
  });

  it('specDrivenPipeline gains E2E test bonus when _existsFn returns true for e2e-spec-pipeline.test.ts', async () => {
    // Use 'constitution' stage so base=80, adding +10 → 90 (not capped)
    const lowStageOpts = { _loadState: async () => makeMinimalState({ workflowStage: 'constitution' }) };
    const withTest = await computeHarshScore(makeHarshOptions({
      ...lowStageOpts,
      _existsFn: async (p) => p.includes('e2e-spec-pipeline.test.ts'),
    }));
    const withoutTest = await computeHarshScore(makeHarshOptions({
      ...lowStageOpts,
      _existsFn: async () => false,
    }));
    assert.strictEqual(
      withTest.dimensions.specDrivenPipeline - withoutTest.dimensions.specDrivenPipeline,
      10,
    );
  });

  it('specDrivenPipeline reaches 95 when all artifacts + synthesize stage + both evidence flags', async () => {
    const result = await computeHarshScore(makeHarshOptions({
      _loadState: async () => makeMinimalState({ workflowStage: 'synthesize' }),
      _scoreAllArtifacts: async () => makeAllArtifacts(80),
      _existsFn: async () => true, // all evidence paths detected
    }));
    assert.strictEqual(result.dimensions.specDrivenPipeline, 95);
  });

  it('specDrivenPipeline is unaffected by non-evidence paths returning true', async () => {
    // Only pipeline-run.json and e2e-spec-pipeline.test.ts paths matter
    const result = await computeHarshScore(makeHarshOptions({
      _existsFn: async (p) => p.includes('random-other-file.json'),
    }));
    const baseline = await computeHarshScore(makeHarshOptions({
      _existsFn: async () => false,
    }));
    assert.strictEqual(
      result.dimensions.specDrivenPipeline,
      baseline.dimensions.specDrivenPipeline,
    );
  });
});

// ── Evidence file schema ──────────────────────────────────────────────────────

describe('pipeline-run.json evidence schema', () => {
  let tmpDir = '';

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-pipeline-evidence-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reads and validates the todo-app evidence file schema', async () => {
    const evidencePath = path.resolve('examples/todo-app/evidence/pipeline-run.json');
    let raw: string;
    try {
      raw = await fs.readFile(evidencePath, 'utf8');
    } catch {
      // Skip if running outside DanteForge repo root
      return;
    }
    const evidence = JSON.parse(raw) as {
      pipeline?: { success?: boolean; stages?: unknown[]; pdseScores?: Record<string, number> };
    };
    assert.ok(evidence.pipeline, 'pipeline key must exist');
    assert.strictEqual(evidence.pipeline.success, true, 'success must be true');
    assert.ok(Array.isArray(evidence.pipeline.stages) && evidence.pipeline.stages.length > 0,
      'stages must be a non-empty array');
    assert.ok(typeof evidence.pipeline.pdseScores === 'object' && evidence.pipeline.pdseScores !== null,
      'pdseScores must be an object');
    const scores = evidence.pipeline.pdseScores;
    assert.ok(scores['CONSTITUTION'] && scores['CONSTITUTION'] > 0, 'CONSTITUTION score > 0');
    assert.ok(scores['SPEC'] && scores['SPEC'] > 0, 'SPEC score > 0');
  });
});
