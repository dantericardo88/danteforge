import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXAMPLE_DIR = path.resolve('examples/todo-app');

describe('bundled todo-app example', () => {
  it('ships a runnable standalone test suite', async () => {
    await assert.doesNotReject(
      execFileAsync(process.execPath, ['--test', 'tests/todo.test.js'], {
        cwd: EXAMPLE_DIR,
      }),
    );
  });

  it('includes the documented pipeline artifacts in the example snapshot', async () => {
    const requiredArtifacts = [
      '.danteforge/CONSTITUTION.md',
      '.danteforge/SPEC.md',
      '.danteforge/CLARIFY.md',
      '.danteforge/PLAN.md',
      '.danteforge/TASKS.md',
      '.danteforge/STATE.yaml',
    ];

    for (const relativePath of requiredArtifacts) {
      const absolutePath = path.join(EXAMPLE_DIR, relativePath);
      await assert.doesNotReject(fs.access(absolutePath), `${relativePath} should ship in the example snapshot`);
    }
  });

  it('keeps the example pipeline snapshot free of hidden generated clutter', async () => {
    const entries = await fs.readdir(path.join(EXAMPLE_DIR, '.danteforge'));
    const expectedCoreFiles = [
      'AUTOFORGE_GUIDANCE.md',
      'CLARIFY.md',
      'CONSTITUTION.md',
      'PLAN.md',
      'SPEC.md',
      'STATE.yaml',
      'TASKS.md',
    ];
    const forbiddenEntries = [
      'assessment-history.json',
      'AUTOFORGE_PAUSED',
      'evidence',
      'loop-result.json',
      'memory.json',
      'scores',
      'wiki',
    ];

    for (const fileName of expectedCoreFiles) {
      assert.ok(entries.includes(fileName), `${fileName} should remain in the example snapshot`);
    }

    for (const forbidden of forbiddenEntries) {
      assert.ok(!entries.includes(forbidden), `${forbidden} should not remain in the example snapshot`);
    }
  });

  it('documents the actual artifact layout that ships in the repo', async () => {
    const readme = await fs.readFile(path.join(EXAMPLE_DIR, 'README.md'), 'utf8');

    assert.match(readme, /\.danteforge\/CONSTITUTION\.md/);
    assert.match(readme, /\.danteforge\/SPEC\.md/);
    assert.match(readme, /src\/cli\.js/);
    assert.match(readme, /tests\/todo\.test\.js/);
    assert.doesNotMatch(readme, /Commander\.js CLI entry point/);
    assert.doesNotMatch(readme, /reads the CONSTITUTION\.md, SPEC\.md, and `\.danteforge\/STATE\.yaml`/);
  });
  it('draws a clear line between what the example proves and what it does not', async () => {
    const readme = await fs.readFile(path.join(EXAMPLE_DIR, 'README.md'), 'utf8');

    assert.match(readme, /What this example proves/i);
    assert.match(readme, /What this example does not prove/i);
    assert.match(readme, /finished pipeline snapshot/i);
    assert.match(readme, /not a launch-ready product/i);
  });
});
