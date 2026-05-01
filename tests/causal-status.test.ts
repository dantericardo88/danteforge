import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { causalStatus, type CausalStatusOptions } from '../src/cli/commands/causal-status.js';
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
