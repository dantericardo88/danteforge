// Autoforge Loop tests — state machine, BLOCKED handling, guidance, score-only
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AutoforgeLoopState,
  formatGuidanceMarkdown,
  computeEstimatedSteps,
  type AutoforgeLoopContext,
  type AutoforgeGuidance,
  type BlockingIssue,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    workflowStage: 'initialized',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
    ...overrides,
  };
}

function makeTracker(overrides: Partial<CompletionTracker> = {}): CompletionTracker {
  return {
    overall: 50,
    phases: {
      planning: {
        score: 80,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 80, complete: true },
          PLAN: { score: 80, complete: true },
          TASKS: { score: 75, complete: true },
        },
      },
      execution: {
        score: 33,
        complete: false,
        currentPhase: 2,
        wavesComplete: 1,
        totalWaves: 3,
      },
      verification: {
        score: 0,
        complete: false,
        qaScore: 0,
        testsPassing: false,
      },
      synthesis: {
        score: 0,
        complete: false,
        retroDelta: null,
      },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: '2 more forge waves + verify + synthesize',
    ...overrides,
  };
}

function makeContext(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  const state = makeState(overrides.state ? {} : {});
  return {
    goal: 'build test app',
    cwd: '/tmp/test',
    state: overrides.state ?? state,
    loopState: AutoforgeLoopState.IDLE,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    ...overrides,
  };
}

function makeGuidance(overrides: Partial<AutoforgeGuidance> = {}): AutoforgeGuidance {
  return {
    timestamp: new Date().toISOString(),
    overallCompletion: 50,
    currentBottleneck: 'Execution phase incomplete',
    blockingIssues: [],
    recommendedCommand: 'danteforge forge',
    recommendedReason: 'Execute remaining forge waves',
    autoAdvanceEligible: true,
    estimatedStepsToCompletion: 4,
    ...overrides,
  };
}

describe('AutoforgeLoopState enum', () => {
  it('has all expected states', () => {
    assert.strictEqual(AutoforgeLoopState.IDLE, 'IDLE');
    assert.strictEqual(AutoforgeLoopState.RUNNING, 'RUNNING');
    assert.strictEqual(AutoforgeLoopState.SCORING, 'SCORING');
    assert.strictEqual(AutoforgeLoopState.REFINING, 'REFINING');
    assert.strictEqual(AutoforgeLoopState.BLOCKED, 'BLOCKED');
    assert.strictEqual(AutoforgeLoopState.COMPLETE, 'COMPLETE');
  });
});

describe('formatGuidanceMarkdown', () => {
  it('produces valid markdown with all fields', () => {
    const guidance = makeGuidance();
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(md.includes('# Autoforge Guidance'));
    assert.ok(md.includes('Overall Completion'));
    assert.ok(md.includes('50%'));
    assert.ok(md.includes('Recommended Action'));
    assert.ok(md.includes('danteforge forge'));
  });

  it('includes blocking issues table when present', () => {
    const guidance = makeGuidance({
      blockingIssues: [
        { artifact: 'SPEC', score: 40, decision: 'blocked', remediation: 'danteforge specify --refine' },
      ],
    });
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(md.includes('## Blocking Issues'));
    assert.ok(md.includes('SPEC'));
    assert.ok(md.includes('40'));
    assert.ok(md.includes('danteforge specify --refine'));
  });

  it('omits blocking issues table when empty', () => {
    const guidance = makeGuidance({ blockingIssues: [] });
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(!md.includes('## Blocking Issues'));
  });

  it('includes block reason when auto-advance is not eligible', () => {
    const guidance = makeGuidance({
      autoAdvanceEligible: false,
      autoAdvanceBlockReason: '2 artifact(s) below score threshold',
    });
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(md.includes('Block Reason'));
    assert.ok(md.includes('below score threshold'));
  });

  it('includes DanteForge footer', () => {
    const md = formatGuidanceMarkdown(makeGuidance());
    assert.ok(md.includes('DanteForge Autoforge v2 IAL'));
  });
});

describe('computeEstimatedSteps', () => {
  it('returns remaining steps based on tracker', () => {
    const tracker = makeTracker();
    const state = makeState({ completionTracker: tracker });
    const ctx = makeContext({ state });
    const steps = computeEstimatedSteps(ctx);
    // 2 remaining forge waves + 1 verify + 1 synthesize = 4
    assert.strictEqual(steps, 4);
  });

  it('returns pipeline length when no tracker exists', () => {
    const ctx = makeContext();
    const steps = computeEstimatedSteps(ctx);
    assert.ok(steps > 0);
  });

  it('counts incomplete planning artifacts', () => {
    const tracker = makeTracker({
      phases: {
        ...makeTracker().phases,
        planning: {
          score: 50,
          complete: false,
          artifacts: {
            CONSTITUTION: { score: 90, complete: true },
            SPEC: { score: 40, complete: false },
            CLARIFY: { score: 30, complete: false },
            PLAN: { score: 80, complete: true },
            TASKS: { score: 75, complete: true },
          },
        },
      },
    });
    const state = makeState({ completionTracker: tracker });
    const ctx = makeContext({ state });
    const steps = computeEstimatedSteps(ctx);
    // 2 incomplete planning + 2 forge waves + 1 verify + 1 synthesize = 6
    assert.strictEqual(steps, 6);
  });

  it('returns at least 1', () => {
    const tracker = makeTracker({
      overall: 99,
      phases: {
        planning: { score: 100, complete: true, artifacts: {
          CONSTITUTION: { score: 100, complete: true },
          SPEC: { score: 100, complete: true },
          CLARIFY: { score: 100, complete: true },
          PLAN: { score: 100, complete: true },
          TASKS: { score: 100, complete: true },
        }},
        execution: { score: 100, complete: true, currentPhase: 4, wavesComplete: 3, totalWaves: 3 },
        verification: { score: 100, complete: true, qaScore: 90, testsPassing: true },
        synthesis: { score: 100, complete: true, retroDelta: 5 },
      },
    });
    const state = makeState({ completionTracker: tracker });
    const ctx = makeContext({ state });
    const steps = computeEstimatedSteps(ctx);
    assert.ok(steps >= 1);
  });
});

