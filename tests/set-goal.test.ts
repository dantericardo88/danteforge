// Set Goal — unit tests for persistence and goal configuration.
// No real TTY, no real universe-scan — all injected.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  setGoal,
  loadGoal,
  saveGoal,
  type GoalConfig,
  type SetGoalOptions,
} from '../src/cli/commands/set-goal.js';

// ── Fixture helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-set-goal-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

const noScan = async () => {
  throw new Error('_runUniverseScan should not be called');
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SetGoal — write and read', () => {

  it('T1: setGoal writes GOAL.json with all required fields', async () => {
    const dir = await makeTempDir();

    const goal = await setGoal({
      cwd: dir,
      autoScan: false,
      fields: {
        category: 'agentic dev CLI',
        competitors: ['Cursor', 'Aider'],
        definition9: 'Fully autonomous with convergence proof',
        exclusions: ['no web app'],
        dailyBudgetUsd: 10,
        oversightLevel: 1,
      },
    });

    const goalPath = path.join(dir, '.danteforge', 'GOAL.json');
    await assert.doesNotReject(fs.access(goalPath), 'GOAL.json must exist');

    const raw = await fs.readFile(goalPath, 'utf8');
    const parsed = JSON.parse(raw) as GoalConfig;

    assert.strictEqual(parsed.version, '1.0.0');
    assert.strictEqual(parsed.category, 'agentic dev CLI');
    assert.deepStrictEqual(parsed.competitors, ['Cursor', 'Aider']);
    assert.strictEqual(parsed.definition9, 'Fully autonomous with convergence proof');
    assert.deepStrictEqual(parsed.exclusions, ['no web app']);
    assert.strictEqual(parsed.dailyBudgetUsd, 10);
    assert.strictEqual(parsed.oversightLevel, 1);
    assert.ok(parsed.createdAt, 'createdAt must be set');
    assert.ok(parsed.updatedAt, 'updatedAt must be set');
    assert.strictEqual(goal.category, parsed.category);
  });

  it('T2: oversightLevel defaults to 2 when not specified', async () => {
    const dir = await makeTempDir();

    const goal = await setGoal({
      cwd: dir,
      autoScan: false,
      fields: { category: 'test-tool' },
    });

    assert.strictEqual(goal.oversightLevel, 2);
  });

  it('T3: dailyBudgetUsd defaults to 5.0 when not specified', async () => {
    const dir = await makeTempDir();

    const goal = await setGoal({
      cwd: dir,
      autoScan: false,
      fields: { category: 'test-tool' },
    });

    assert.strictEqual(goal.dailyBudgetUsd, 5.0);
  });

  it('T4: competitors array deduplicates (case-insensitive)', async () => {
    const dir = await makeTempDir();

    const goal = await setGoal({
      cwd: dir,
      autoScan: false,
      fields: { competitors: ['Cursor', 'cursor', 'CURSOR', 'Aider'] },
    });

    assert.strictEqual(goal.competitors.length, 2, 'Cursor and Aider — cursor duplicates removed');
    assert.ok(goal.competitors.includes('Cursor'), 'Cursor must be kept');
    assert.ok(goal.competitors.includes('Aider'), 'Aider must be kept');
  });

  it('T5: setGoal merges with existing GOAL.json (does not overwrite unchanged fields)', async () => {
    const dir = await makeTempDir();
    const danteforgeDir = path.join(dir, '.danteforge');
    await fs.mkdir(danteforgeDir, { recursive: true });

    // Write an existing goal
    const existing: GoalConfig = {
      version: '1.0.0',
      category: 'original-category',
      competitors: ['ExistingTool'],
      definition9: 'Original definition',
      exclusions: ['original exclusion'],
      dailyBudgetUsd: 20,
      oversightLevel: 3,
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    await fs.writeFile(path.join(danteforgeDir, 'GOAL.json'), JSON.stringify(existing), 'utf8');

    // Set goal with only category override
    const merged = await setGoal({
      cwd: dir,
      autoScan: false,
      fields: { category: 'new-category' },
    });

    assert.strictEqual(merged.category, 'new-category', 'category must be overridden');
    assert.strictEqual(merged.dailyBudgetUsd, 20, 'dailyBudgetUsd must be preserved from existing');
    assert.strictEqual(merged.oversightLevel, 3, 'oversightLevel must be preserved from existing');
    assert.strictEqual(merged.createdAt, '2025-01-01T00:00:00.000Z', 'createdAt must be preserved');
  });

  it('T6: setGoal calls _runUniverseScan after save when autoScan=true', async () => {
    const dir = await makeTempDir();
    let scanCalled = false;

    await setGoal({
      cwd: dir,
      autoScan: true,
      fields: { category: 'test-cli' },
      _runUniverseScan: async () => {
        scanCalled = true;
        return {
          version: '1.0.0',
          scannedAt: new Date().toISOString(),
          category: 'test-cli',
          dimensions: [],
          selfScores: {},
          dimensionChanges: { new: [], dead: [], shifted: [] },
        };
      },
    });

    assert.strictEqual(scanCalled, true, '_runUniverseScan must be called when autoScan=true');
  });

  it('T7: setGoal does NOT call _runUniverseScan when autoScan=false', async () => {
    const dir = await makeTempDir();
    let scanCalled = false;

    await setGoal({
      cwd: dir,
      autoScan: false,
      fields: { category: 'test-cli' },
      _runUniverseScan: async () => {
        scanCalled = true;
        return {
          version: '1.0.0',
          scannedAt: new Date().toISOString(),
          category: 'test-cli',
          dimensions: [],
          selfScores: {},
          dimensionChanges: { new: [], dead: [], shifted: [] },
        };
      },
    });

    assert.strictEqual(scanCalled, false, '_runUniverseScan must NOT be called when autoScan=false');
  });

  it('T8: promptMode=true returns plan without writing GOAL.json', async () => {
    const dir = await makeTempDir();

    await setGoal({ cwd: dir, promptMode: true, autoScan: false });

    const goalPath = path.join(dir, '.danteforge', 'GOAL.json');
    const exists = await fs.access(goalPath).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'GOAL.json must NOT be written in promptMode');
  });

});

describe('SetGoal — persistence', () => {

  it('T9: loadGoal returns null when GOAL.json not found', async () => {
    const dir = await makeTempDir();
    const result = await loadGoal(dir);
    assert.strictEqual(result, null);
  });

  it('T10: loadGoal + saveGoal round-trip preserves oversightLevel=3', async () => {
    const dir = await makeTempDir();
    const now = new Date().toISOString();

    const original: GoalConfig = {
      version: '1.0.0',
      category: 'test',
      competitors: [],
      definition9: 'A perfect tool',
      exclusions: [],
      dailyBudgetUsd: 7.5,
      oversightLevel: 3,
      createdAt: now,
      updatedAt: now,
    };

    await saveGoal(original, dir);
    const loaded = await loadGoal(dir);

    assert.ok(loaded !== null);
    assert.strictEqual(loaded.oversightLevel, 3);
    assert.strictEqual(loaded.dailyBudgetUsd, 7.5);
    assert.strictEqual(loaded.category, 'test');
  });

});
