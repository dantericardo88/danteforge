// verify --light mode tests
// Tests the --light flag that substitutes pipeline execution checks with
// npm test + npm run build gates, enabling self-verification for CLI tools.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verify } from '../src/cli/commands/verify.js';
import { computeCommandCheckFingerprint, writeCommandCheckReceipt } from '../src/core/command-check-receipts.js';

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

async function seedVerifyReceipt(sd: string, overrides: Record<string, unknown> = {}): Promise<void> {
  const receiptDir = path.join(sd, 'evidence', 'verify');
  await fs.mkdir(receiptDir, { recursive: true });
  await fs.writeFile(
    path.join(receiptDir, 'latest.json'),
    JSON.stringify({
      status: 'pass',
      timestamp: '2026-04-20T00:00:00.000Z',
      gitSha: null,
      currentStateFresh: true,
      ...overrides,
    }, null, 2),
    'utf8',
  );
}

async function initializeGitRepo(cwd: string): Promise<void> {
  execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'DanteForge Tests'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'seed'], { cwd, stdio: 'ignore' });
}

describe('verify --light mode', () => {
  it('awaits the injected success-lessons capture on passing verify', async () => {
    await withTempProject(async (cwd) => {
      let captured = false;

      await verify({
        light: true,
        cwd,
        _runTests: PASS,
        _runBuild: PASS,
        _captureSuccessLessons: async () => {
          captured = true;
        },
      });

      assert.strictEqual(captured, true);
    });
  });

  it('skips failure-lesson capture in json mode so machine output is not blocked', async () => {
    await withTempProject(async (cwd) => {
      let captured = false;
      const writes: string[] = [];
      const originalWrite = process.stdout.write.bind(process.stdout);

      process.stdout.write = ((chunk: string | Uint8Array) => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write;

      try {
        await verify({
          light: true,
          json: true,
          cwd,
          _runTests: FAIL,
          _runBuild: PASS,
          _captureVerifyLessons: async () => {
            captured = true;
          },
        });
      } finally {
        process.stdout.write = originalWrite;
      }

      assert.strictEqual(captured, false, 'json mode should not block on failure-lesson capture');
      assert.ok(writes.some(output => output.includes('"status":"fail"')), 'json mode should still emit machine-readable failure output');
    });
  });

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

  it('uses CONSTITUTION.md as authoritative when the state pointer is missing', async () => {
    await withTempProject(async (cwd, sd) => {
      // Overwrite STATE.yaml without constitution field, but keep CONSTITUTION.md present.
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
      assert.ok(yaml.includes('lastVerifyStatus: pass'), 'artifact-backed constitution should allow verify to pass');
      assert.ok(yaml.includes('constitution: CONSTITUTION.md'), 'verify should repair the missing constitution pointer');
    });
  });

  it('still fails when both the constitution pointer and CONSTITUTION.md are missing', async () => {
    await withTempProject(async (cwd, sd) => {
      await fs.rm(path.join(sd, 'CONSTITUTION.md'));
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
      assert.ok(!yaml.includes('lastVerifyStatus: pass'), 'should fail when constitution is missing everywhere');
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

  it('switches to receipt-backed execution gates when workflow bookkeeping is stale', async () => {
    await withTempProject(async (cwd, sd) => {
      await seedVerifyReceipt(sd);

      await verify({ cwd, _runTests: PASS, _runBuild: PASS });

      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: pass'), 'receipt-backed verification should pass');
      assert.ok(yaml.includes('workflowStage: verify'), 'loadState should reconcile the workflow stage to verify');
    });
  });

  it('keeps failing on stale bookkeeping when there is no verify receipt to anchor repo reality', async () => {
    await withTempProject(async (cwd, sd) => {
      await verify({ cwd, _runTests: PASS, _runBuild: PASS });

      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: fail'), 'missing receipt-backed evidence should keep full verify fail-closed');
    });
  });

  it('reuses fresh command-check receipts instead of rerunning failing scripts for an unchanged worktree', async () => {
    await withTempProject(async (cwd, sd) => {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'receipt-fast-path-test',
          version: '1.0.0',
          type: 'module',
          scripts: {
            test: 'node -e "process.exit(1)"',
            build: 'node -e "process.exit(1)"',
          },
        }, null, 2),
        'utf8',
      );
      await fs.writeFile(path.join(cwd, '.gitignore'), '.danteforge/\n', 'utf8');
      await initializeGitRepo(cwd);
      await seedVerifyReceipt(sd);

      const fingerprint = await computeCommandCheckFingerprint(cwd);
      await writeCommandCheckReceipt({
        id: 'test',
        command: 'npm test',
        status: 'pass',
        gitSha: fingerprint.gitSha,
        worktreeFingerprint: fingerprint.worktreeFingerprint,
      }, cwd);
      await writeCommandCheckReceipt({
        id: 'build',
        command: 'npm run build',
        status: 'pass',
        gitSha: fingerprint.gitSha,
        worktreeFingerprint: fingerprint.worktreeFingerprint,
      }, cwd);

      await verify({ cwd });

      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: pass'), 'fresh command receipts should allow verify to pass');
      const latestReceiptRaw = await fs.readFile(path.join(sd, 'evidence', 'verify', 'latest.json'), 'utf8');
      const latestReceipt = JSON.parse(latestReceiptRaw) as { passed?: string[] };
      assert.ok(
        latestReceipt.passed?.some(entry => entry.includes('reused fresh test proof')),
        'verify receipt should record that test proof was reused',
      );
      assert.ok(
        latestReceipt.passed?.some(entry => entry.includes('reused fresh build proof')),
        'verify receipt should record that build proof was reused',
      );
    });
  });

  it('fails fast from fresh failing command-check receipts instead of rerunning passing scripts', async () => {
    await withTempProject(async (cwd, sd) => {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'receipt-fail-fast-test',
          version: '1.0.0',
          type: 'module',
          scripts: {
            test: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
          },
        }, null, 2),
        'utf8',
      );
      await fs.writeFile(path.join(cwd, '.gitignore'), '.danteforge/\n', 'utf8');
      await initializeGitRepo(cwd);
      await seedVerifyReceipt(sd);

      const fingerprint = await computeCommandCheckFingerprint(cwd);
      await writeCommandCheckReceipt({
        id: 'test',
        command: 'npm test',
        status: 'fail',
        gitSha: fingerprint.gitSha,
        worktreeFingerprint: fingerprint.worktreeFingerprint,
      }, cwd);
      await writeCommandCheckReceipt({
        id: 'build',
        command: 'npm run build',
        status: 'fail',
        gitSha: fingerprint.gitSha,
        worktreeFingerprint: fingerprint.worktreeFingerprint,
      }, cwd);

      await verify({ cwd });

      const yaml = await fs.readFile(path.join(sd, 'STATE.yaml'), 'utf8');
      assert.ok(yaml.includes('lastVerifyStatus: fail'), 'fresh failing command receipts should keep verify fail-closed');
      const latestReceiptRaw = await fs.readFile(path.join(sd, 'evidence', 'verify', 'latest.json'), 'utf8');
      const latestReceipt = JSON.parse(latestReceiptRaw) as { failures?: string[] };
      assert.ok(
        latestReceipt.failures?.some(entry => entry.includes('test suite failed')),
        'verify receipt should surface the failing npm test proof',
      );
      assert.ok(
        latestReceipt.failures?.some(entry => entry.includes('build failed')),
        'verify receipt should surface the failing npm run build proof',
      );
    });
  });

  it('explains stale proof fallback in json mode before rerunning fast scripts', async () => {
    await withTempProject(async (cwd, sd) => {
      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'receipt-diagnostic-test',
          version: '1.0.0',
          type: 'module',
          scripts: {
            test: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
          },
        }, null, 2),
        'utf8',
      );
      await fs.writeFile(path.join(cwd, 'tracked.txt'), 'seed\n', 'utf8');
      await fs.writeFile(path.join(cwd, '.gitignore'), '.danteforge/\n', 'utf8');
      await initializeGitRepo(cwd);
      await seedVerifyReceipt(sd);

      await writeCommandCheckReceipt({
        id: 'test',
        command: 'npm test',
        status: 'pass',
      }, cwd);
      await writeCommandCheckReceipt({
        id: 'build',
        command: 'npm run build',
        status: 'pass',
      }, cwd);

      await fs.writeFile(path.join(cwd, 'tracked.txt'), 'changed\n', 'utf8');

      const stdoutWrites: string[] = [];
      const stderrWrites: string[] = [];
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      const originalStderrWrite = process.stderr.write.bind(process.stderr);

      process.stdout.write = ((chunk: string | Uint8Array) => {
        stdoutWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Uint8Array) => {
        stderrWrites.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as typeof process.stderr.write;

      try {
        await verify({ cwd, json: true });
      } finally {
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
      }

      const jsonOutput = stdoutWrites.join('');
      assert.ok(jsonOutput.includes('"status":"pass"'), 'json verify should still succeed after rerunning fast proofs');
      const stderrOutput = stderrWrites.join('');
      assert.match(stderrOutput, /fresh test proof unavailable \(the worktree changed since the last proof\); running npm test/);
      assert.match(stderrOutput, /fresh build proof unavailable \(the worktree changed since the last proof\); running npm run build/);
    });
  });
});
