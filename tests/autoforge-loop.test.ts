// Autoforge Loop tests — state machine, BLOCKED handling, guidance, score-only
import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import fsPromises from 'node:fs/promises';
import { resolve } from 'node:path';
import path from 'node:path';
import os from 'node:os';
import {
  AutoforgeLoopState,
  formatGuidanceMarkdown,
  computeEstimatedSteps,
  computeBackoff,
  writeGuidanceFile,
  checkProtectedTaskPaths,
  runAutoforgeLoop,
  CIRCUIT_BREAKER_BACKOFF_BASE_MS,
  CIRCUIT_BREAKER_MAX_BACKOFF_MS,
  CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT,
  type AutoforgeLoopContext,
  type AutoforgeLoopDeps,
  type AutoforgeGuidance,
  type BlockingIssue,
} from '../src/core/autoforge-loop.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker } from '../src/core/completion-tracker.js';

const tempDirs: string[] = [];
after(async () => {
  for (const dir of tempDirs) {
    await fsPromises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

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

// ── computeBackoff — direct function call tests ────────────────────────────

describe('computeBackoff direct tests', () => {
  it('retryCount=0 returns base backoff', () => {
    const result = computeBackoff(0);
    assert.strictEqual(result, CIRCUIT_BREAKER_BACKOFF_BASE_MS);
  });

  it('retryCount=1 doubles the base', () => {
    const result = computeBackoff(1);
    assert.strictEqual(result, CIRCUIT_BREAKER_BACKOFF_BASE_MS * 2);
  });

  it('retryCount=2 quadruples the base', () => {
    const result = computeBackoff(2);
    assert.strictEqual(result, CIRCUIT_BREAKER_BACKOFF_BASE_MS * 4);
  });

  it('high retryCount caps at MAX_BACKOFF', () => {
    const result = computeBackoff(100);
    assert.strictEqual(result, CIRCUIT_BREAKER_MAX_BACKOFF_MS);
  });

  it('negative retryCount returns base or less (no crash)', () => {
    const result = computeBackoff(-1);
    assert.ok(result <= CIRCUIT_BREAKER_BACKOFF_BASE_MS);
    assert.ok(result > 0);
  });
});

// ── formatGuidanceMarkdown — additional edge cases ─────────────────────────

describe('formatGuidanceMarkdown extra cases', () => {
  it('includes estimatedStepsToCompletion when provided', () => {
    const guidance = makeGuidance({ estimatedStepsToCompletion: 7 });
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(md.includes('7'), 'should include estimated steps count');
  });

  it('formats multiple blocking issues', () => {
    const guidance = makeGuidance({
      blockingIssues: [
        { artifact: 'SPEC', score: 20, remediation: 'danteforge specify' },
        { artifact: 'PLAN', score: 15, remediation: 'danteforge plan' },
        { artifact: 'TASKS', score: 10, remediation: 'danteforge tasks' },
      ],
    });
    const md = formatGuidanceMarkdown(guidance);
    assert.ok(md.includes('SPEC'), 'should include SPEC');
    assert.ok(md.includes('PLAN'), 'should include PLAN');
    assert.ok(md.includes('TASKS'), 'should include TASKS');
  });
});

// ── computeEstimatedSteps — edge cases ─────────────────────────────────────

describe('computeEstimatedSteps extra cases', () => {
  it('all phases complete returns 1', () => {
    const ctx = makeContext({
      state: makeState({
        completionTracker: makeTracker({
          overall: 100,
          phases: {
            planning: { score: 100, complete: true, artifacts: {} },
            execution: { score: 100, complete: true, currentPhase: 3, wavesComplete: 3, totalWaves: 3 },
            verification: { score: 100, complete: true, artifacts: {} },
            synthesis: { score: 100, complete: true, artifacts: {} },
          },
        }),
      } as Partial<DanteState>),
    });
    const steps = computeEstimatedSteps(ctx);
    assert.strictEqual(steps, 1, 'all complete should need exactly 1 step (Math.max(1, 0))');
  });

  it('partially complete returns reasonable estimate', () => {
    const ctx = makeContext({
      state: makeState({
        completionTracker: makeTracker({
          overall: 50,
          phases: {
            planning: { score: 100, complete: true, artifacts: {} },
            execution: { score: 50, complete: false, currentPhase: 1, wavesComplete: 1, totalWaves: 3 },
            verification: { score: 0, complete: false, artifacts: {} },
            synthesis: { score: 0, complete: false, artifacts: {} },
          },
        }),
      } as Partial<DanteState>),
    });
    const steps = computeEstimatedSteps(ctx);
    assert.ok(steps >= 2, 'partially complete should need multiple steps');
  });

  it('no tracker returns pipeline stage count', () => {
    const ctx = makeContext();
    const steps = computeEstimatedSteps(ctx);
    assert.ok(steps > 0, 'should return positive steps');
  });
});

// ── AutoforgeLoopState enum ────────────────────────────────────────────────

describe('AutoforgeLoopState enum values', () => {
  it('all enum values are distinct strings', () => {
    const values = Object.values(AutoforgeLoopState);
    const unique = new Set(values);
    assert.strictEqual(values.length, unique.size, 'All enum values should be distinct');
  });
});


// ── writeGuidanceFile — filesystem test ────────────────────────────────────

describe('writeGuidanceFile', () => {
  it('writes guidance YAML to correct path', async () => {
    const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'df-guidance-'));
    tempDirs.push(dir);
    await fsPromises.mkdir(path.join(dir, '.danteforge'), { recursive: true });

    const guidance = makeGuidance({ recommendedCommand: 'danteforge forge' });
    await writeGuidanceFile(guidance, dir);

    const guidancePath = path.join(dir, '.danteforge', 'AUTOFORGE_GUIDANCE.md');
    const exists = await fsPromises.access(guidancePath).then(() => true).catch(() => false);
    assert.ok(exists, 'Guidance file should be written');

    const content = await fsPromises.readFile(guidancePath, 'utf8');
    assert.ok(content.includes('forge'), 'File should contain recommendation');
  });
});

// ── Context and dryRun ─────────────────────────────────────────────────────

describe('AutoforgeLoopContext fields', () => {
  it('dryRun flag is preserved in context', () => {
    const ctx = makeContext({ dryRun: true });
    assert.strictEqual(ctx.dryRun, true);
  });

  it('context preserves all required fields with correct defaults', () => {
    const ctx = makeContext();
    assert.strictEqual(ctx.goal, 'build test app');
    assert.strictEqual(ctx.cwd, '/tmp/test');
    assert.strictEqual(ctx.maxRetries, 3);
    assert.strictEqual(ctx.cycleCount, 0);
    assert.strictEqual(ctx.loopState, AutoforgeLoopState.IDLE);
    assert.strictEqual(ctx.force, false);
    assert.deepStrictEqual(ctx.blockedArtifacts, []);
    assert.deepStrictEqual(ctx.retryCounters, {});
  });
});

// ── checkProtectedTaskPaths ─────────────────────────────────────────────────

describe('checkProtectedTaskPaths', () => {
  it('returns approved=true when tasks have no files', async () => {
    const state = makeState({
      currentPhase: 1,
      tasks: { 1: [{ name: 'task-no-files' }] },
    });
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async () => true,
    });
    assert.strictEqual(result.approved, true);
    assert.deepStrictEqual(result.blocked, []);
  });

  it('returns approved=true when no tasks in current phase', async () => {
    const state = makeState({ currentPhase: 1, tasks: {} });
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async () => { throw new Error('should not be called'); },
    });
    assert.strictEqual(result.approved, true);
    assert.deepStrictEqual(result.blocked, []);
  });

  it('returns approved=true when files are all non-protected', async () => {
    const state = makeState({
      currentPhase: 1,
      tasks: { 1: [{ name: 'task-a', files: ['src/core/llm.ts', 'tests/foo.test.ts'] }] },
    });
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async () => true,
    });
    assert.strictEqual(result.approved, true);
    assert.deepStrictEqual(result.blocked, []);
  });

  it('returns approved=false with blocked file when protected path is denied (deny policy)', async () => {
    const state = makeState({
      currentPhase: 1,
      selfEditPolicy: 'deny',
      tasks: { 1: [{ name: 'modify-state', files: ['src/core/state.ts'] }] },
    });
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async () => false,   // deny injection
    });
    assert.strictEqual(result.approved, false);
    assert.ok(result.blocked.includes('src/core/state.ts'));
  });

  it('returns approved=true when protected path is approved via allow-with-audit', async () => {
    const state = makeState({
      currentPhase: 1,
      selfEditPolicy: 'allow-with-audit',
      tasks: { 1: [{ name: 'update-cli', files: ['src/cli/index.ts'] }] },
    });
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async () => true,    // allow-with-audit injection
    });
    assert.strictEqual(result.approved, true);
    assert.deepStrictEqual(result.blocked, []);
  });

  it('uses selfEditPolicy from state (defaults to deny when undefined)', async () => {
    let receivedPolicy: string | undefined;
    const state = makeState({
      currentPhase: 1,
      tasks: { 1: [{ name: 'risky-task', files: ['src/core/gates.ts'] }] },
    });
    // selfEditPolicy not set — should default to 'deny'
    const result = await checkProtectedTaskPaths(state, {
      _requestApproval: async (_file, _reason, opts) => {
        receivedPolicy = typeof opts === 'object' ? opts?.policy : undefined;
        return false;
      },
    });
    assert.strictEqual(receivedPolicy, 'deny');
    assert.strictEqual(result.approved, false);
  });
});

