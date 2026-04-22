// cofl-engine.test.ts — pure-function tests for the Competitive Operator Forge Loop engine
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCompetitorRoles,
  scoreOperatorLeverage,
  runDecisionFilter,
  runAntiFailureGuards,
  runReframePhase,
  computeObjectiveFunction,
  persistCycleLearnings,
  generatePatternId,
  renderPartitionTable,
  renderLeverageTable,
  renderAntiFailureReport,
  renderReframe,
  type CoflPattern,
  type UniversePartition,
  type CoflRegistry,
  type CoflCycleResult,
} from '../src/core/cofl-engine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePattern(overrides: Partial<CoflPattern> = {}): CoflPattern {
  return {
    id: 'cofl-test-0001',
    sourceCompetitor: 'Aider',
    sourceRole: 'reference_teacher',
    description: 'Interactive commit loop that shows diff before apply',
    category: 'ux_loop',
    truth: { patternTruth: 'Aider shows diffs before writing files' },
    affectedDimensions: ['ux_polish'],
    operatorOutcome: 'Operator sees changes before they happen',
    operatorLeverageScore: 7,
    proofRequirement: 'Record screencast showing diff preview in <3 keystrokes',
    estimatedLift: 0.4,
    implementationScope: 'narrow',
    status: 'extracted',
    extractedAt: '2026-04-21T00:00:00Z',
    ...overrides,
  };
}

function makeRegistry(overrides: Partial<CoflRegistry> = {}): CoflRegistry {
  return {
    version: '1.0.0',
    cyclesRun: 0,
    partition: {
      directPeers: ['Cursor', 'Devin'],
      specialistTeachers: ['CodiumAI'],
      referenceTeachers: ['Aider', 'Continue'],
    },
    patterns: [],
    lessons: [],
    gapMap: {},
    strategyNotes: [],
    lastCycleAt: '',
    updatedAt: '2026-04-21T00:00:00Z',
    ...overrides,
  };
}

function makeDimension(overrides: Partial<{
  id: string; label: string; gap_to_closed_source_leader: number;
  gap_to_oss_leader: number; oss_leader: string; weight: number; frequency: string;
}> = {}) {
  return {
    id: 'ux_polish',
    label: 'UX Polish',
    gap_to_closed_source_leader: 3.5,
    gap_to_oss_leader: 1.5,
    oss_leader: 'Aider',
    weight: 1.2,
    frequency: 'high',
    ...overrides,
  };
}

// ── classifyCompetitorRoles ───────────────────────────────────────────────────

describe('classifyCompetitorRoles', () => {
  it('puts closed-source tools in directPeers', () => {
    const result = classifyCompetitorRoles(['Cursor', 'Devin'], []);
    assert.deepStrictEqual(result.directPeers, ['Cursor', 'Devin']);
    assert.deepStrictEqual(result.referenceTeachers, []);
    assert.deepStrictEqual(result.specialistTeachers, []);
  });

  it('puts known OSS tools in referenceTeachers', () => {
    const result = classifyCompetitorRoles([], ['Aider', 'Continue', 'MetaGPT']);
    assert.deepStrictEqual(result.referenceTeachers, ['Aider', 'Continue', 'MetaGPT']);
    assert.deepStrictEqual(result.directPeers, []);
  });

  it('puts specialist tools (CodiumAI, CodeRabbit) in specialistTeachers', () => {
    const result = classifyCompetitorRoles([], ['CodiumAI', 'CodeRabbit', 'Swimm']);
    assert.deepStrictEqual(result.specialistTeachers, ['CodiumAI', 'CodeRabbit', 'Swimm']);
    assert.deepStrictEqual(result.referenceTeachers, []);
  });

  it('handles mixed OSS list correctly', () => {
    const result = classifyCompetitorRoles(['Cursor'], ['Aider', 'CodiumAI', 'Plandex']);
    assert.ok(result.directPeers.includes('Cursor'));
    assert.ok(result.referenceTeachers.includes('Aider'));
    assert.ok(result.specialistTeachers.includes('CodiumAI'));
    assert.ok(result.referenceTeachers.includes('Plandex'));
  });

  it('returns empty partition when both lists are empty', () => {
    const result = classifyCompetitorRoles([], []);
    assert.strictEqual(result.directPeers.length, 0);
    assert.strictEqual(result.specialistTeachers.length, 0);
    assert.strictEqual(result.referenceTeachers.length, 0);
  });
});

