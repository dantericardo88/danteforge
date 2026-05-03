import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { measure, MEASURE_SCHEMA_VERSION, type MeasureOptions } from '../src/cli/commands/measure.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { MaturityAssessment } from '../src/core/maturity-engine.js';

// ── Factory helpers ───────────────────────────────────────────────────────────

function makeMaturityAssessment(overrides: Partial<MaturityAssessment> = {}): MaturityAssessment {
  return {
    currentLevel: 4,
    targetLevel: 5,
    overallScore: 7.5,
    dimensions: {} as MaturityAssessment['dimensions'],
    gaps: [],
    founderExplanation: 'Test assessment',
    recommendation: { nextLevel: 5, key: 'test', actions: [] } as MaturityAssessment['recommendation'],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeScoreResult(overrides: Partial<HarshScoreResult> = {}): HarshScoreResult {
  const baseDims = {
    functionality: 75, testing: 70, errorHandling: 65, security: 80,
    uxPolish: 60, documentation: 55, performance: 72, maintainability: 68,
    developerExperience: 70, autonomy: 60, selfImprovement: 65, planningQuality: 70,
    communityAdoption: 30, enterpriseReadiness: 50, mcpIntegration: 45,
    specDrivenPipeline: 60, convergenceSelfHealing: 65, tokenEconomy: 70,
    causalCoherence: 55,
  } as HarshScoreResult['dimensions'];

  const displayDims = Object.fromEntries(
    Object.entries(baseDims).map(([k, v]) => [k, v / 10])
  ) as HarshScoreResult['displayDimensions'];

  return {
    rawScore: 65,
    harshScore: 65,
    displayScore: 6.5,
    dimensions: baseDims,
    displayDimensions: { ...displayDims, ...Object.fromEntries(
      Object.entries(overrides.displayDimensions ?? {})
    ) } as HarshScoreResult['displayDimensions'],
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: 'acceptable',
    maturityAssessment: makeMaturityAssessment(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function baseOpts(overrides: Partial<MeasureOptions> = {}): MeasureOptions {
  const lines: string[] = [];
  return {
    _computeScore: async () => makeScoreResult(),
    _calibrationNarrative: () => [],
    _retroDelta: async () => undefined,
    _stdout: (line: string) => lines.push(line),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('measure — level light', () => {
  it('completes without error', async () => {
    await assert.doesNotReject(() => measure(baseOpts({ level: 'light' })));
  });

  it('returns a MeasureResult with correct schemaVersion', async () => {
    const result = await measure(baseOpts({ level: 'light' }));
    assert.equal(result.schemaVersion, MEASURE_SCHEMA_VERSION);
  });
});

describe('measure — level standard JSON', () => {
  it('outputs valid JSON with schemaVersion measure.v1', async () => {
    const chunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    };
    try {
      await measure({
        ...baseOpts(),
        level: 'standard',
        json: true,
      });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(output);
    assert.equal(parsed.schemaVersion, MEASURE_SCHEMA_VERSION);
  });

  it('JSON output includes all 8 builder dimension names', async () => {
    const chunks: Buffer[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    };
    try {
      await measure({
        ...baseOpts(),
        level: 'standard',
        json: true,
      });
    } finally {
      process.stdout.write = origWrite;
    }
    const output = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(output) as { dimensions: Array<{ name: string }> };
    const names = parsed.dimensions.map((d) => d.name);
    for (const dim of ['functionality', 'testing', 'errorHandling', 'security', 'uxPolish', 'documentation', 'performance', 'maintainability']) {
      assert.ok(names.includes(dim), `dimension "${dim}" missing from output`);
    }
  });
});

describe('measure — level deep', () => {
  it('completes without error and includes nextStep', async () => {
    const result = await measure(baseOpts({ level: 'deep' }));
    assert.ok(result !== undefined);
    assert.ok(typeof result.overallScore === 'number');
  });
});

describe('measure — certify flag', () => {
  it('returns result with certHash when certify is true', async () => {
    const result = await measure({
      ...baseOpts(),
      certify: true,
    });
    assert.ok(typeof result.certHash === 'string', 'certHash should be a string');
    assert.equal(result.certHash!.length, 16, 'certHash should be 16 hex chars');
  });
});

describe('measure — calibration narrative', () => {
  it('includes narrative lines in text output when narrative is non-empty', async () => {
    const lines: string[] = [];
    await measure({
      _computeScore: async () => makeScoreResult(),
      _calibrationNarrative: () => ['  Calibration: predictor is well-calibrated on functionality.'],
      _retroDelta: async () => undefined,
      _stdout: (line: string) => lines.push(line),
      level: 'standard',
    });
    const combined = lines.join('\n');
    assert.ok(combined.includes('Calibration'), 'narrative lines should appear in output');
  });
});