// ── runAutoforgeLoop integration — _checkProtectedPaths seam ─────────────────

// Helpers for loop integration tests
function makeAllScores(score: number): Record<ScoredArtifact, ScoreResult> {
  const dims = {
    completeness: Math.round(score * 0.2),
    clarity: Math.round(score * 0.2),
    testability: Math.round(score * 0.2),
    constitutionAlignment: Math.round(score * 0.2),
    integrationFitness: Math.round(score * 0.1),
    freshness: Math.round(score * 0.1),
  };
  const makeOne = (a: ScoredArtifact): ScoreResult => ({
    artifact: a,
    score,
    dimensions: dims,
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: score >= 90 ? 'advance' : score >= 70 ? 'warn' : score >= 50 ? 'pause' : 'blocked',
    hasCEOReviewBonus: false,
  });
  return {
    CONSTITUTION: makeOne('CONSTITUTION'),
    SPEC: makeOne('SPEC'),
    CLARIFY: makeOne('CLARIFY'),
    PLAN: makeOne('PLAN'),
    TASKS: makeOne('TASKS'),
  };
}

// Tracker that makes planning complete but execution/verification incomplete
// (so the loop recommends 'forge' next)
function makeForgeReadyTracker(): CompletionTracker {
  return makeTracker({
    overall: 30,
    phases: {
      planning: {
        score: 85,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 85, complete: true },
          PLAN: { score: 85, complete: true },
          TASKS: { score: 80, complete: true },
        },
      },
      execution: { score: 0, complete: false, currentPhase: 1, wavesComplete: 0, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
  });
}

