// cofl-command.test.ts — injection-seam tests for the cofl() CLI command
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DanteState } from '../src/core/state.js';
import { cofl } from '../src/cli/commands/cofl.js';
import type { CoflRegistry, CoflCycleResult } from '../src/core/cofl-engine.js';

const originalExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExitCode; });

// ── Factories ─────────────────────────────────────────────────────────────────

function makeState(): DanteState {
  return {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
}

function makeEmptyRegistry(): CoflRegistry {
  return {
    version: '1.0.0',
    cyclesRun: 0,
    partition: { directPeers: [], specialistTeachers: [], referenceTeachers: [] },
    patterns: [],
    lessons: [],
    gapMap: {},
    strategyNotes: [],
    lastCycleAt: '',
    updatedAt: '2026-04-21T00:00:00Z',
  };
}

function makeMatrix() {
  return {
    project: 'test',
    competitors: ['Cursor', 'Aider'],
    competitors_closed_source: ['Cursor'],
    competitors_oss: ['Aider'],
    overallSelfScore: 6.5,
    dimensions: [
      {
        id: 'ux_polish', label: 'UX Polish', weight: 1.2, category: 'ux',
        frequency: 'high', scores: { self: 6, cursor: 9 },
        gap_to_leader: 3, leader: 'Cursor',
        gap_to_closed_source_leader: 3, closed_source_leader: 'Cursor',
        gap_to_oss_leader: 1.5, oss_leader: 'Aider',
        status: 'in-progress', sprint_history: [], next_sprint_target: 9,
      },
      {
        id: 'testing', label: 'Testing', weight: 1.0, category: 'quality',
        frequency: 'medium', scores: { self: 7, cursor: 8 },
        gap_to_leader: 1, leader: 'Cursor',
        gap_to_closed_source_leader: 1, closed_source_leader: 'Cursor',
        gap_to_oss_leader: 0.5, oss_leader: 'Aider',
        status: 'in-progress', sprint_history: [], next_sprint_target: 9,
      },
    ],
    lastUpdated: '2026-04-21T00:00:00Z',
  };
}

function makeBaseOpts(overrides: Partial<Parameters<typeof cofl>[1]> = {}) {
  const state = makeState();
  const saved: DanteState[] = [];
  const savedRegistries: CoflRegistry[] = [];
  const writtenFiles: Array<[string, string]> = [];

  return {
    _loadState: async () => ({ ...state, auditLog: [...state.auditLog] } as DanteState),
    _saveState: async (s: DanteState) => { saved.push(s); },
    _isLLMAvailable: async () => false,
    _callLLM: async (_p: string) => '[]',
    _loadMatrix: async () => makeMatrix(),
    _loadRegistry: async () => makeEmptyRegistry(),
    _saveRegistry: async (r: CoflRegistry) => { savedRegistries.push(r); },
    _writeFile: async (p: string, c: string) => { writtenFiles.push([p, c]); },
    _now: () => '2026-04-21T00:00:00Z',
    _cwd: '/test',
    saved,
    savedRegistries,
    writtenFiles,
    ...overrides,
  };
}

// ── Universe + Partition phase ────────────────────────────────────────────────

describe('cofl: universe + partition phase', () => {
  it('classifies closed-source competitors as directPeers', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ universe: true }, opts) as CoflCycleResult;
    assert.ok(result, 'should return a cycle result');
    assert.ok(result.partition.directPeers.includes('Cursor'), 'Cursor should be a direct peer');
  });

  it('classifies OSS competitors as referenceTeachers or specialistTeachers', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ universe: true }, opts) as CoflCycleResult;
    const allTeachers = [
      ...result.partition.referenceTeachers,
      ...result.partition.specialistTeachers,
    ];
    assert.ok(allTeachers.includes('Aider'), 'Aider should be a teacher');
  });

  it('saves state with audit log entry', async () => {
    const opts = makeBaseOpts();
    await cofl({ universe: true }, opts);
    assert.ok(opts.saved.length > 0, 'state should be saved');
    assert.ok(opts.saved[0]!.auditLog[0]?.includes('cofl'), 'audit entry should mention cofl');
  });
});

// ── Harvest phase (LLM off) ───────────────────────────────────────────────────