// ── scoreOperatorLeverage ────────────────────────────────────────────────────

describe('scoreOperatorLeverage', () => {
  const partition: UniversePartition = {
    directPeers: ['Cursor'],
    specialistTeachers: ['CodiumAI'],
    referenceTeachers: ['Aider'],
  };

  it('returns one entry per dimension', () => {
    const dims = [makeDimension(), makeDimension({ id: 'testing', label: 'Testing' })];
    const result = scoreOperatorLeverage(dims, partition);
    assert.strictEqual(result.length, 2);
  });

  it('marks dimension as OSS-borrowable when oss_leader is in teacher set', () => {
    const dim = makeDimension({ oss_leader: 'Aider' });
    const [entry] = scoreOperatorLeverage([dim], partition);
    assert.ok(entry!.borrowableFromOSS, 'Aider is a reference_teacher');
  });

  it('does NOT mark as OSS-borrowable when oss_leader is a direct peer', () => {
    const dim = makeDimension({ oss_leader: 'Cursor' });
    const [entry] = scoreOperatorLeverage([dim], partition);
    assert.strictEqual(entry!.borrowableFromOSS, false);
  });

  it('produces higher leverageScore for high-frequency high-gap dimensions', () => {
    const highFreq = makeDimension({ frequency: 'high', gap_to_closed_source_leader: 5 });
    const lowFreq = makeDimension({ frequency: 'low', gap_to_closed_source_leader: 5 });
    const [high] = scoreOperatorLeverage([highFreq], partition);
    const [low] = scoreOperatorLeverage([lowFreq], partition);
    assert.ok(high!.leverageScore > low!.leverageScore,
      'high-frequency dimension should have higher leverage');
  });

  it('scores leverage >= 0 for all entries', () => {
    const dims = [
      makeDimension({ gap_to_closed_source_leader: 0, gap_to_oss_leader: 0, frequency: 'low' }),
    ];
    const [entry] = scoreOperatorLeverage(dims, partition);
    assert.ok(entry!.leverageScore >= 0, 'leverage should never be negative');
  });
});

// ── runDecisionFilter ─────────────────────────────────────────────────────────

describe('runDecisionFilter', () => {
  const goodPattern = makePattern();
  const context = {
    validTeacherRoles: ['reference_teacher' as const, 'specialist_teacher' as const],
    knownGapDimensions: ['ux_polish'],
    minOperatorLeverage: 3,
  };

  it('passes a well-formed pattern through all 5 checks', () => {
    const result = runDecisionFilter(goodPattern, context);
    assert.strictEqual(result.passedAll, true);
    assert.strictEqual(result.checks.length, 5);
  });

  it('fails when source role is not in validTeacherRoles', () => {
    const badRole = makePattern({ sourceRole: 'direct_peer' as const });
    const result = runDecisionFilter(badRole, context);
    assert.strictEqual(result.passedAll, false);
    const q = result.checks.find(c => c.question.includes('actually want to learn from'));
    assert.strictEqual(q!.passed, false);
  });

  it('fails when operatorLeverageScore is below threshold', () => {
    const lowLeverage = makePattern({ operatorLeverageScore: 1 });
    const result = runDecisionFilter(lowLeverage, context);
    assert.strictEqual(result.passedAll, false);
    const q = result.checks.find(c => c.question.includes('operator preference'));
    assert.strictEqual(q!.passed, false);
  });

  it('fails when no affected dimension overlaps known gaps', () => {
    const wrongDim = makePattern({ affectedDimensions: ['unknown_dimension'] });
    const result = runDecisionFilter(wrongDim, context);
    assert.strictEqual(result.passedAll, false);
    const q = result.checks.find(c => c.question.includes('real Dante gap'));
    assert.strictEqual(q!.passed, false);
  });

  it('fails when implementationScope is broad (cargo-cult risk)', () => {
    const broad = makePattern({ implementationScope: 'broad' });
    const result = runDecisionFilter(broad, context);
    assert.strictEqual(result.passedAll, false);
    const q = result.checks.find(c => c.question.includes('identity'));
    assert.strictEqual(q!.passed, false);
  });

  it('returns exactly 5 checks regardless of pass/fail', () => {
    const result = runDecisionFilter(makePattern({ operatorLeverageScore: 0 }), context);
    assert.strictEqual(result.checks.length, 5);
  });
});