function makeMockDeps(overrides: Partial<AutoforgeLoopDeps> = {}): AutoforgeLoopDeps {
  const tracker = makeForgeReadyTracker();
  const state = makeState({ currentPhase: 1, tasks: { 1: [{ name: 'task-a' }], 2: [{ name: 'task-b' }], 3: [{ name: 'task-c' }] } });
  return {
    scoreAllArtifacts: async () => makeAllScores(85),
    persistScoreResult: async () => '/tmp/score.json',
    detectProjectType: async () => 'cli',
    computeCompletionTracker: () => tracker,
    recordMemory: async () => {},
    loadState: async () => state,
    saveState: async () => {},
    setTimeout: (fn, _ms) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    _checkProtectedPaths: async () => ({ approved: true, blocked: [] }),
    ...overrides,
  };
}

describe('runAutoforgeLoop integration — _checkProtectedPaths seam', () => {
  it('sets loopState=BLOCKED when _checkProtectedPaths returns approved=false', async () => {
    const ctx = makeContext({ dryRun: false });
    const result = await runAutoforgeLoop(ctx, makeMockDeps({
      _checkProtectedPaths: async () => ({ approved: false, blocked: ['src/core/state.ts'] }),
    }));
    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
  });

  it('sets blockedArtifacts to the blocked files list from _checkProtectedPaths', async () => {
    const ctx = makeContext({ dryRun: false });
    const result = await runAutoforgeLoop(ctx, makeMockDeps({
      _checkProtectedPaths: async () => ({ approved: false, blocked: ['src/core/state.ts', 'src/cli/index.ts'] }),
    }));
    assert.deepStrictEqual(result.blockedArtifacts, ['src/core/state.ts', 'src/cli/index.ts']);
  });

  it('loop breaks after protected path block without continuing execution', async () => {
    let saveCallCount = 0;
    const ctx = makeContext({ dryRun: false });
    await runAutoforgeLoop(ctx, makeMockDeps({
      _checkProtectedPaths: async () => ({ approved: false, blocked: ['src/core/state.ts'] }),
      saveState: async () => { saveCallCount++; },
    }));
    // saveState called at most twice (one pre-block + one at block), not looping indefinitely
    assert.ok(saveCallCount <= 2, `Expected ≤2 saveState calls, got ${saveCallCount}`);
  });

  it('loop completes normally when _checkProtectedPaths returns approved=true', async () => {
    const ctx = makeContext({ dryRun: true });   // dryRun breaks after guidance, no blocked paths gate
    const result = await runAutoforgeLoop(ctx, makeMockDeps({
      _checkProtectedPaths: async () => ({ approved: true, blocked: [] }),
    }));
    // dryRun exits cleanly before gate but loop did not BLOCK
    assert.notStrictEqual(result.loopState, AutoforgeLoopState.BLOCKED);
  });

  it('_checkProtectedPaths is not called when planning is incomplete (nextCommand != forge)', async () => {
    let checkCalled = false;
    // Make planning incomplete by returning low scores
    const ctx = makeContext({ dryRun: true });
    await runAutoforgeLoop(ctx, makeMockDeps({
      scoreAllArtifacts: async () => makeAllScores(40), // below ACCEPTABLE=70 → planning incomplete → nextCommand = specify/etc
      computeCompletionTracker: () => makeTracker({
        overall: 15,
        phases: {
          planning: {
            score: 40, complete: false,
            artifacts: {
              CONSTITUTION: { score: 40, complete: false },
              SPEC: { score: 40, complete: false },
              CLARIFY: { score: 40, complete: false },
              PLAN: { score: 40, complete: false },
              TASKS: { score: 40, complete: false },
            },
          },
          execution: { score: 0, complete: false, currentPhase: 1, wavesComplete: 0, totalWaves: 3 },
          verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
          synthesis: { score: 0, complete: false, retroDelta: null },
        },
      }),
      _checkProtectedPaths: async () => { checkCalled = true; return { approved: true, blocked: [] }; },
    }));
    assert.strictEqual(checkCalled, false);
  });
});