describe('cofl: harvest phase — LLM unavailable', () => {
  it('skips pattern extraction when LLM unavailable and returns empty extractedPatterns', async () => {
    const opts = makeBaseOpts({ _isLLMAvailable: async () => false });
    const result = await cofl({ harvest: true }, opts) as CoflCycleResult;
    assert.strictEqual(result.extractedPatterns.length, 0,
      'no patterns should be extracted without LLM');
  });

  it('still runs anti-failure guards even when harvest is skipped', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ harvest: true }, opts) as CoflCycleResult;
    assert.strictEqual(result.antiFailureChecks.length, 7, 'all 7 guardrails should be checked');
  });
});

// ── Harvest phase (LLM on) ────────────────────────────────────────────────────

describe('cofl: harvest phase — LLM available', () => {
  it('calls _callLLM and parses patterns when LLM is available', async () => {
    let llmCalled = false;
    const mockLLMResponse = JSON.stringify([{
      sourceCompetitor: 'Aider',
      description: 'Diff preview before file write',
      category: 'ux_loop',
      patternTruth: 'Aider shows diffs pre-apply',
      affectedDimensions: ['ux_polish'],
      operatorOutcome: 'User sees changes before they happen',
      operatorLeverageScore: 7,
      proofRequirement: 'Screencast of diff display in < 3 keystrokes',
      estimatedLift: 0.4,
      implementationScope: 'narrow',
    }]);
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async (_p: string) => { llmCalled = true; return mockLLMResponse; },
    });
    const result = await cofl({ harvest: true }, opts) as CoflCycleResult;
    assert.ok(llmCalled, '_callLLM should be called when LLM is available');
    assert.ok(result.extractedPatterns.length > 0, 'patterns should be extracted');
    assert.strictEqual(result.extractedPatterns[0]!.sourceCompetitor, 'Aider');
  });

  it('applies decision filter and drops patterns with broad scope', async () => {
    const mockBroadPattern = JSON.stringify([{
      sourceCompetitor: 'Aider',
      description: 'Full architectural rewrite of CLI layer',
      category: 'product_behavior',
      patternTruth: 'Aider rewrites CLI',
      affectedDimensions: ['ux_polish'],
      operatorOutcome: 'Better UX',
      operatorLeverageScore: 8,
      proofRequirement: 'Very specific screencast',
      estimatedLift: 0.8,
      implementationScope: 'broad',  // will be filtered
    }]);
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => mockBroadPattern,
    });
    const result = await cofl({ harvest: true }, opts) as CoflCycleResult;
    assert.strictEqual(result.extractedPatterns.length, 0,
      'broad-scope patterns should be filtered by decision rule');
  });

  it('gracefully handles malformed LLM JSON response', async () => {
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => 'NOT VALID JSON {{{',
    });
    await assert.doesNotReject(
      () => cofl({ harvest: true }, opts),
      'should not throw on malformed LLM response',
    );
  });
});

// ── Prioritize phase ──────────────────────────────────────────────────────────

describe('cofl: prioritize phase', () => {
  it('computes operator leverage entries for each matrix dimension', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ prioritize: true }, opts) as CoflCycleResult;
    assert.strictEqual(result.operatorLeverage.length, 2, 'one entry per matrix dimension');
    assert.ok(result.operatorLeverage.every(e => typeof e.leverageScore === 'number'));
  });

  it('marks ux_polish as OSS-borrowable since oss_leader is Aider (reference_teacher)', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ prioritize: true }, opts) as CoflCycleResult;
    const ux = result.operatorLeverage.find(e => e.dimensionId === 'ux_polish');
    assert.ok(ux, 'should have ux_polish entry');
    assert.strictEqual(ux!.borrowableFromOSS, true, 'ux_polish oss_leader is Aider (reference teacher)');
  });
});

// ── Anti-failure guards ───────────────────────────────────────────────────────

