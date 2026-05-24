// dx-telemetry.test.ts — Node built-in test runner (isolated tmp dirs)
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  recordDxEvent,
  getDxStats,
  getDxReport,
  type DxEvent,
} from '../src/core/dx-telemetry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<DxEvent> = {}): DxEvent {
  return {
    command: 'forge',
    success: true,
    durationMs: 500,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('dx-telemetry', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-dx-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('recordDxEvent creates the telemetry file if it does not exist', async () => {
    const dir = path.join(tmpDir, 'create-test');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, '.danteforge', 'dx-telemetry.jsonl');

    await recordDxEvent(dir, makeEvent({ command: 'verify' }));

    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    assert.ok(exists, 'telemetry file should be created');
  });

  it('recordDxEvent appends events to the file', async () => {
    const dir = path.join(tmpDir, 'append-test');
    await fs.mkdir(dir, { recursive: true });

    await recordDxEvent(dir, makeEvent({ command: 'forge' }));
    await recordDxEvent(dir, makeEvent({ command: 'score' }));

    const stats = await getDxStats(dir);
    assert.equal(stats.totalCommands, 2);
  });

  it('getDxStats computes successRate correctly', async () => {
    const dir = path.join(tmpDir, 'success-rate-test');
    await fs.mkdir(dir, { recursive: true });

    await recordDxEvent(dir, makeEvent({ success: true }));
    await recordDxEvent(dir, makeEvent({ success: true }));
    await recordDxEvent(dir, makeEvent({ success: false, errorCode: 'ERR_NO_INIT' }));

    const stats = await getDxStats(dir);
    // 2 successes out of 3 = 0.666...
    assert.ok(Math.abs(stats.successRate - 2 / 3) < 0.001, `expected ~0.667, got ${stats.successRate}`);
  });

  it('getDxStats computes avgDurationMs correctly', async () => {
    const dir = path.join(tmpDir, 'avg-duration-test');
    await fs.mkdir(dir, { recursive: true });

    await recordDxEvent(dir, makeEvent({ durationMs: 100 }));
    await recordDxEvent(dir, makeEvent({ durationMs: 300 }));

    const stats = await getDxStats(dir);
    assert.equal(stats.avgDurationMs, 200);
  });

  it('getDxStats returns mostUsed in descending frequency order', async () => {
    const dir = path.join(tmpDir, 'most-used-test');
    await fs.mkdir(dir, { recursive: true });

    await recordDxEvent(dir, makeEvent({ command: 'forge' }));
    await recordDxEvent(dir, makeEvent({ command: 'forge' }));
    await recordDxEvent(dir, makeEvent({ command: 'forge' }));
    await recordDxEvent(dir, makeEvent({ command: 'verify' }));
    await recordDxEvent(dir, makeEvent({ command: 'verify' }));
    await recordDxEvent(dir, makeEvent({ command: 'score' }));

    const stats = await getDxStats(dir);
    assert.equal(stats.mostUsed[0], 'forge', 'most-used should be forge');
    assert.equal(stats.mostUsed[1], 'verify', 'second most-used should be verify');
  });

  it('recordDxEvent prunes to 1000 entries', async () => {
    const dir = path.join(tmpDir, 'prune-test');
    await fs.mkdir(dir, { recursive: true });

    // Write 1050 events in batches to keep it fast.
    const batch = Array.from({ length: 50 }, (_, i) =>
      makeEvent({ command: `cmd-${i}` }),
    );
    // Write 21 batches of 50 = 1050 events
    for (let b = 0; b < 21; b++) {
      for (const ev of batch) {
        await recordDxEvent(dir, ev);
      }
    }

    const stats = await getDxStats(dir);
    assert.ok(stats.totalCommands <= 1000, `expected ≤ 1000 entries, got ${stats.totalCommands}`);
  });

  it('getDxStats returns safe defaults for an empty directory', async () => {
    const dir = path.join(tmpDir, 'empty-test');
    await fs.mkdir(dir, { recursive: true });

    const stats = await getDxStats(dir);
    assert.equal(stats.totalCommands, 0);
    assert.equal(stats.successRate, 1);
    assert.deepEqual(stats.mostUsed, []);
    assert.deepEqual(stats.recentErrors, []);
  });

  it('getDxReport returns a non-empty markdown string', async () => {
    const dir = path.join(tmpDir, 'report-test');
    await fs.mkdir(dir, { recursive: true });

    await recordDxEvent(dir, makeEvent({ command: 'forge', success: true, durationMs: 200 }));
    await recordDxEvent(dir, makeEvent({ command: 'verify', success: false, errorCode: 'ERR_TYPECHECK', durationMs: 100 }));

    const report = await getDxReport(dir);
    assert.ok(report.length > 0, 'report should be non-empty');
    assert.ok(report.includes('## DX Telemetry Report'), 'report should have a header');
    assert.ok(report.includes('Success rate'), 'report should mention success rate');
    assert.ok(report.includes('dx-telemetry.jsonl'), 'report should reference the telemetry file');
  });

  it('getDxReport works without any recorded events', async () => {
    const dir = path.join(tmpDir, 'empty-report-test');
    await fs.mkdir(dir, { recursive: true });

    const report = await getDxReport(dir);
    assert.ok(report.length > 0, 'report should still be non-empty without data');
    assert.ok(report.includes('## DX Telemetry Report'));
  });
});