// ── runAutoforgeLoop integration — _executeCommand seam ───────────────────────

describe('runAutoforgeLoop — _executeCommand seam', () => {
  it('calls _executeCommand with the determined next command', async () => {
    const executed: string[] = [];
    let cycle = 0;
    await runAutoforgeLoop(makeContext({ dryRun: false }), makeMockDeps({
      computeCompletionTracker: () => cycle++ > 0 ? makeTracker({ overall: 96 }) : makeForgeReadyTracker(),
      _executeCommand: async (cmd) => { executed.push(cmd); return { success: true }; },
    }));
    assert.ok(executed.length > 0, 'should have dispatched at least one command');
  });

  it('_executeCommand receives the project cwd', async () => {
    let receivedCwd = '';
    let cycle = 0;
    const testCwd = '/tmp/exec-cwd-test';
    const ctx = makeContext({ dryRun: false, cwd: testCwd });
    await runAutoforgeLoop(ctx, makeMockDeps({
      computeCompletionTracker: () => cycle++ > 0 ? makeTracker({ overall: 96 }) : makeForgeReadyTracker(),
      _executeCommand: async (_cmd, cwd) => { receivedCwd = cwd; return { success: true }; },
    }));
    assert.strictEqual(receivedCwd, testCwd, '_executeCommand should receive the context cwd');
  });

  it('loop continues after _executeCommand failure (resilient execution)', async () => {
    let callCount = 0;
    let cycle = 0;
    await runAutoforgeLoop(makeContext({ dryRun: false }), makeMockDeps({
      computeCompletionTracker: () => cycle++ > 0 ? makeTracker({ overall: 96 }) : makeForgeReadyTracker(),
      _executeCommand: async () => { callCount++; return { success: false }; },
    }));
    assert.ok(callCount >= 1, 'loop should still attempt execution despite prior failure');
  });

  it('loop works without _executeCommand (advisory/log-only mode)', async () => {
    const ctx = makeContext({ dryRun: true });
    await assert.doesNotReject(() => runAutoforgeLoop(ctx, makeMockDeps()));
  });
});

