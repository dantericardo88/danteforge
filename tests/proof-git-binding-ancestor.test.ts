// Pass 18.5 — gitSha binding semantic tests.
//
// Verifies the new ancestor-continuity check + the --strict-git-binding mode.
// Each test creates a real temp git repo so `git merge-base --is-ancestor` runs against actual history.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEvidenceBundle } from '@danteforge/evidence-chain';
import { verifyProofFile } from '../src/cli/commands/proof.js';

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dfg-git-binding-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name Test', { cwd: dir });
  // Genesis commit
  writeFileSync(join(dir, 'README.md'), '# Test\n');
  execSync('git add . && git commit -q -m initial', { cwd: dir });
  return dir;
}

function gitSha(repo: string, ref = 'HEAD'): string {
  return execSync(`git rev-parse ${ref}`, { cwd: repo, encoding: 'utf8' }).trim();
}

function commit(repo: string, msg: string, fileName = 'file.txt'): string {
  writeFileSync(join(repo, fileName), `${msg}\n`);
  execSync(`git add ${fileName} && git commit -q -m "${msg}"`, { cwd: repo });
  return gitSha(repo);
}

function writeManifest(repo: string, gitShaToBind: string | null, name = 'manifest.json'): string {
  const target = join(repo, name);
  const payload = { schemaVersion: 1, runId: 'test_run', generatedAt: new Date().toISOString(), gitSha: gitShaToBind };
  const proof = createEvidenceBundle({
    bundleId: 'test_bundle',
    gitSha: gitShaToBind,
    evidence: [payload],
    createdAt: payload.generatedAt,
  });
  writeFileSync(target, JSON.stringify({ ...payload, proof }, null, 2));
  return target;
}

test('verifyProofFile — manifest gitSha equals HEAD: valid (default mode)', async () => {
  const repo = makeRepo();
  try {
    const head = gitSha(repo);
    const manifest = writeManifest(repo, head);
    const report = await verifyProofFile(manifest, { cwd: repo });
    assert.equal(report.checks.gitShaBinding.valid, true);
    assert.equal(report.valid, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — manifest gitSha is ancestor of HEAD: valid (default mode)', async () => {
  const repo = makeRepo();
  try {
    const ancestor = gitSha(repo);
    commit(repo, 'second commit');
    commit(repo, 'third commit');
    // ancestor is now 2 commits behind HEAD
    const manifest = writeManifest(repo, ancestor);
    const report = await verifyProofFile(manifest, { cwd: repo });
    assert.equal(report.checks.gitShaBinding.valid, true, 'ancestor should be valid in default mode');
    assert.equal(report.valid, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — manifest gitSha is parallel branch (NOT ancestor of HEAD): invalid', async () => {
  const repo = makeRepo();
  try {
    // Create a branch with its own commit, then return to main and make a divergent commit
    execSync('git checkout -q -b feature', { cwd: repo });
    const featureSha = commit(repo, 'feature commit');
    execSync('git checkout -q -', { cwd: repo });
    commit(repo, 'main divergent');
    // featureSha is on a parallel branch; not in HEAD's ancestry
    const manifest = writeManifest(repo, featureSha);
    const report = await verifyProofFile(manifest, { cwd: repo });
    assert.equal(report.checks.gitShaBinding.valid, false, 'parallel branch sha should NOT be valid');
    assert.match((report.checks.gitShaBinding as { reason?: string }).reason ?? '', /ancestor|valid commit/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — strict mode: requires equality, ancestor is rejected', async () => {
  const repo = makeRepo();
  try {
    const ancestor = gitSha(repo);
    commit(repo, 'newer commit');
    const manifest = writeManifest(repo, ancestor);
    const report = await verifyProofFile(manifest, { cwd: repo, strictGitBinding: true });
    assert.equal(report.checks.gitShaBinding.valid, false, 'strict mode should reject ancestor');
    assert.match((report.checks.gitShaBinding as { reason?: string }).reason ?? '', /strict mode/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — strict mode: equality still passes', async () => {
  const repo = makeRepo();
  try {
    const head = gitSha(repo);
    const manifest = writeManifest(repo, head);
    const report = await verifyProofFile(manifest, { cwd: repo, strictGitBinding: true });
    assert.equal(report.checks.gitShaBinding.valid, true);
    assert.equal(report.valid, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — non-existent gitSha (e.g., manifest from another repo): invalid with helpful reason', async () => {
  const repo = makeRepo();
  try {
    // Use a syntactically-valid SHA that isn't in this repo's history
    const fakeSha = '0123456789012345678901234567890123456789';
    const manifest = writeManifest(repo, fakeSha);
    const report = await verifyProofFile(manifest, { cwd: repo });
    assert.equal(report.checks.gitShaBinding.valid, false);
    assert.match((report.checks.gitShaBinding as { reason?: string }).reason ?? '', /not a known commit|ancestor/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — null gitSha skipped honestly (empty/no-binding manifest)', async () => {
  const repo = makeRepo();
  try {
    const manifest = writeManifest(repo, null);
    const report = await verifyProofFile(manifest, { cwd: repo });
    assert.equal(report.checks.gitShaBinding.skipped, true);
    assert.equal(report.checks.gitShaBinding.valid, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('verifyProofFile — skipGit option overrides everything', async () => {
  const repo = makeRepo();
  try {
    const fakeSha = '0123456789012345678901234567890123456789';
    const manifest = writeManifest(repo, fakeSha);
    const report = await verifyProofFile(manifest, { cwd: repo, skipGit: true });
    assert.equal(report.checks.gitShaBinding.skipped, true);
    assert.equal(report.checks.gitShaBinding.valid, true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
