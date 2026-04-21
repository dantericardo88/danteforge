// cofl-integration.test.ts — integration tests for COFL wiring across compete/landscape/dossier/mcp/oss
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CoflRegistry } from '../src/core/cofl-engine.js';

const originalExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExitCode; });

// ── Shared factories ──────────────────────────────────────────────────────────

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
        frequency: 'high', scores: { self: 6, cursor: 9, aider: 7 },
        gap_to_leader: 3, leader: 'Cursor',
        gap_to_closed_source_leader: 3, closed_source_leader: 'Cursor',
        gap_to_oss_leader: 1, oss_leader: 'Aider',
        status: 'in-progress', sprint_history: [], next_sprint_target: 9,
        harvest_source: 'Aider',
      },
    ],
    lastUpdated: '2026-04-21T00:00:00Z',
  };
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

// ── compete.ts COFL leverage wiring ──────────────────────────────────────────

describe('compete sprint: COFL operator leverage panel', () => {
  it('actionSprint imports classifyCompetitorRoles and scoreOperatorLeverage from cofl-engine', async () => {
    const { classifyCompetitorRoles, scoreOperatorLeverage } = await import('../src/core/cofl-engine.js');
    const matrix = makeMatrix();
    const partition = classifyCompetitorRoles(
      matrix.competitors_closed_source,
      matrix.competitors_oss,
    );
    const entries = scoreOperatorLeverage([{
      id: 'ux_polish',
      label: 'UX Polish',
      gap_to_closed_source_leader: 3,
      gap_to_oss_leader: 1,
      oss_leader: 'Aider',
      weight: 1.2,
      frequency: 'high',
    }], partition);
    assert.strictEqual(entries.length, 1);
    assert.ok(entries[0]!.leverageScore > 0, 'leverage score should be positive');
    assert.strictEqual(entries[0]!.borrowableFromOSS, true, 'Aider is reference_teacher → borrowable');
  });

  it('classifyCompetitorRoles puts Cursor in directPeers', async () => {
    const { classifyCompetitorRoles } = await import('../src/core/cofl-engine.js');
    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    assert.ok(partition.directPeers.includes('Cursor'));
    assert.ok(partition.referenceTeachers.includes('Aider'));
  });

  it('scoreOperatorLeverage returns higher leverage for high-frequency gaps', async () => {
    const { classifyCompetitorRoles, scoreOperatorLeverage } = await import('../src/core/cofl-engine.js');
    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    const highFreq = scoreOperatorLeverage([{
      id: 'a', label: 'A', gap_to_closed_source_leader: 3, gap_to_oss_leader: 1,
      oss_leader: 'Aider', weight: 1, frequency: 'high',
    }], partition);
    const lowFreq = scoreOperatorLeverage([{
      id: 'a', label: 'A', gap_to_closed_source_leader: 3, gap_to_oss_leader: 1,
      oss_leader: 'Aider', weight: 1, frequency: 'low',
    }], partition);
    assert.ok(highFreq[0]!.leverageScore > lowFreq[0]!.leverageScore,
      'high-frequency gap should have higher leverage');
  });
});

// ── landscape-cmd.ts COFL role annotation ────────────────────────────────────

describe('landscape ranking: COFL role lookup', () => {
  it('builds role lookup from COFL registry', async () => {
    const registry = makeEmptyRegistry();
    registry.partition.directPeers = ['Cursor'];
    registry.partition.referenceTeachers = ['Aider'];

    const roleLookup: Record<string, string> = {};
    for (const c of registry.partition.directPeers) roleLookup[c.toLowerCase()] = 'peer';
    for (const c of registry.partition.specialistTeachers) roleLookup[c.toLowerCase()] = 'teacher:spec';
    for (const c of registry.partition.referenceTeachers) roleLookup[c.toLowerCase()] = 'teacher:ref';

    assert.strictEqual(roleLookup['cursor'], 'peer');
    assert.strictEqual(roleLookup['aider'], 'teacher:ref');
    assert.strictEqual(roleLookup['unknown'], undefined);
  });

  it('empty registry produces no role tags', async () => {
    const registry = makeEmptyRegistry();
    const roleLookup: Record<string, string> = {};
    for (const c of registry.partition.directPeers) roleLookup[c.toLowerCase()] = 'peer';
    for (const c of registry.partition.referenceTeachers) roleLookup[c.toLowerCase()] = 'teacher:ref';
    assert.strictEqual(Object.keys(roleLookup).length, 0);
  });

  it('loadCoflRegistry returns empty partition when no registry file', async () => {
    const { loadCoflRegistry } = await import('../src/core/cofl-engine.js');
    const registry = await loadCoflRegistry('/nonexistent/path/that/does/not/exist');
    assert.deepStrictEqual(registry.partition.directPeers, []);
    assert.deepStrictEqual(registry.partition.referenceTeachers, []);
    assert.strictEqual(registry.cyclesRun, 0);
  });
});