// ── Advisory mode + circuit breaker (Batch B) ─────────────────────────────────

describe('runAutoforgeLoop — advisory mode + execution circuit breaker', () => {
  it('exits after one cycle in advisory mode when no _executeCommand and dryRun=false', async () => {
    const ctx = makeContext({ dryRun: false });
    // No _executeCommand provided — should hit advisory guard and break
    const result = await runAutoforgeLoop(ctx, makeMockDeps());
    // Loop should exit cleanly — not stuck in RUNNING
    assert.notStrictEqual(result.loopState, AutoforgeLoopState.RUNNING, 'advisory mode should not stay RUNNING forever');
  });

  it('circuit breaker trips to BLOCKED after repeated _executeCommand failures', async () => {
    // Always-failing executor + tracker that stays incomplete → consecutiveExecFailures accumulates
    const result = await runAutoforgeLoop(makeContext({ dryRun: false }), makeMockDeps({
      computeCompletionTracker: () => makeForgeReadyTracker(), // always incomplete
      _executeCommand: async () => ({ success: false }),
    }));
    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED, 'circuit breaker should trip after repeated exec failures');
  });
});

// ── SIGINT / force override / permanent block (Batch C) ───────────────────────

describe('runAutoforgeLoop — interrupt / force / retry paths', () => {
  it('saves state with interrupt audit entry when signal fires before loop starts', async () => {
    let savedState: import('../src/core/state.js').DanteState | null = null;
    await runAutoforgeLoop(makeContext({ dryRun: false }), makeMockDeps({
      _addSignalListener: (_signal, handler) => { handler(); }, // fire immediately = interrupt before first cycle
      _removeSignalListener: () => {},
      saveState: async (state) => { savedState = state; },
    }));
    assert.ok(savedState !== null, 'state should be saved when interrupted');
    const lastEntry = savedState!.auditLog.at(-1) ?? '';
    assert.ok(lastEntry.includes('interrupted'), 'audit log should record the interrupt');
  });

  it('force flag prevents permanent block on first cycle with low-score artifacts', async () => {
    let cycle = 0;
    const result = await runAutoforgeLoop(makeContext({ dryRun: false, force: true }), makeMockDeps({
      scoreAllArtifacts: async () => makeAllScores(20), // all artifacts below NEEDS_WORK → blocked
      computeCompletionTracker: () => cycle++ > 0 ? makeTracker({ overall: 96 }) : makeForgeReadyTracker(),
      _executeCommand: async () => ({ success: true }),
    }));
    assert.notStrictEqual(result.loopState, AutoforgeLoopState.BLOCKED, 'force should prevent permanent block on cycle 1');
  });

  it('permanently blocks when artifact retry counter equals maxRetries', async () => {
    const ctx = makeContext({ dryRun: false, retryCounters: { SPEC: 3 }, maxRetries: 3 });
    const result = await runAutoforgeLoop(ctx, makeMockDeps({
      scoreAllArtifacts: async () => makeAllScores(20), // all artifacts blocked
    }));
    assert.strictEqual(result.loopState, AutoforgeLoopState.BLOCKED, 'should permanently block when retries exhausted');
    assert.ok(result.blockedArtifacts.length > 0, 'blockedArtifacts should be populated');
  });
});
