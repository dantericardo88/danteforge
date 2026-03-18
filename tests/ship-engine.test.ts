// Ship Engine tests - version bump, changelog, commit splitting
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  autoDecideBumpLevel,
  buildShipPlan,
  type BumpLevel,
  type CommitGroup,
  type ShipPlan,
} from '../src/core/ship-engine.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

function runGit(cwd: string, args: string[]) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  assert.strictEqual(
    result.status,
    0,
    `git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );

  return result.stdout.trim();
}

async function makeGitWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-ship-engine-'));
  tempRoots.push(root);

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'DanteForge Test']);
  runGit(root, ['config', 'user.email', 'tests@danteforge.dev']);

  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'ship-test', version: '1.2.3', type: 'module' }, null, 2),
    'utf8',
  );
  await fs.writeFile(path.join(root, 'README.md'), '# Ship test\n', 'utf8');
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'chore: initial release baseline']);

  return root;
}

describe('autoDecideBumpLevel', () => {
  it('returns micro for < 50 lines', () => {
    assert.strictEqual(autoDecideBumpLevel(10), 'micro');
    assert.strictEqual(autoDecideBumpLevel(49), 'micro');
  });

  it('returns patch for >= 50 lines', () => {
    assert.strictEqual(autoDecideBumpLevel(50), 'patch');
    assert.strictEqual(autoDecideBumpLevel(500), 'patch');
  });

  it('returns micro for 0 lines', () => {
    assert.strictEqual(autoDecideBumpLevel(0), 'micro');
  });
});

describe('BumpLevel type', () => {
  it('supports all bump levels', () => {
    const levels: BumpLevel[] = ['micro', 'patch', 'minor', 'major'];
    assert.strictEqual(levels.length, 4);
  });
});

describe('ShipPlan structure', () => {
  it('has all required fields', () => {
    const plan: ShipPlan = {
      bumpLevel: 'patch',
      currentVersion: '0.6.0',
      newVersion: '0.6.1',
      changelogEntry: '### Features\n- Added new feature',
      commitGroups: [
        { message: 'feat: new module', files: ['src/module.ts'], type: 'models' },
      ],
      reviewResult: { critical: [], informational: [], summary: 'Clean' },
      prTitle: 'Release 0.6.1',
      prBody: '## Release 0.6.1',
    };
    assert.strictEqual(plan.bumpLevel, 'patch');
    assert.strictEqual(plan.newVersion, '0.6.1');
    assert.strictEqual(plan.commitGroups.length, 1);
  });
});

describe('CommitGroup structure', () => {
  it('supports all commit group types', () => {
    const types: CommitGroup['type'][] = ['infrastructure', 'models', 'controllers', 'version-changelog'];
    assert.strictEqual(types.length, 4);
  });

  it('has message and files', () => {
    const group: CommitGroup = {
      message: 'chore: config updates',
      files: ['tsconfig.json', 'package.json'],
      type: 'infrastructure',
    };
    assert.strictEqual(group.files.length, 2);
    assert.ok(group.message.includes('config'));
  });
});

describe('version computation', () => {
  it('micro and patch both increment patch number conceptually', () => {
    const microLevel = autoDecideBumpLevel(10);
    const patchLevel = autoDecideBumpLevel(100);
    assert.strictEqual(microLevel, 'micro');
    assert.strictEqual(patchLevel, 'patch');
  });
});

describe('buildShipPlan', () => {
  it('uses committed changes when the working tree is clean', async () => {
    const cwd = await makeGitWorkspace();

    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'src', 'feature.ts'), 'export const shipped = true;\n', 'utf8');
    runGit(cwd, ['add', '.']);
    runGit(cwd, ['commit', '-m', 'feat: add plugin launch hardening']);

    const plan = await buildShipPlan(cwd, true);

    assert.match(plan.changelogEntry, /plugin launch hardening/i);
    assert.ok(
      plan.commitGroups.length > 0,
      'expected ship plan to classify committed release files even when the working tree is clean',
    );
  });
});
