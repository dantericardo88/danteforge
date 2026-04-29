import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { timeMachine } from '../src/cli/commands/time-machine.js';

function initGit(cwd: string): void {
  execSync('git init -q', { cwd });
  execSync('git -c user.email=t@t -c user.name=Test commit --allow-empty -q -m initial', { cwd });
}

function write(rel: string, body: string, cwd: string): void {
  const target = resolve(cwd, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('time-machine CLI command', () => {
  let workspace: string;
  let lines: string[];

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'danteforge-time-machine-cli-'));
    initGit(workspace);
    lines = [];
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('commits, verifies, restores, and fails verification after tampering', async () => {
    write('doc.txt', 'original\n', workspace);

    await timeMachine({
      action: 'commit',
      cwd: workspace,
      path: ['doc.txt'],
      label: 'cli-fixture',
      _stdout: line => lines.push(line),
      _now: () => '2026-04-29T10:00:00.000Z',
    });
    const commitReport = JSON.parse(lines.join('\n')) as { commitId: string };
    assert.ok(commitReport.commitId);

    lines = [];
    await timeMachine({ action: 'verify', cwd: workspace, _stdout: line => lines.push(line) });
    assert.equal(JSON.parse(lines.join('\n')).valid, true);

    lines = [];
    const outDir = resolve(workspace, 'restored');
    await timeMachine({
      action: 'restore',
      cwd: workspace,
      commit: commitReport.commitId,
      out: outDir,
      _stdout: line => lines.push(line),
    });
    assert.equal(readFileSync(resolve(outDir, 'doc.txt'), 'utf8'), 'original\n');

    const commitPath = resolve(workspace, '.danteforge/time-machine/commits', `${commitReport.commitId}.json`);
    const tampered = JSON.parse(readFileSync(commitPath, 'utf8'));
    tampered.label = 'tampered';
    writeFileSync(commitPath, JSON.stringify(tampered, null, 2));

    lines = [];
    await timeMachine({ action: 'verify', cwd: workspace, _stdout: line => lines.push(line) });
    assert.equal(JSON.parse(lines.join('\n')).valid, false);
  });
});
