import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-agent-guard.mjs');
const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-agent-guard-'));
  tempRoots.push(root);
  await fs.mkdir(path.join(root, '.danteforge', 'agent-claims'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });

  await fs.writeFile(path.join(root, '.danteforge', 'agent-guard.json'), JSON.stringify({
    claims: { dir: '.danteforge/agent-claims', ttlHours: 4 },
    size: { warn: 5, hard: 8, ignore: [], allowlist: [] },
    frozenFiles: ['src/core/kernel.ts'],
    atomicGroups: [{ id: 'scores', files: ['score.json', 'score.md', 'PRIME.md'] }],
  }, null, 2));

  await fs.writeFile(path.join(root, '.danteforge', 'agent-ownership.json'), JSON.stringify({
    globalAllowed: ['docs/**'],
    workstreams: {
      scoring: { owned: ['src/scoring/**', 'score.json', 'score.md', 'PRIME.md'], shared: [] },
      kernel: { owned: ['src/core/**'], shared: [] },
    },
  }, null, 2));

  return root;
}

function runGuard(cwd: string, args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [scriptPath, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const err = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: err.status ?? 1,
      output: `${err.stdout?.toString() ?? ''}${err.stderr?.toString() ?? ''}`,
    };
  }
}

describe('check-agent-guard', () => {
  it('blocks edits to frozen kernel files', async () => {
    const root = await makeRepo();
    await fs.writeFile(path.join(root, 'src', 'core', 'kernel.ts'), 'export const x = 1;\n');

    const result = runGuard(root, ['--changed', 'src/core/kernel.ts']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /FROZEN_FILE_CHANGED/);
  });

  it('allows frozen kernel edits only with explicit platform override', async () => {
    const root = await makeRepo();
    await fs.writeFile(path.join(root, 'src', 'core', 'kernel.ts'), 'export const x = 1;\n');

    const result = runGuard(root, ['--changed', 'src/core/kernel.ts', '--allow-frozen']);

    assert.equal(result.status, 0, result.output);
  });

  it('blocks workstream edits outside owned files', async () => {
    const root = await makeRepo();
    await fs.mkdir(path.join(root, 'src', 'other'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'other', 'thing.ts'), 'export const x = 1;\n');

    const result = runGuard(root, ['--workstream', 'scoring', '--changed', 'src/other/thing.ts']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /OWNERSHIP_VIOLATION/);
  });

  it('blocks partial atomic score updates', async () => {
    const root = await makeRepo();
    await fs.writeFile(path.join(root, 'score.json'), '{}\n');

    const result = runGuard(root, ['--changed', 'score.json']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /ATOMIC_GROUP_PARTIAL/);
  });

  it('blocks committed claim files', async () => {
    const root = await makeRepo();
    await fs.writeFile(path.join(root, '.danteforge', 'agent-claims', 'scoring.lock'), '{}\n');

    const result = runGuard(root, ['--changed', '.danteforge/agent-claims/scoring.lock']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /CLAIM_FILE_COMMITTED/);
  });

  it('blocks dimension claim lock files from being committed', async () => {
    const root = await makeRepo();
    await fs.mkdir(path.join(root, '.danteforge', 'dimension-claims'), { recursive: true });
    await fs.writeFile(path.join(root, '.danteforge', 'dimension-claims', 'dim-27.lock'), '{}\n');

    const result = runGuard(root, ['--changed', '.danteforge/dimension-claims/dim-27.lock']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /CLAIM_FILE_COMMITTED/);
  });

  it('blocks direct matrix edits unless a matrix-engine merge receipt is staged too', async () => {
    const root = await makeRepo();
    await fs.mkdir(path.join(root, '.danteforge', 'compete'), { recursive: true });
    await fs.writeFile(path.join(root, '.danteforge', 'compete', 'matrix.json'), '{}\n');

    const blocked = runGuard(root, ['--changed', '.danteforge/compete/matrix.json']);
    const allowed = runGuard(root, [
      '--changed',
      '.danteforge/compete/matrix.json,.danteforge/score-proposals/merge-receipts/receipt.json',
    ]);

    assert.notEqual(blocked.status, 0);
    assert.match(blocked.output, /DIRECT_MATRIX_EDIT/);
    assert.equal(allowed.status, 0, allowed.output);
  });

  it('blocks changed files above the hard LOC cap', async () => {
    const root = await makeRepo();
    await fs.mkdir(path.join(root, 'src', 'scoring'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'src', 'scoring', 'large.ts'),
      Array.from({ length: 9 }, (_, i) => `export const x${i} = ${i};`).join('\n'),
    );

    const result = runGuard(root, ['--workstream', 'scoring', '--changed', 'src/scoring/large.ts']);

    assert.notEqual(result.status, 0);
    assert.match(result.output, /FILE_TOO_LARGE/);
  });
});