// ── runAntiFailureGuards ──────────────────────────────────────────────────────

describe('runAntiFailureGuards', () => {
  it('returns 7 checks (one per codified failure mode)', () => {
    const checks = runAntiFailureGuards([], [], makeRegistry());
    assert.strictEqual(checks.length, 7);
  });

  it('passes all guards with a healthy registry and no patterns', () => {
    const registry = makeRegistry();
    const dims = [{ id: 'ux_polish', scores: { self: 5 } }];
    const checks = runAntiFailureGuards([], dims, registry);
    const failed = checks.filter(c => !c.passed);
    assert.strictEqual(failed.length, 0, `unexpected failures: ${failed.map(f => f.failureMode).join(', ')}`);
  });

  it('flags "Harvesting patterns without shipping them" when pattern is unmapped', () => {
    const unmappedPattern = makePattern({ affectedDimensions: [], status: 'extracted' });
    const checks = runAntiFailureGuards([unmappedPattern], [], makeRegistry());
    const guard = checks.find(c => c.failureMode === 'Harvesting patterns without shipping them');
    assert.strictEqual(guard!.passed, false);
    assert.ok(guard!.violation?.includes('not mapped'));
  });

  it('flags "Forgetting past competitors" when registry has < 3 classified competitors', () => {
    const thinRegistry = makeRegistry({
      partition: { directPeers: [], specialistTeachers: [], referenceTeachers: ['Aider'] },
    });
    const checks = runAntiFailureGuards([], [], thinRegistry);
    const guard = checks.find(c => c.failureMode === 'Forgetting past competitors');
    assert.strictEqual(guard!.passed, false);
  });

  it('flags "Cargo-culting OSS tools" when 3+ broad-scope patterns are unverified', () => {
    const broadPatterns = [
      makePattern({ implementationScope: 'broad', status: 'extracted' }),
      makePattern({ implementationScope: 'broad', status: 'extracted', id: 'cofl-b2' }),
      makePattern({ implementationScope: 'broad', status: 'extracted', id: 'cofl-b3' }),
    ];
    const checks = runAntiFailureGuards(broadPatterns, [], makeRegistry());
    const guard = checks.find(c => c.failureMode === 'Cargo-culting OSS tools');
    assert.strictEqual(guard!.passed, false);
  });

  it('flags "Improving rows without improving preference" when patterns have 0 leverage', () => {
    const noLeverage = makePattern({ operatorLeverageScore: 0, status: 'extracted' });
    const checks = runAntiFailureGuards([noLeverage], [], makeRegistry());
    const guard = checks.find(c => c.failureMode === 'Improving rows without improving preference');
    assert.strictEqual(guard!.passed, false);
  });
});

// ── runReframePhase ───────────────────────────────────────────────────────────

describe('runReframePhase', () => {
  it('detects preference gain when afterScore > beforeScore', () => {
    const result = runReframePhase(6.0, 7.5, 1, [], 3.0, 2.0);
    assert.strictEqual(result.becomeMorePreferred, true);
    assert.ok(result.preferenceGainDelta > 0);
  });

  it('detects inflation (score up but closed-source gap not closing)', () => {
    const result = runReframePhase(6.0, 7.0, 1, [], 3.0, 3.0);
    assert.strictEqual(result.onlyInflatingRows, true);
  });

  it('does NOT flag inflation when gap is also closing', () => {
    const result = runReframePhase(6.0, 7.0, 1, [], 3.0, 1.5);
    assert.strictEqual(result.onlyInflatingRows, false);
  });

  it('reports coherence when 2+ dimensions have high operator lift', () => {
    const leverages = [
      { dimensionId: 'ux', dimensionLabel: 'UX', gapToClosedSourceLeader: 3, gapToOSSLeader: 1,
        borrowableFromOSS: true, operatorVisibleLift: 7, implementationCost: 3, proofable: true, leverageScore: 6 },
      { dimensionId: 'testing', dimensionLabel: 'Testing', gapToClosedSourceLeader: 2, gapToOSSLeader: 1,
        borrowableFromOSS: false, operatorVisibleLift: 5, implementationCost: 2, proofable: true, leverageScore: 4 },
    ];
    const result = runReframePhase(6.0, 6.0, 1, leverages, 3.0, 3.0);
    assert.strictEqual(result.becomeMoreCoherent, true);
  });

  it('always returns a non-empty recommendation string', () => {
    const result = runReframePhase(0, 0, 0, [], 0, 0);
    assert.ok(result.recommendation.length > 10);
  });
});