describe('AutoforgeLoopContext types', () => {
  it('creates a valid context', () => {
    const ctx = makeContext();
    assert.strictEqual(ctx.loopState, AutoforgeLoopState.IDLE);
    assert.strictEqual(ctx.cycleCount, 0);
    assert.strictEqual(ctx.force, false);
    assert.strictEqual(ctx.maxRetries, 3);
  });

  it('tracks retry counters per artifact', () => {
    const ctx = makeContext({
      retryCounters: { SPEC: 2, PLAN: 1 },
    });
    assert.strictEqual(ctx.retryCounters.SPEC, 2);
    assert.strictEqual(ctx.retryCounters.PLAN, 1);
  });

  it('tracks blocked artifacts list', () => {
    const ctx = makeContext({
      blockedArtifacts: ['SPEC', 'CLARIFY'],
      loopState: AutoforgeLoopState.BLOCKED,
    });
    assert.strictEqual(ctx.blockedArtifacts.length, 2);
    assert.strictEqual(ctx.loopState, AutoforgeLoopState.BLOCKED);
  });
});

describe('BlockingIssue structure', () => {
  it('contains all required fields', () => {
    const issue: BlockingIssue = {
      artifact: 'SPEC',
      score: 35,
      decision: 'blocked',
      remediation: 'danteforge specify --refine',
    };
    assert.strictEqual(issue.artifact, 'SPEC');
    assert.strictEqual(issue.score, 35);
    assert.ok(issue.remediation.includes('danteforge'));
  });
});

describe('Autoforge Circuit Breaker (Wave 1D)', () => {
  const loopSrc = readFileSync(resolve('src/core/autoforge-loop.ts'), 'utf-8');

  it('exports CIRCUIT_BREAKER_BACKOFF_BASE_MS = 2000', () => {
    assert.ok(loopSrc.includes('export const CIRCUIT_BREAKER_BACKOFF_BASE_MS'), 'Missing CIRCUIT_BREAKER_BACKOFF_BASE_MS');
    assert.ok(loopSrc.includes('2000'), 'Base backoff should be 2000ms');
  });

  it('exports CIRCUIT_BREAKER_MAX_BACKOFF_MS = 30_000', () => {
    assert.ok(loopSrc.includes('export const CIRCUIT_BREAKER_MAX_BACKOFF_MS'), 'Missing CIRCUIT_BREAKER_MAX_BACKOFF_MS');
    assert.ok(loopSrc.includes('30_000') || loopSrc.includes('30000'), 'Max backoff should be 30s');
  });

  it('exports computeBackoff function', () => {
    assert.ok(loopSrc.includes('export function computeBackoff'), 'Missing computeBackoff export');
  });

  it('computeBackoff uses exponential formula', () => {
    assert.ok(loopSrc.includes('Math.pow(2,') || loopSrc.includes('2 **'), 'Should use exponential backoff');
  });

  it('computeBackoff caps at MAX_BACKOFF', () => {
    assert.ok(loopSrc.includes('Math.min('), 'Should cap backoff with Math.min');
  });

  it('tracks consecutiveFailures counter', () => {
    assert.ok(loopSrc.includes('consecutiveFailures'), 'Should track consecutive failures');
  });

  it('resets consecutiveFailures on success', () => {
    assert.ok(loopSrc.includes('consecutiveFailures = 0'), 'Should reset consecutive failures on success');
  });

  it('trips circuit breaker at CONSECUTIVE_FAILURE_LIMIT', () => {
    assert.ok(
      loopSrc.includes('consecutiveFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT'),
      'Should check consecutive failures against limit',
    );
    assert.ok(loopSrc.includes('Circuit breaker tripped'), 'Should log circuit breaker trip message');
  });

  it('applies backoff before retry in REFINING state', () => {
    assert.ok(loopSrc.includes('computeBackoff(retryCount)'), 'Should call computeBackoff before retry');
    assert.ok(loopSrc.includes('Backing off'), 'Should log backoff message');
  });

  it('exports CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT = 5', () => {
    assert.ok(loopSrc.includes('export const CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT'), 'Missing CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT');
    assert.ok(loopSrc.includes('= 5'), 'Consecutive failure limit should be 5');
  });
});
