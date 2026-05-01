import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initCausalWeightMatrix,
  loadCausalWeightMatrix,
  saveCausalWeightMatrix,
  applyAttributionOutcomes,
  computeGlobalCausalCoherence,
  type AttributionOutcome,
  type CausalWeightMatrix,
} from '../src/core/causal-weight-matrix.js';

function aligned(overrides: Partial<AttributionOutcome> = {}): AttributionOutcome {
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

describe('initCausalWeightMatrix', () => {
  it('returns matrix with schema version 1.0.0', () => {
    const m = initCausalWeightMatrix();
    assert.equal(m.schemaVersion, '1.0.0');
  });

  it('returns matrix with zero totalAttributions', () => {
    const m = initCausalWeightMatrix();
    assert.equal(m.totalAttributions, 0);
  });

  it('returns matrix with zero globalCausalCoherence', () => {
    const m = initCausalWeightMatrix();
    assert.equal(m.globalCausalCoherence, 0);
  });
});

describe('applyAttributionOutcomes', () => {
  it('increments totalAttributions by outcome count', () => {
    const m = initCausalWeightMatrix();
    const updated = applyAttributionOutcomes(m, [aligned(), aligned()]);
    assert.equal(updated.totalAttributions, 2);
  });

  it('updates perDimensionAccuracy for the given dimension', () => {
    const m = initCausalWeightMatrix();
    const updated = applyAttributionOutcomes(m, [aligned({ dimension: 'testing' })]);
    assert.ok(updated.perDimensionAccuracy['testing'] !== undefined);
    assert.equal(updated.perDimensionAccuracy['testing']?.sampleCount, 1);
  });

  it('updates perActionTypeAccuracy for the given action', () => {
    const m = initCausalWeightMatrix();
    const updated = applyAttributionOutcomes(m, [aligned({ actionType: 'verify' })]);
    assert.ok(updated.perActionTypeAccuracy['verify'] !== undefined);
    assert.equal(updated.perActionTypeAccuracy['verify']?.sampleCount, 1);
  });

  it('does not mutate the input matrix', () => {
    const m = initCausalWeightMatrix();
    applyAttributionOutcomes(m, [aligned()]);
    assert.equal(m.totalAttributions, 0);
  });

  it('running average: direction accuracy 1.0 after all aligned outcomes', () => {
    let m = initCausalWeightMatrix();
    for (let i = 0; i < 5; i++) {
      m = applyAttributionOutcomes(m, [aligned()]);
    }
    assert.ok((m.perDimensionAccuracy['functionality']?.directionAccuracy ?? 0) === 1.0);
  });

  it('running average: direction accuracy 0 after all mismatch outcomes', () => {
    let m = initCausalWeightMatrix();
    for (let i = 0; i < 5; i++) {
      m = applyAttributionOutcomes(m, [aligned({ predictedDelta: 0.2, measuredDelta: -0.2, classification: 'noise' })]);
    }
    assert.equal(m.perDimensionAccuracy['functionality']?.directionAccuracy, 0);
  });
});

describe('computeGlobalCausalCoherence', () => {
  it('returns 0 when no dimensions have ≥5 samples', () => {
    let m = initCausalWeightMatrix();
    m = applyAttributionOutcomes(m, [aligned(), aligned(), aligned()]);
    assert.equal(computeGlobalCausalCoherence(m), 0);
  });

  it('returns direction accuracy when one dimension has ≥5 samples', () => {
    let m = initCausalWeightMatrix();
    for (let i = 0; i < 5; i++) {
      m = applyAttributionOutcomes(m, [aligned()]);
    }
    const coherence = computeGlobalCausalCoherence(m);
    assert.ok(coherence > 0, 'expected coherence > 0');
  });

  it('returns 0 for empty matrix', () => {
    const m = initCausalWeightMatrix();
    assert.equal(computeGlobalCausalCoherence(m), 0);
  });
});

describe('loadCausalWeightMatrix / saveCausalWeightMatrix', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cwm-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns fresh init matrix when no file exists', async () => {
    const m = await loadCausalWeightMatrix(tmpDir);
    assert.equal(m.schemaVersion, '1.0.0');
    assert.equal(m.totalAttributions, 0);
  });

  it('round-trips save then load', async () => {
    let m = initCausalWeightMatrix();
    m = applyAttributionOutcomes(m, [aligned({ actionType: 'forge', dimension: 'testing' })]);
    await saveCausalWeightMatrix(m, tmpDir);
    const loaded = await loadCausalWeightMatrix(tmpDir);
    assert.equal(loaded.totalAttributions, 1);
    assert.equal(loaded.perActionTypeAccuracy['forge']?.sampleCount, 1);
  });

  it('creates .danteforge directory if missing', async () => {
    const nested = path.join(tmpDir, 'nested-project');
    const m = initCausalWeightMatrix();
    await saveCausalWeightMatrix(m, nested);
    const exists = await fs.access(path.join(nested, '.danteforge', 'causal-weight-matrix.json')).then(() => true).catch(() => false);
    assert.equal(exists, true);
  });
});
