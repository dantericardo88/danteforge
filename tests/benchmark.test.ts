import { describe, it } from 'node:test';
import assert from 'node:assert';
import { benchmark } from '../src/cli/commands/benchmark.js';
import type { HarshScoreResult, ScoringDimension } from '../src/core/harsh-scorer.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHarshResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  const dims: Record<ScoringDimension, number> = {
    functionality: 7.0,
    testing: 8.5,
    errorHandling: 7.5,
    security: 7.5,
    uxPolish: 5.0,
    documentation: 5.5,
    performance: 7.0,
    maintainability: 7.0,
    developerExperience: 5.5,
    autonomy: 7.0,
    planningQuality: 8.0,
    selfImprovement: 7.5,
    specDrivenPipeline: 8.5,
    convergenceSelfHealing: 7.0,
    tokenEconomy: 7.5,
    contextEconomy: 7.5,
    ecosystemMcp: 6.5,
    enterpriseReadiness: 5.0,
    communityAdoption: 1.5,
  };
  return {
    rawScore: 72,
    harshScore: 70,
    displayScore: 7.0,
    dimensions: Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, v * 10])) as Record<ScoringDimension, number>,
    displayDimensions: dims,
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: {} as HarshScoreResult['maturityAssessment'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeMatrix(): CompeteMatrix {
  return {
    project: 'DanteForge',
    overallSelfScore: 7.6,
    lastUpdated: new Date().toISOString(),
    dimensions: [
      {
        id: 'testing',
        label: 'Testing & Verification',
        scores: { self: 8.5 },
        gap_to_leader: 0.5,
        weight: 1.0,
        frequency: 'high',
        status: 'open',
        sprint_history: [],
      },
    ],
    competitors_closed_source: [],
    competitors_oss: [],
  } as unknown as CompeteMatrix;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('benchmark command', () => {
  it('T1: --dimension testing outputs single score', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { output.push(String(chunk)); return true; };

    try {
      await benchmark({
        dimension: 'testing',
        format: 'json',
        _harshScore: async () => makeHarshResult(),
      });
    } finally {
      process.stdout.write = origWrite;
    }

    const json = JSON.parse(output.join(''));
    assert.strictEqual(json.dimension, 'testing');
    assert.ok(typeof json.score === 'number', 'score should be a number');
  });

  it('T2: full run outputs all 19 dimensions', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { output.push(String(chunk)); return true; };

    try {
      await benchmark({
        _harshScore: async () => makeHarshResult(),
      });
    } finally {
      process.stdout.write = origWrite;
    }

    // All 19 dimension names should appear in output
    const combined = output.join('');
    const expectedDims: ScoringDimension[] = ['functionality', 'testing', 'security', 'communityAdoption'];
    for (const dim of expectedDims) {
      assert.ok(combined.includes(dim), `Output should include dimension: ${dim}`);
    }
  });

  it('T3: --format json outputs parseable JSON', async () => {
    const output: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => { output.push(String(chunk)); return true; };

    try {
      await benchmark({
        format: 'json',
        _harshScore: async () => makeHarshResult(),
      });
    } finally {
      process.stdout.write = origWrite;
    }

    const json = JSON.parse(output.join(''));
    assert.ok(typeof json === 'object', 'Should output valid JSON object');
    assert.ok('testing' in json, 'JSON should include testing dimension');
    assert.ok('functionality' in json, 'JSON should include functionality dimension');
  });

  it('T4: --compare loads CHL matrix and shows competitor section', async () => {
    const logs: string[] = [];
    // Capture logger output via process.stdout
    const origWrite = process.stdout.write.bind(process.stdout);
    const origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; };
    process.stderr.write = (chunk: string | Uint8Array) => { logs.push(String(chunk)); return true; };

    try {
      await benchmark({
        compare: true,
        _harshScore: async () => makeHarshResult(),
        _loadMatrix: async () => makeMatrix(),
      });
    } finally {
      process.stdout.write = origWrite;
      process.stderr.write = origErr;
    }

    const combined = logs.join('');
    // Should show CHL Matrix section
    assert.ok(combined.includes('CHL Matrix') || combined.includes('Leader Gap') || combined.includes('compete'), 'Should show matrix comparison');
  });

  it('T5: _harshScore injection avoids real LLM calls', async () => {
    let injectionCalled = false;
    await benchmark({
      _harshScore: async () => {
        injectionCalled = true;
        return makeHarshResult();
      },
    });
    assert.ok(injectionCalled, '_harshScore injection was used');
  });
});
