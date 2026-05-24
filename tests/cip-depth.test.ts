import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { runCIPCheck } from '../src/core/completion-integrity.js';

const tempRoots: string[] = [];

after(async () => {
  for (const root of tempRoots) {
    await fs.rm(root, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cipdepth-'));
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

async function writeEvidence(root: string, dimId: string, ranAt: Date): Promise<void> {
  const dir = path.join(root, '.danteforge', 'outcome-evidence');
  await fs.mkdir(dir, { recursive: true });
  const safeDim = dimId.replace(/[^a-z0-9]/gi, '-');
  await fs.writeFile(
    path.join(dir, `abc123-${safeDim}-o1.json`),
    JSON.stringify({ ranAt: ranAt.toISOString(), passed: true, tier: 'T5' }),
    'utf8',
  );
}

describe('outcome relevance check', () => {
  it('T1: all outcomes have zero keyword overlap with dim — irrelevantOutcomes=1, ceiling ≤ 7.0', async () => {
    const root = await makeWorkspace();
    // dim id "daemon_core" — keywords: "daemon", "core"
    // outcome command "node --version" — contains neither
    await writeMatrix(root, [{
      id: 'daemon_core',
      label: 'Daemon Core',
      scores: { self: 5.0 },
      outcomes: [{ id: 'o1', command: 'node --version' }],
      critical_path_files: [],
    }]);

    const result = await runCIPCheck('daemon_core', { cwd: root, skipStubScan: true });

    assert.equal(result.irrelevantOutcomes, 1, 'should flag the irrelevant outcome');
    assert.ok(result.cipScore <= 7.0, `cipScore ${result.cipScore} should be ≤ 7.0 when all outcomes irrelevant`);
    assert.ok(result.gaps.some(g => g.includes('may not exercise')), 'gap should mention relevance issue');
  });

  it('T2: outcome command contains dim keyword — irrelevantOutcomes=0', async () => {
    const root = await makeWorkspace();
    // dim id "daemon_core" — keywords: "daemon", "core"
    // outcome command mentions "daemon" → relevant
    await writeMatrix(root, [{
      id: 'daemon_core',
      label: 'Daemon Core',
      scores: { self: 5.0 },
      outcomes: [{ id: 'o1', command: 'node -e "require(\'./dist\').daemonStart()"' }],
      critical_path_files: [],
    }]);

    const result = await runCIPCheck('daemon_core', { cwd: root, skipStubScan: true });

    assert.equal(result.irrelevantOutcomes, 0, 'keyword found in command — not irrelevant');
  });

  it('T2b: dim with short ID but descriptive label — label keyword match counts as relevant', async () => {
    const root = await makeWorkspace();
    // dim id "ux" — only 2 chars, filtered out by ≥4 rule
    // label "UX Polish Feedback" — "poli" and "feed" are ≥4 chars and extracted from label
    // outcome command "node test-polish.ts" — contains "poli" → relevant via label keyword
    await writeMatrix(root, [{
      id: 'ux',
      label: 'UX Polish Feedback',
      scores: { self: 5.0 },
      outcomes: [{ id: 'o1', command: 'node test-polish.ts' }],
      critical_path_files: [],
    }]);

    const result = await runCIPCheck('ux', { cwd: root, skipStubScan: true });

    assert.equal(result.irrelevantOutcomes, 0, 'label keyword "poli" found in command — not irrelevant');
  });

  it('T2c: skip_relevance_check=true exempts an outcome from the relevance count', async () => {
    const root = await makeWorkspace();
    // No dim keywords overlap with the generic command, but skip_relevance_check=true
    await writeMatrix(root, [{
      id: 'daemon_core',
      label: 'Daemon Core',
      scores: { self: 5.0 },
      outcomes: [{ id: 'o1', command: 'npm run benchmark', skip_relevance_check: true }],
      critical_path_files: [],
    }]);

    const result = await runCIPCheck('daemon_core', { cwd: root, skipStubScan: true });

    assert.equal(result.irrelevantOutcomes, 0, 'skip_relevance_check=true must exempt the outcome');
  });
});

describe('evidence freshness gate', () => {
  it('T3: storedScore ≥9.0 with no evidence files → blocksFrontierReached=true', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [{
      id: 'test_dim',
      label: 'Test',
      scores: { self: 9.0 },
      outcomes: [{ id: 'o1', command: 'node --version' }],
      critical_path_files: [],
    }]);
    // No evidence files written — outcome-evidence dir does not exist

    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true, target: 9.0 });

    assert.equal(result.blocksFrontierReached, true, 'missing receipts must block at T7');
    assert.ok(result.gaps.some(g => g.includes('validate')), 'gap should mention validate command');
    assert.equal(result.evidenceAgeDays, null, 'no evidence → evidenceAgeDays must be null');
  });

  it('T4: storedScore ≥9.0 with evidence 1 day old → no freshness block', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [{
      id: 'test_dim',
      label: 'Test',
      scores: { self: 9.0 },
      outcomes: [{ id: 'o1', command: 'node --version' }],
      critical_path_files: [],
    }]);
    // Write fresh evidence (1 day ago)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await writeEvidence(root, 'test_dim', oneDayAgo);

    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true, target: 9.0 });

    assert.ok(result.evidenceAgeDays !== null && result.evidenceAgeDays < 2, 'evidence should be ~1 day old');
    assert.ok(!result.gaps.some(g => g.includes('evidence is') && g.includes('old')), 'no staleness gap for 1-day-old evidence');
  });

  it('T5: storedScore < 9.0 with no evidence files → freshness gate is silent', async () => {
    const root = await makeWorkspace();
    await writeMatrix(root, [{
      id: 'test_dim',
      label: 'Test',
      scores: { self: 8.0 },
      outcomes: [{ id: 'o1', command: 'node --version' }],
      critical_path_files: [],
    }]);
    // No evidence files — but score is only 8.0, below the 9.0 threshold

    const result = await runCIPCheck('test_dim', { cwd: root, skipStubScan: true, target: 9.0 });

    assert.ok(!result.gaps.some(g => g.includes('validate') && g.includes('score')), 'no freshness gap below 9.0');
  });
});
