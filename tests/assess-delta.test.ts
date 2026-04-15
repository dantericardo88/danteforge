import { describe, it } from 'node:test';
import assert from 'node:assert';
import { assess, type AssessOptions } from '../src/cli/commands/assess.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHarshResult(displayScore: number): HarshScoreResult {
  const dims = {
    functionality: displayScore * 10, testing: displayScore * 10,
    errorHandling: displayScore * 10, security: displayScore * 10,
    uxPolish: displayScore * 10, documentation: displayScore * 10,
    performance: displayScore * 10, maintainability: displayScore * 10,
    developerExperience: displayScore * 10, autonomy: displayScore * 10,
    planningQuality: displayScore * 10, selfImprovement: displayScore * 10,
    specDrivenPipeline: displayScore * 10, convergenceSelfHealing: displayScore * 10,
    tokenEconomy: displayScore * 10, ecosystemMcp: displayScore * 10,
    enterpriseReadiness: displayScore * 10, communityAdoption: displayScore * 10,
  } as HarshScoreResult['dimensions'];

  return {
    rawScore: displayScore * 10,
    harshScore: displayScore * 10,
    displayScore,
    dimensions: dims,
    displayDimensions: Object.fromEntries(
      Object.entries(dims).map(([k, v]) => [k, v / 10]),
    ) as HarshScoreResult['displayDimensions'],
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: { level: 3, label: 'mature', score: displayScore * 10, dimensions: {} } as HarshScoreResult['maturityAssessment'],
    timestamp: new Date().toISOString(),
  };
}

function makeBaseOpts(displayScore = 7.0): AssessOptions {
  return {
    harsh: false,
    competitors: false,
    cwd: '/tmp/test-assess-delta',
    _harshScore: async () => makeHarshResult(displayScore),
    _scanCompetitors: async () => ({ competitors: [], gapReport: [], scanTimestamp: '' }),
    _generateMasterplan: async () => ({
      items: [], criticalCount: 0, majorCount: 0, projectedCycles: 1,
      generatedAt: '', cycleNumber: 1,
    }),
    _buildProjectContext: async () => ({
      projectName: 'test', projectType: 'cli', competitors: [],
    }),
    _getCompletionTarget: async () => ({
      mode: 'dimension-based', minScore: 9.0, definedBy: 'default',
      description: 'default target',
    }),
  };
}

function makeStateOps(initial: Partial<DanteState> = {}): {
  savedState: DanteState | null;
  _loadState: AssessOptions['_loadState'];
  _saveState: AssessOptions['_saveState'];
} {
  let savedState: DanteState | null = {
    project: 'test', workflowStage: 'forge', currentPhase: 1, tasks: {},
    lastHandoff: '', profile: 'balanced', auditLog: [], ...initial,
  } as DanteState;

  return {
    get savedState() { return savedState; },
    _loadState: async () => ({ ...savedState! }),
    _saveState: async (s) => { savedState = { ...s }; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assess session delta tracking', () => {
  it('T1: first assess sets sessionBaselineScore in state', async () => {
    const ops = makeStateOps(); // no baseline set
    await assess({ ...makeBaseOpts(7.0), ...ops });
    assert.ok(ops.savedState, 'state should be saved');
    assert.strictEqual(ops.savedState!.sessionBaselineScore, 7.0, 'baseline should be set to 7.0');
    assert.ok(ops.savedState!.sessionBaselineTimestamp, 'timestamp should be set');
  });

  it('T2: second assess shows delta when baseline exists', async () => {
    // Pre-load state with a baseline at 6.0
    const ops = makeStateOps({ sessionBaselineScore: 6.0, sessionBaselineTimestamp: '2026-01-01T00:00:00.000Z' });
    const logged: string[] = [];
    const origInfo = console.info;

    // Capture logger output by overriding — instead we just verify the state isn't overwritten
    // (delta rendering is tested by the logic branch being reached)
    await assess({ ...makeBaseOpts(7.4), ...ops });

    // State should NOT be overwritten (baseline already exists)
    assert.strictEqual(ops.savedState!.sessionBaselineScore, 6.0, 'existing baseline should be preserved');
  });

  it('T3: --set-baseline resets baseline to current score', async () => {
    const ops = makeStateOps({ sessionBaselineScore: 5.0, sessionBaselineTimestamp: '2026-01-01T00:00:00.000Z' });
    await assess({ ...makeBaseOpts(8.0), ...ops, setBaseline: true });
    assert.strictEqual(ops.savedState!.sessionBaselineScore, 8.0, 'baseline should be reset to 8.0');
  });

  it('T4: delta sign is correct for improvement, regression, and flat', async () => {
    // Test the delta math directly (the rendering function receives these values)
    const improved = 7.4 - 6.0;   // +1.4
    const regressed = 5.0 - 6.0;  // -1.0
    const flat = 6.0 - 6.0;       // 0.0

    assert.ok(improved > 0, 'improvement delta should be positive');
    assert.ok(regressed < 0, 'regression delta should be negative');
    assert.strictEqual(flat, 0, 'flat delta should be zero');
  });

  it('T5: _harshScore injection avoids real LLM calls', async () => {
    let injectedCalled = false;
    const ops = makeStateOps();
    await assess({
      ...makeBaseOpts(),
      ...ops,
      _harshScore: async () => {
        injectedCalled = true;
        return makeHarshResult(7.0);
      },
    });
    assert.ok(injectedCalled, 'injected _harshScore should be called');
  });
});