describe('cofl: anti-failure guards', () => {
  it('--guards mode returns 7 checks', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ guards: true }, opts) as CoflCycleResult;
    assert.strictEqual(result.antiFailureChecks.length, 7);
  });

  it('flags empty registry partition as "Forgetting past competitors"', async () => {
    const opts = makeBaseOpts({
      _loadRegistry: async () => ({
        ...makeEmptyRegistry(),
        partition: { directPeers: [], specialistTeachers: [], referenceTeachers: [] },
      }),
    });
    const result = await cofl({ guards: true }, opts) as CoflCycleResult;
    const guard = result.antiFailureChecks.find(
      c => c.failureMode === 'Forgetting past competitors',
    );
    assert.strictEqual(guard!.passed, false);
  });
});

// ── Reframe phase ─────────────────────────────────────────────────────────────

describe('cofl: reframe phase', () => {
  it('returns a reframe assessment with a recommendation', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ reframe: true }, opts) as CoflCycleResult;
    assert.ok(result.reframe.recommendation.length > 0);
    assert.strictEqual(typeof result.reframe.objectiveFunctionValue, 'number');
  });
});

// ── Report generation ─────────────────────────────────────────────────────────

describe('cofl: report generation', () => {
  it('writes COFL_REPORT.md when --report is used', async () => {
    const opts = makeBaseOpts();
    await cofl({ report: true }, opts);
    const reportFiles = opts.writtenFiles.filter(([p]) => p.includes('COFL_REPORT'));
    assert.ok(reportFiles.length > 0, 'COFL_REPORT.md should be written');
  });

  it('COFL_REPORT.md contains partition and leverage sections', async () => {
    const opts = makeBaseOpts();
    await cofl({ report: true }, opts);
    const [, content] = opts.writtenFiles.find(([p]) => p.includes('COFL_REPORT')) ?? ['', ''];
    assert.ok(content.includes('Universe Partition'), 'report should include partition section');
    assert.ok(content.includes('Operator Leverage'), 'report should include leverage section');
  });
});

// ── Registry persistence ──────────────────────────────────────────────────────

describe('cofl: registry persistence', () => {
  it('saves registry with incremented cyclesRun', async () => {
    const opts = makeBaseOpts({
      _loadRegistry: async () => ({ ...makeEmptyRegistry(), cyclesRun: 3 }),
    });
    await cofl({ universe: true }, opts);
    assert.ok(opts.savedRegistries.length > 0, 'registry should be saved');
    assert.strictEqual(opts.savedRegistries[0]!.cyclesRun, 4, 'cyclesRun should be 4');
  });

  it('preserves existing patterns in registry across cycles', async () => {
    const existingPattern = {
      id: 'cofl-existing-001',
      sourceCompetitor: 'Aider',
      sourceRole: 'reference_teacher' as const,
      description: 'existing pattern',
      category: 'ux_loop' as const,
      truth: { patternTruth: 'test' },
      affectedDimensions: ['ux_polish'],
      operatorOutcome: 'test',
      operatorLeverageScore: 5,
      proofRequirement: 'screencast',
      estimatedLift: 0.3,
      implementationScope: 'narrow' as const,
      status: 'extracted' as const,
      extractedAt: '2026-04-21T00:00:00Z',
    };
    const opts = makeBaseOpts({
      _loadRegistry: async () => ({ ...makeEmptyRegistry(), patterns: [existingPattern] }),
    });
    await cofl({ universe: true }, opts);
    const saved = opts.savedRegistries[0];
    assert.ok(saved?.patterns.some(p => p.id === 'cofl-existing-001'),
      'existing patterns should be preserved in registry');
  });
});

// ── Auto mode ────────────────────────────────────────────────────────────────

describe('cofl: auto mode', () => {
  it('returns a CoflCycleResult with all required fields in --auto mode', async () => {
    const opts = makeBaseOpts();
    const result = await cofl({ auto: true }, opts) as CoflCycleResult;
    assert.ok(result, 'should return a result');
    assert.ok(Array.isArray(result.antiFailureChecks));
    assert.ok(Array.isArray(result.operatorLeverage));
    assert.ok(Array.isArray(result.extractedPatterns));
    assert.strictEqual(typeof result.reframe.recommendation, 'string');
  });

  it('saves state and registry in --auto mode', async () => {
    const opts = makeBaseOpts();
    await cofl({ auto: true }, opts);
    assert.ok(opts.saved.length > 0, 'state should be saved');
    assert.ok(opts.savedRegistries.length > 0, 'registry should be saved');
  });
});
