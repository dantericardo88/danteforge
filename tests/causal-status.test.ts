import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { causalStatus, computeCalibrationNarrative, type CausalStatusOptions } from '../src/cli/commands/causal-status.js';
import {
  initCausalWeightMatrix,
  applyAttributionOutcomes,
  type CausalWeightMatrix,
  type AttributionOutcome,
} from '../src/core/causal-weight-matrix.js';

function makeMatrix(overrides: Partial<CausalWeightMatrix> = {}): CausalWeightMatrix {
  return { ...initCausalWeightMatrix(), ...overrides };
}

function outcome(overrides: Partial<AttributionOutcome> = {}): AttributionOutcome {
  return {
    dimension: 'functionality',
    actionType: 'forge',
    predictedDelta: 0.2,
    measuredDelta: 0.2,
    predictedConfidence: 0.8,
    classification: 'causally-aligned',
    ...overrides,
  };
}

function captureStdout(fn: () => Promise<void>): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Buffer | Uint8Array) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    };
    fn().then(() => {
      process.stdout.write = original;
      resolve(Buffer.concat(chunks).toString('utf8'));
    }).catch((err) => {
      process.stdout.write = original;
      reject(err);
    });
  });
}

const opts = (matrix: CausalWeightMatrix, extra: Partial<CausalStatusOptions> = {}): CausalStatusOptions => ({
  _loadMatrix: async () => matrix,
  ...extra,
});

describe('causalStatus — no data', () => {
  it('completes without error when matrix is empty', async () => {
    await assert.doesNotReject(() => causalStatus(opts(makeMatrix())));
  });
});

describe('causalStatus — json mode', () => {
  it('outputs valid JSON with schemaVersion field', async () => {
    let m = makeMatrix();
    m = applyAttributionOutcomes(m, [outcome()]);
    const output = await captureStdout(() => causalStatus(opts(m, { json: true })));
    const parsed = JSON.parse(output);
    assert.equal(parsed.schemaVersion, '1.0.0');
  });

  it('json output includes totalAttributions', async () => {
    let m = makeMatrix();
    m = applyAttributionOutcomes(m, [outcome(), outcome()]);
    const output = await captureStdout(() => causalStatus(opts(m, { json: true })));
    const parsed = JSON.parse(output);
    assert.equal(parsed.totalAttributions, 2);
  });
});

describe('computeCalibrationNarrative', () => {
  it('returns empty array when no dimension has sufficient samples', () => {
    const m = makeMatrix();
    assert.deepEqual(computeCalibrationNarrative(m), []);
  });

  it('identifies well-calibrated dimensions (dir >= 0.75 AND mag >= 0.60)', () => {
    let m = makeMatrix();
    // 10 causally-aligned outcomes with matching magnitudes → high dir + high mag
    for (let i = 0; i < 10; i++) {
      m = applyAttributionOutcomes(m, [
        outcome({ dimension: 'functionality', predictedDelta: 0.3, measuredDelta: 0.3 }),
      ]);
    }
    const lines = computeCalibrationNarrative(m);
    const calibLine = lines.find((l) => l.includes('well-calibrated'));
    assert.ok(calibLine !== undefined, 'should have a well-calibrated line');
    assert.ok(calibLine!.includes('functionality'), 'should mention the well-calibrated dimension');
  });

  it('identifies magnitude-miscalibrated dimensions (good direction, low magnitude calibration)', () => {
    let m = makeMatrix();
    // Alternate: predicted 0.5 but measured 0.05 → direction match (both +) but magnitude way off
    for (let i = 0; i < 5; i++) {
      m = applyAttributionOutcomes(m, [
        outcome({ dimension: 'testing', predictedDelta: 0.5, measuredDelta: 0.05, classification: 'correlation-driven' }),
      ]);
    }
    const lines = computeCalibrationNarrative(m);
    const magLine = lines.find((l) => l.toLowerCase().includes('magnitude'));
    assert.ok(magLine !== undefined, 'should have a magnitude miscalibration line');
    assert.ok(magLine!.includes('testing'), 'should mention the miscalibrated dimension');
  });

  it('includes recommendation line when any dimension needs more training data', () => {
    let m = makeMatrix();
    // Low direction accuracy: mixed outcomes
    for (let i = 0; i < 4; i++) {
      m = applyAttributionOutcomes(m, [
        outcome({ dimension: 'security', predictedDelta: 0.2, measuredDelta: -0.1, classification: 'noise' }),
      ]);
    }
    const lines = computeCalibrationNarrative(m);
    const recLine = lines.find((l) => l.toLowerCase().includes('recommendation'));
    assert.ok(recLine !== undefined, 'should include a recommendation line');
    assert.ok(recLine!.includes('security'), 'recommendation should mention the weak dimension');
  });
});

describe('causalStatus — text mode with data', () => {
  it('completes without error with populated matrix', async () => {
    let m = makeMatrix();
    for (let i = 0; i < 5; i++) m = applyAttributionOutcomes(m, [outcome()]);
    await assert.doesNotReject(() => causalStatus(opts(m)));
  });

  it('completes with mixed action types', async () => {
    let m = makeMatrix();
    m = applyAttributionOutcomes(m, [
      outcome({ actionType: 'forge' }),
      outcome({ actionType: 'verify' }),
      outcome({ actionType: 'forge', dimension: 'testing' }),
    ]);
    await assert.doesNotReject(() => causalStatus(opts(m)));
  });
});
