import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'dimension-ascent.mjs');
const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-dim-ascent-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
  const matrix = {
    project: 'demo',
    competitors: ['LeaderOSS', 'LeaderClosed'],
    competitors_closed_source: ['LeaderClosed'],
    competitors_oss: ['LeaderOSS'],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    overallSelfScore: 6,
    dimensions: [{
      id: 'long_run_reasoning',
      label: 'Long Run Reasoning',
      weight: 1,
      category: 'reasoning',
      frequency: 'high',
      scores: { self: 6, LeaderOSS: 8, LeaderClosed: 9 },
      gap_to_leader: 3,
      leader: 'LeaderClosed',
      gap_to_closed_source_leader: 3,
      closed_source_leader: 'LeaderClosed',
      gap_to_oss_leader: 2,
      oss_leader: 'LeaderOSS',
      status: 'in-progress',
      sprint_history: [],
      next_sprint_target: 8,
      capability_test: {
        command: 'node -e "process.exit(0)"',
        description: 'Test capability — always passes for ascent test fixture',
      },
    }],
  };
  await fs.writeFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2));
  return root;
}

function run(cwd: string, args: string[]): string {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function readMatrix(root: string) {
  return JSON.parse(await fs.readFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), 'utf8'));
}

describe('dimension-ascent', () => {
  it('prints next dimensions from the matrix', async () => {
    const root = await makeRepo();

    const output = run(root, ['status', '--top', '1']);

    assert.match(output, /long_run_reasoning/);
    assert.match(output, /Matrix hash:/);
  });

  it('creates a dimension claim with baseline score and hash', async () => {
    const root = await makeRepo();

    run(root, ['claim', '--dimension', '1', '--agent', 'codex']);

    const claim = JSON.parse(await fs.readFile(path.join(root, '.danteforge', 'dimension-claims', 'long_run_reasoning-codex.lock'), 'utf8'));
    assert.equal(claim.dimensionId, 'long_run_reasoning');
    assert.equal(claim.baselineScore, 6);
    assert.equal(typeof claim.matrixHash, 'string');
  });

  it('allows multiple agents to claim the same dimension independently', async () => {
    const root = await makeRepo();

    run(root, ['claim', '--dimension', '1', '--agent', 'codex']);
    run(root, ['claim', '--dimension', '1', '--agent', 'claude']);
    const claims = await fs.readdir(path.join(root, '.danteforge', 'dimension-claims'));

    assert.ok(claims.includes('long_run_reasoning-codex.lock'));
    assert.ok(claims.includes('long_run_reasoning-claude.lock'));
  });

  it('queues proposals without rewriting the matrix', async () => {
    const root = await makeRepo();

    run(root, ['propose', '--dimension', 'long_run_reasoning', '--score', '8.2', '--agent', 'claude', '--rationale', 'better proof']);
    const matrix = await readMatrix(root);
    const proposals = await fs.readdir(path.join(root, '.danteforge', 'score-proposals'));

    assert.equal(matrix.dimensions[0].scores.self, 6);
    assert.equal(proposals.filter(file => file.endsWith('.json')).length, 1);
  });

  it('merges conflicting proposals with harsh-min policy', async () => {
    const root = await makeRepo();
    run(root, ['propose', '--dimension', 'long_run_reasoning', '--score', '8.2', '--agent', 'a', '--rationale', 'optimistic']);
    run(root, ['propose', '--dimension', 'long_run_reasoning', '--score', '7.1', '--agent', 'b', '--rationale', 'harsh recheck']);

    const output = run(root, ['merge', '--policy', 'harsh-min', '--agent', 'merger']);
    const matrix = await readMatrix(root);
    const proposals = await fs.readdir(path.join(root, '.danteforge', 'score-proposals'));

    assert.match(output, /6 -> 7.1/);
    assert.equal(matrix.dimensions[0].scores.self, 7.1);
    assert.equal(matrix.dimensions[0].sprint_history.length, 1);
    assert.equal(proposals.filter(file => file.endsWith('.json')).length, 0);
  });

  it('honors dimension ceilings during merge', async () => {
    const root = await makeRepo();
    const matrix = await readMatrix(root);
    matrix.dimensions[0].ceiling = 7.5;
    await fs.writeFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), JSON.stringify(matrix, null, 2));

    run(root, ['propose', '--dimension', 'long_run_reasoning', '--score', '9.0', '--agent', 'a', '--rationale', 'attempt']);
    run(root, ['merge', '--agent', 'merger']);
    const updated = await readMatrix(root);

    assert.equal(updated.dimensions[0].scores.self, 7.5);
  });
});
