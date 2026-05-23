import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  runCIPCheck,
  runDeclaredOutcomes,
  hasSrcImplementation,
} from '../src/core/completion-integrity.js';

const tempRoots: string[] = [];

after(async () => {
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cip-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  return root;
}

async function writeMatrix(root: string, dims: object[]): Promise<void> {
  await fs.writeFile(
    path.join(root, '.danteforge', 'compete', 'matrix.json'),
    JSON.stringify({ dimensions: dims, excludedDimensions: [] }, null, 2),
    'utf8',
  );
}

function makeDim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'test_dim',
    label: 'Test Dimension',
    scores: { self: 5.0 },
    outcomes: [],
    critical_path_files: [],
    ...overrides,
  };
}

describe('runCIPCheck', () => {
  it('T1: returns cipClass missing when matrix.json does not exist', async () => {
    const root = await makeWorkspace();
    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true });
    assert.equal(result.cipClass, 'missing');
    assert.equal(result.blocksFrontierReached, true);
    assert.equal(result.dimensionId, 'test_dim');
  });

  it('T2: returns cipClass missing when dimension is not found in matrix', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [makeDim({ id: 'other_dim' })]);
    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true });
    assert.equal(result.cipClass, 'missing');
    assert.equal(result.blocksFrontierReached, true);
  });

  it('T3: blocksFrontierReached is true when no outcomes declared', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [makeDim({ outcomes: [] })]);
    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true });
    assert.equal(result.outcomesRun, 0);
    assert.equal(result.blocksFrontierReached, true);
  });

  it('T4: blocksFrontierReached is true and cipScore is capped low when cipScore < target - 0.5', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [makeDim({ scores: { self: 5.0 }, outcomes: [] })]);
    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true, target: 9.0 });
    assert.ok(result.cipScore < 9.0 - 0.5, `cipScore ${result.cipScore} should be < 8.5`);
    assert.equal(result.blocksFrontierReached, true);
  });

  it('T5: skipStubScan true means stubsFound is 0', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [makeDim()]);
    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true });
    assert.equal(result.stubsFound, 0);
  });
});

describe('runDeclaredOutcomes', () => {
  it('T6: returns total 0 and passing 0 for empty outcomes list', async () => {
    const root = await makeWorkspace();
    const result = await runDeclaredOutcomes([], root, 30_000);
    assert.equal(result.total, 0);
    assert.equal(result.passing, 0);
  });

  it('T7: passing outcome command (node --version) increments outcomesPassed', async () => {
    const root = await makeWorkspace();
    // node --version exits 0 — does not match parseNodeECommand, uses shell path
    const result = await runDeclaredOutcomes(
      [{ id: 'o1', command: 'node --version' }],
      root,
      30_000,
    );
    assert.equal(result.total, 1);
    assert.equal(result.passing, 1);
  });

  it('T8: failing outcome command (node -e "process.exit(1)") leaves passing at 0', async () => {
    const root = await makeWorkspace();
    const result = await runDeclaredOutcomes(
      [{ id: 'o1', command: 'node -e "process.exit(1)"' }],
      root,
      30_000,
    );
    assert.equal(result.total, 1);
    assert.equal(result.passing, 0);
  });
});

describe('hasSrcImplementation', () => {
  it('T9: returns true when keyword found in a .ts file under src/', async () => {
    const root = await makeWorkspace();
    await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'core', 'daemon.ts'),
      'export function daemonStart() { return true; }\n',
      'utf8',
    );
    const found = await hasSrcImplementation('daemon_core', root);
    assert.equal(found, true);
  });

  it('T10: returns false when no src/ directory exists', async () => {
    const root = await makeWorkspace();
    const found = await hasSrcImplementation('test_dim', root);
    assert.equal(found, false);
  });
});
