// verify --light mode tests
// Tests the --light flag that substitutes pipeline execution checks with
// npm test + npm run build gates, enabling self-verification for CLI tools.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verify } from '../src/cli/commands/verify.js';

const PASS: (cwd: string) => Promise<boolean> = async () => true;
const FAIL: (cwd: string) => Promise<boolean> = async () => false;

async function makeTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-vlight-'));
  const sd = path.join(dir, '.danteforge');
  await fs.mkdir(sd, { recursive: true });

  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({
    name: 'test-project',
    version: '1.0.0',
  }));

  // Omit 'Detected project type' from CURRENT_STATE.md so the projectType
  // freshness check is skipped (metadata.projectType will be undefined)
  await fs.writeFile(path.join(sd, 'CURRENT_STATE.md'), [
    '# CURRENT_STATE.md',
    '## Project Overview',
    '- **Name**: test-project',
    '- **Version**: 1.0.0',
  ].join('\n'));

  for (const artifact of ['CONSTITUTION.md', 'SPEC.md', 'CLARIFY.md', 'PLAN.md', 'TASKS.md']) {
    await fs.writeFile(path.join(sd, artifact), `# ${artifact}\n`);
  }

  await fs.writeFile(path.join(sd, 'STATE.yaml'), [
    'project: test-project',
    'lastHandoff: forge -> next',
    'workflowStage: clarify',   // NOT execution-complete — light mode must bypass this
    'currentPhase: 0',
    'constitution: CONSTITUTION.md',
    'tasks: {}',                 // empty — light mode must bypass this
    'auditLog:',
    '  - "2026-04-14T00:00:00.000Z | init: project created"',
    'profile: balanced',
  ].join('\n'));

  return dir;
}

async function withTempProject(fn: (cwd: string, sd: string) => Promise<void>): Promise<void> {
  const dir = await makeTempProject();
  try {
    await fn(dir, path.join(dir, '.danteforge'));
  } finally {
    // Reset exitCode in case verify set it to 1 (expected in failure-case tests)
    process.exitCode = 0;
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe('verify --light mode', () => {
  it('passes when tests and build both succeed', async () => {
    await withTempProject(async (cwd, sd) => {
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: pass'), 'should set lastVerifyStatus: pass');
    });
  });

  it('fails when test suite fails', async () => {
    await withTempProject(async (cwd, sd) => {
      await verify({ light: true, cwd, _runTests: FAIL, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(!yaml.includes('lastVerifyStatus: pass'), 'should NOT be pass when tests fail');
      assert.ok(yaml.includes('lastVerifyStatus: fail'), 'should be fail');
    });
  });

  it('fails when build fails', async () => {
    await withTempProject(async (cwd, sd) => {
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: FAIL });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(!yaml.includes('lastVerifyStatus: pass'), 'should NOT be pass when build fails');
    });
  });

  it('skips workflowStage check — clarify stage does not block light mode', async () => {
    await withTempProject(async (cwd, sd) => {
      // STATE.yaml has workflowStage: clarify which would block normal verify
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(
        !yaml.includes('not execution-complete'),
        'workflowStage gate should not fire in light mode',
      );
    });
  });

  it('skips tasks[1] check — empty tasks does not block light mode', async () => {
    await withTempProject(async (cwd, sd) => {
      // STATE.yaml has tasks: {} which would block normal verify
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(!yaml.includes('No phase 1 tasks'), 'tasks gate should not fire in light mode');
    });
  });

  it('still checks constitution — missing constitution blocks even in light mode', async () => {
    await withTempProject(async (cwd, sd) => {
      // Overwrite STATE.yaml without constitution field
      await fs.writeFile(path.join(sd, 'STATE.yaml'), [
        'project: test-project',
        'lastHandoff: forge -> next',
        'workflowStage: clarify',
        'currentPhase: 0',
        'tasks: {}',
        'auditLog:',
        '  - "2026-04-14T00:00:00.000Z | init: project created"',
        'profile: balanced',
      ].join('\n'));

      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(!yaml.includes('lastVerifyStatus: pass'), 'should fail when constitution missing');
      assert.ok(yaml.includes('lastVerifyStatus: fail'), 'should be fail');
    });
  });

  it('still checks that required artifacts exist — missing SPEC.md blocks even in light mode', async () => {
    await withTempProject(async (cwd, sd) => {
      await fs.rm(path.join(sd, 'SPEC.md'));
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(!yaml.includes('lastVerifyStatus: pass'), 'should fail when SPEC.md missing');
    });
  });

  it('sets lastVerifyStatus = pass and persists receipt path on full success', async () => {
    await withTempProject(async (cwd, sd) => {
      await verify({ light: true, cwd, _runTests: PASS, _runBuild: PASS });
      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: pass'), 'lastVerifyStatus should be pass');
      // Either lastVerifiedAt or lastVerifyReceiptPath is written on success
      const hasTimestamp = yaml.includes('lastVerifiedAt') || yaml.includes('lastVerifyReceiptPath');
      assert.ok(hasTimestamp, 'timestamp or receipt path should be recorded');
    });
  });
});
