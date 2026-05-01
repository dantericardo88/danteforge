/**
 * Tests for predictor-cost-telemetry.ts — PRD-WORLDMODEL-V1 §4.1
 * Verifies that prediction cost records are written to .danteforge/economy/
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  writePredictorCostRecord,
  type PredictorCostRecord,
} from '../src/core/predictor-cost-telemetry.js';

function makeRecord(overrides: Partial<PredictorCostRecord> = {}): PredictorCostRecord {
  return {
    predictedAt: '2026-05-01T10:00:00.000Z',
    command: 'forge',
    costUsd: 0.003,
    confidence: 0.75,
    predictorVersion: 'llm-predictor-v1',
    ...overrides,
  };
}

describe('writePredictorCostRecord', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'predictor-cost-telemetry-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates .danteforge/economy/ dir and writes a JSON file', async () => {
    await writePredictorCostRecord(makeRecord(), tmpDir);
    const files = await readdir(join(tmpDir, '.danteforge', 'economy'));
    assert.ok(files.length > 0, 'at least one cost record should be written');
    assert.ok(files[0].startsWith('predictor-'), `filename should start with "predictor-", got: ${files[0]}`);
    assert.ok(files[0].endsWith('.json'), 'filename should end with .json');
  });

  it('written JSON file contains all required fields', async () => {
    const record = makeRecord({ command: 'verify', costUsd: 0.007, confidence: 0.85, receiptHash: 'abc123' });
    await writePredictorCostRecord(record, tmpDir);
    const files = await readdir(join(tmpDir, '.danteforge', 'economy'));
    const latest = files.sort().at(-1)!;
    const raw = await readFile(join(tmpDir, '.danteforge', 'economy', latest), 'utf8');
    const parsed = JSON.parse(raw) as PredictorCostRecord;

    assert.strictEqual(parsed.command, 'verify');
    assert.strictEqual(parsed.costUsd, 0.007);
    assert.strictEqual(parsed.confidence, 0.85);
    assert.strictEqual(parsed.receiptHash, 'abc123');
    assert.ok(typeof parsed.predictorVersion === 'string', 'predictorVersion must be a string');
    assert.ok(typeof parsed.predictedAt === 'string', 'predictedAt must be a string');
  });

  it('two calls with different timestamps produce two distinct files', async () => {
    const before = (await readdir(join(tmpDir, '.danteforge', 'economy'))).length;

    await writePredictorCostRecord(makeRecord({ predictedAt: '2026-05-01T11:00:00.000Z' }), tmpDir);
    await writePredictorCostRecord(makeRecord({ predictedAt: '2026-05-01T12:00:00.000Z' }), tmpDir);

    const after = (await readdir(join(tmpDir, '.danteforge', 'economy'))).length;
    assert.ok(after >= before + 2, `should have at least 2 new files, got ${after - before}`);
  });
});