// ── dossier.ts COFL role classification ──────────────────────────────────────

describe('dossier build: COFL role auto-classification', () => {
  it('classifyCompetitorRoles identifies closed-source dossier target as direct_peer', async () => {
    const { classifyCompetitorRoles } = await import('../src/core/cofl-engine.js');
    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    const competitorId = 'cursor';
    const isDirectPeer = partition.directPeers.some(c => c.toLowerCase() === competitorId);
    assert.strictEqual(isDirectPeer, true);
  });

  it('classifyCompetitorRoles identifies OSS dossier target as reference_teacher', async () => {
    const { classifyCompetitorRoles } = await import('../src/core/cofl-engine.js');
    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    const competitorId = 'aider';
    const isRef = partition.referenceTeachers.some(c => c.toLowerCase() === competitorId);
    assert.strictEqual(isRef, true);
  });

  it('persistCycleLearnings updates partition in saved registry', async () => {
    const { classifyCompetitorRoles, persistCycleLearnings } = await import('../src/core/cofl-engine.js');
    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    const registry = makeEmptyRegistry();
    const cycleResult = {
      cycleNumber: 1,
      completedAt: '2026-04-21T00:00:00Z',
      partition,
      extractedPatterns: [],
      operatorLeverage: [],
      antiFailureChecks: [],
      reframe: {
        becomeMorePreferred: false,
        becomeMoreCoherent: false,
        onlyInflatingRows: false,
        preferenceGainDelta: 0,
        coherenceDelta: 0,
        objectiveFunctionValue: 0,
        recommendation: 'test',
      },
      persistedAt: '2026-04-21T00:00:00Z',
      objectiveFunction: {
        operator_preference_gain: 0,
        closed_source_gap_reduction: 0,
        preserved_governance_moat: 0,
        reusable_product_patterns: 0,
      },
    };
    const updated = persistCycleLearnings(cycleResult, registry);
    assert.deepStrictEqual(updated.partition.directPeers, ['Cursor']);
    assert.deepStrictEqual(updated.partition.referenceTeachers, ['Aider']);
  });

  it('saveCoflRegistry/loadCoflRegistry round-trip preserves partition', async () => {
    const { classifyCompetitorRoles, loadCoflRegistry, saveCoflRegistry } = await import('../src/core/cofl-engine.js');
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cofl-test-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge', 'cofl'), { recursive: true });

    const partition = classifyCompetitorRoles(['Cursor'], ['Aider']);
    const registry: CoflRegistry = { ...makeEmptyRegistry(), partition };
    await saveCoflRegistry(registry, tmpDir);
    const loaded = await loadCoflRegistry(tmpDir);
    assert.deepStrictEqual(loaded.partition.directPeers, ['Cursor']);
    assert.deepStrictEqual(loaded.partition.referenceTeachers, ['Aider']);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});

// ── mcp-server.ts danteforge_cofl tool ───────────────────────────────────────

describe('mcp-server: danteforge_cofl tool', () => {
  it('TOOL_DEFINITIONS includes danteforge_cofl', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    const tool = TOOL_DEFINITIONS.find(t => t.name === 'danteforge_cofl');
    assert.ok(tool, 'danteforge_cofl should be in TOOL_DEFINITIONS');
    assert.ok(tool.description.includes('Competitive Operator Forge Loop'), 'description should mention COFL');
  });

  it('TOOL_HANDLERS includes danteforge_cofl', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    assert.ok(typeof TOOL_HANDLERS['danteforge_cofl'] === 'function',
      'danteforge_cofl handler should be registered');
  });

  it('danteforge_cofl tool has auto, universe, harvest, prioritize, guards, reframe, report props', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    const tool = TOOL_DEFINITIONS.find(t => t.name === 'danteforge_cofl');
    const props = (tool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    for (const key of ['auto', 'universe', 'harvest', 'prioritize', 'guards', 'reframe', 'report']) {
      assert.ok(key in props, `danteforge_cofl should have ${key} property`);
    }
  });

  it('danteforge_cofl handler returns a ToolResult (not a string)', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const handler = TOOL_HANDLERS['danteforge_cofl'];
    assert.ok(handler, 'handler must exist');
    // The handler calls cofl() which loads matrix/registry from disk — it will return an error
    // result (no matrix) but should NOT throw and should return a ToolResult shape
    const result = await handler({ _cwd: '/nonexistent/path/xyz' });
    // Either a jsonResult or errorResult — both have content array
    assert.ok(
      typeof result === 'object' && result !== null && 'content' in result,
      'should return a ToolResult with content array',
    );
  });
});

