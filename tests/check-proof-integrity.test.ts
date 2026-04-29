// Integration tests for scripts/check-proof-integrity.mjs.
// Spawns the script as a subprocess against fixture directories so we test
// the CI-shaped behavior (exit codes, stderr on failure, JSON mode).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReceipt, createEvidenceBundle } from '@danteforge/evidence-chain';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'check-proof-integrity.mjs');

function runScript(args: string[] = [], cwd: string = process.cwd()): { code: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [SCRIPT_PATH, ...args], {
    cwd,
    encoding: 'utf-8',
    timeout: 60_000,
  });
  return {
    code: res.status ?? -1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dfg-integrity-'));
}

test('check-proof-integrity — empty directory exits 0 (CLEAN)', () => {
  const dir = tmp();
  try {
    const result = runScript([dir]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /CLEAN/);
    assert.match(result.stdout, /scanned=0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — directory with valid receipt exits 0', () => {
  const dir = tmp();
  try {
    const receipt = createReceipt({
      receiptId: 'integrity_test_receipt',
      action: 'integrity.test',
      payload: { value: 1 },
      gitSha: null,
    });
    writeFileSync(join(dir, 'good-receipt.json'), JSON.stringify(receipt));
    const result = runScript([dir]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /CLEAN/);
    assert.match(result.stdout, /verified=1/);
    assert.match(result.stdout, /failed=0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — tampered bundle exits 1 (DEGRADED)', () => {
  const dir = tmp();
  try {
    const bundle = createEvidenceBundle({
      bundleId: 'tampered_bundle',
      evidence: [{ value: 1 }],
      gitSha: null,
    });
    const tampered = { ...bundle, evidence: [{ value: 999 }] };
    writeFileSync(join(dir, 'tampered.json'), JSON.stringify(tampered));
    const result = runScript([dir]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /DEGRADED/);
    assert.match(result.stderr, /FAILED verification/);
    assert.match(result.stderr, /tampered\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — unparseable JSON exits 1 (errored)', () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'broken.json'), '{ not json');
    const result = runScript([dir]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /errored=1/);
    assert.match(result.stderr, /UNREADABLE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — non-proof JSON only is CLEAN', () => {
  // Important: pre-Pass-11 receipts don't carry proof envelopes; they should
  // count as skipped (allowed) not failed. This test guards that contract.
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'old-receipt.json'), JSON.stringify({ score: 9.3, dim: 'test' }));
    writeFileSync(join(dir, 'old-log.json'), JSON.stringify([{ event: 'a' }]));
    const result = runScript([dir]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /CLEAN/);
    assert.match(result.stdout, /skipped=2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — --json flag emits machine-readable output', () => {
  const dir = tmp();
  try {
    const bundle = createEvidenceBundle({ bundleId: 'json_test', evidence: [{ a: 1 }], gitSha: null });
    writeFileSync(join(dir, 'b.json'), JSON.stringify(bundle));
    const result = runScript([dir, '--json']);
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.verified, 1);
    assert.equal(parsed.failed, 0);
    assert.equal(parsed.totalFiles, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-proof-integrity — recurses into subdirectories', () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const bundle = createEvidenceBundle({ bundleId: 'nested', evidence: [{ a: 1 }], gitSha: null });
    writeFileSync(join(dir, 'sub', 'nested.json'), JSON.stringify(bundle));
    const result = runScript([dir, '--json']);
    assert.equal(result.code, 0);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.verified, 1);
    assert.equal(parsed.totalFiles, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