// ── computeObjectiveFunction ──────────────────────────────────────────────────

describe('computeObjectiveFunction', () => {
  it('returns 0 for all fields when inputs are empty', () => {
    const obj = computeObjectiveFunction([], [], 0);
    assert.strictEqual(obj.operator_preference_gain, 0);
    assert.strictEqual(obj.closed_source_gap_reduction, 0);
    assert.strictEqual(obj.preserved_governance_moat, 0);
    assert.strictEqual(obj.reusable_product_patterns, 0);
  });

  it('counts verified patterns as reusable', () => {
    const patterns = [
      makePattern({ status: 'verified' }),
      makePattern({ id: 'cofl-p2', status: 'forged' }),
      makePattern({ id: 'cofl-p3', status: 'extracted' }),
    ];
    const obj = computeObjectiveFunction([], patterns, 0);
    assert.strictEqual(obj.reusable_product_patterns, 2, 'only verified + forged count');
  });

  it('does not allow closed_source_gap_reduction to be negative', () => {
    const obj = computeObjectiveFunction([], [], -5);
    assert.strictEqual(obj.closed_source_gap_reduction, 0);
  });
});

// ── persistCycleLearnings ─────────────────────────────────────────────────────

describe('persistCycleLearnings', () => {
  function makeCycleResult(patterns: CoflPattern[] = []): CoflCycleResult {
    return {
      cycleNumber: 1,
      completedAt: '2026-04-21T00:00:00Z',
      partition: { directPeers: ['Cursor'], specialistTeachers: [], referenceTeachers: ['Aider'] },
      extractedPatterns: patterns,
      operatorLeverage: [],
      antiFailureChecks: [],
      reframe: {
        becomeMorePreferred: true, becomeMoreCoherent: true, onlyInflatingRows: false,
        preferenceGainDelta: 1, coherenceDelta: 1, objectiveFunctionValue: 3,
        recommendation: 'Good cycle',
      },
      persistedAt: '2026-04-21T00:00:00Z',
      objectiveFunction: {
        operator_preference_gain: 1, closed_source_gap_reduction: 0.5,
        preserved_governance_moat: 0, reusable_product_patterns: 0,
      },
    };
  }

  it('increments cyclesRun by 1', () => {
    const registry = makeRegistry({ cyclesRun: 3 });
    const result = persistCycleLearnings(makeCycleResult(), registry);
    assert.strictEqual(result.cyclesRun, 4);
  });

  it('appends new patterns to the registry', () => {
    const registry = makeRegistry();
    const pattern = makePattern({ id: 'cofl-new-0001' });
    const result = persistCycleLearnings(makeCycleResult([pattern]), registry);
    assert.strictEqual(result.patterns.length, 1);
    assert.strictEqual(result.patterns[0]!.id, 'cofl-new-0001');
  });

  it('does NOT duplicate patterns with same id', () => {
    const pattern = makePattern({ id: 'cofl-dup-0001' });
    const registry = makeRegistry({ patterns: [pattern] });
    const result = persistCycleLearnings(makeCycleResult([pattern]), registry);
    assert.strictEqual(result.patterns.filter(p => p.id === 'cofl-dup-0001').length, 1);
  });

  it('updates gap map for each pattern\'s affected dimensions', () => {
    const pattern = makePattern({ id: 'cofl-g-0001', affectedDimensions: ['ux_polish', 'testing'] });
    const result = persistCycleLearnings(makeCycleResult([pattern]), makeRegistry());
    assert.ok(result.gapMap['ux_polish']?.includes('cofl-g-0001'));
    assert.ok(result.gapMap['testing']?.includes('cofl-g-0001'));
  });

  it('updates lastCycleAt to the cycle completedAt', () => {
    const result = persistCycleLearnings(makeCycleResult(), makeRegistry());
    assert.strictEqual(result.lastCycleAt, '2026-04-21T00:00:00Z');
  });
});