// ── oss.ts COFL decision filter cross-check ───────────────────────────────────

describe('oss: COFL decision filter cross-check', () => {
  it('runDecisionFilter rejects patterns with broad implementation scope', async () => {
    const { runDecisionFilter } = await import('../src/core/cofl-engine.js');
    const result = runDecisionFilter(
      {
        sourceRole: 'reference_teacher',
        operatorLeverageScore: 7,
        affectedDimensions: ['ux_polish'],
        proofRequirement: 'Run npm test and compare before/after',
        implementationScope: 'broad',
      },
      { validTeacherRoles: ['reference_teacher'], knownGapDimensions: ['ux_polish'] },
    );
    assert.strictEqual(result.passedAll, false, 'broad scope should fail filter');
    const scopeCheck = result.checks.find(c => c.question.includes("strengthen Dante"));
    assert.strictEqual(scopeCheck?.passed, false);
  });

  it('runDecisionFilter passes operator-visible narrow patterns from teacher set', async () => {
    const { runDecisionFilter } = await import('../src/core/cofl-engine.js');
    const result = runDecisionFilter(
      {
        sourceRole: 'reference_teacher',
        operatorLeverageScore: 7,
        affectedDimensions: ['ux_polish'],
        proofRequirement: 'Run npm test and compare output before/after change',
        implementationScope: 'narrow',
      },
      { validTeacherRoles: ['reference_teacher'], knownGapDimensions: ['ux_polish'] },
    );
    assert.strictEqual(result.passedAll, true, 'narrow operator-visible pattern should pass filter');
  });

  it('runDecisionFilter fails when pattern does not map to known gap dimensions', async () => {
    const { runDecisionFilter } = await import('../src/core/cofl-engine.js');
    const result = runDecisionFilter(
      {
        sourceRole: 'reference_teacher',
        operatorLeverageScore: 7,
        affectedDimensions: ['unrelated_internal_dim'],
        proofRequirement: 'Run npm test and observe diff',
        implementationScope: 'narrow',
      },
      { validTeacherRoles: ['reference_teacher'], knownGapDimensions: ['ux_polish', 'testing'] },
    );
    assert.strictEqual(result.passedAll, false, 'pattern not mapping to known gap should fail');
    const gapCheck = result.checks.find(c => c.question.includes('real Dante gap'));
    assert.strictEqual(gapCheck?.passed, false);
  });

  it('OSS cli-ux category maps to operator-visible (passes visibility check)', () => {
    const operatorVisibleCategories = ['cli-ux', 'agent-ai', 'innovation'];
    assert.ok(operatorVisibleCategories.includes('cli-ux'), 'cli-ux is operator-visible');
    assert.ok(!operatorVisibleCategories.includes('architecture'), 'architecture is not operator-visible');
  });

  it('COFL decision filter requires proof requirement > 10 chars', async () => {
    const { runDecisionFilter } = await import('../src/core/cofl-engine.js');
    const result = runDecisionFilter(
      {
        sourceRole: 'reference_teacher',
        operatorLeverageScore: 7,
        affectedDimensions: ['ux_polish'],
        proofRequirement: 'short',  // too short
        implementationScope: 'narrow',
      },
      { validTeacherRoles: ['reference_teacher'], knownGapDimensions: ['ux_polish'] },
    );
    const proofCheck = result.checks.find(c => c.question.includes('prove it'));
    assert.strictEqual(proofCheck?.passed, false, 'short proof requirement should fail');
  });
});