// ── generatePatternId ─────────────────────────────────────────────────────────

describe('generatePatternId', () => {
  it('starts with "cofl-"', () => {
    const id = generatePatternId('Aider', 'diff preview before apply');
    assert.ok(id.startsWith('cofl-'), `expected "cofl-" prefix, got: ${id}`);
  });

  it('produces unique IDs for the same inputs', () => {
    const id1 = generatePatternId('Aider', 'same description');
    const id2 = generatePatternId('Aider', 'same description');
    assert.notStrictEqual(id1, id2, 'IDs should be unique due to random suffix');
  });

  it('handles special characters in inputs without crashing', () => {
    const id = generatePatternId('Tool (v2)', 'Pattern with "quotes" & symbols!');
    assert.ok(id.startsWith('cofl-'));
    assert.ok(/^[a-z0-9-]+$/.test(id), `ID should only contain lowercase alphanumerics and dashes: ${id}`);
  });
});

// ── Rendering helpers ─────────────────────────────────────────────────────────

describe('renderPartitionTable', () => {
  it('includes all three role labels', () => {
    const partition: UniversePartition = {
      directPeers: ['Cursor'],
      specialistTeachers: ['CodiumAI'],
      referenceTeachers: ['Aider'],
    };
    const output = renderPartitionTable(partition);
    assert.ok(output.includes('Direct Peers'));
    assert.ok(output.includes('Specialist Teachers'));
    assert.ok(output.includes('Reference Teachers'));
    assert.ok(output.includes('Cursor'));
    assert.ok(output.includes('CodiumAI'));
    assert.ok(output.includes('Aider'));
  });

  it('shows "none" when a role list is empty', () => {
    const partition: UniversePartition = {
      directPeers: [],
      specialistTeachers: [],
      referenceTeachers: [],
    };
    const output = renderPartitionTable(partition);
    assert.ok(output.includes('none'));
  });
});

describe('renderLeverageTable', () => {
  it('returns fallback message when entries list is empty', () => {
    const output = renderLeverageTable([]);
    assert.ok(output.includes('No leverage entries'));
  });

  it('renders header row and at least one data row', () => {
    const entries = [{
      dimensionId: 'ux_polish', dimensionLabel: 'UX Polish',
      gapToClosedSourceLeader: 3.5, gapToOSSLeader: 1.5, borrowableFromOSS: true,
      operatorVisibleLift: 7, implementationCost: 3, proofable: true, leverageScore: 6.5,
    }];
    const output = renderLeverageTable(entries);
    assert.ok(output.includes('Operator Leverage Rankings'));
    assert.ok(output.includes('UX Polish'));
    assert.ok(output.includes('6.50'));
  });
});

describe('renderAntiFailureReport', () => {
  it('shows all-clear message when all guards pass', () => {
    const checks = [{ failureMode: 'test', guardrail: 'ok', passed: true }];
    const output = renderAntiFailureReport(checks);
    assert.ok(output.includes('guardrails passed'));
  });

  it('lists violation when a guard fails', () => {
    const checks = [{
      failureMode: 'Drifting to coding-agent comparisons',
      guardrail: 'Must preserve operator peers',
      passed: false,
      violation: 'No direct peers in registry',
    }];
    const output = renderAntiFailureReport(checks);
    assert.ok(output.includes('No direct peers'));
    assert.ok(output.includes('violated'));
  });
});

describe('renderReframe', () => {
  it('includes preferred/coherent/inflation status', () => {
    const reframe = {
      becomeMorePreferred: true, becomeMoreCoherent: false, onlyInflatingRows: true,
      preferenceGainDelta: 0.5, coherenceDelta: -0.5, objectiveFunctionValue: 1.2,
      recommendation: 'Focus on operator-visible gaps',
    };
    const output = renderReframe(reframe);
    assert.ok(output.includes('✓ Yes'));
    assert.ok(output.includes('✗ No'));
    assert.ok(output.includes('⚠ Yes'));
    assert.ok(output.includes('Focus on operator-visible gaps'));
  });
});
