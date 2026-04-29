// Unit tests for verifyProofCorpus — recursive directory walk + per-file
// verification with skipped/verified/failed/errored buckets.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createReceipt, createEvidenceBundle, hashDict } from '@danteforge/evidence-chain';
import { verifyProofCorpus } from '../src/cli/commands/proof.js';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dfg-corpus-'));
}

test('verifyProofCorpus — empty directory reports 0 files', async () => {
  const dir = tmp();
  try {
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 0);
    assert.equal(report.verified, 0);
    assert.equal(report.failed, 0);
    assert.equal(report.skipped, 0);
    assert.equal(report.errored, 0);
    assert.equal(report.proofAdoptionRate, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — counts non-proof JSON as skipped', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'plain.json'), JSON.stringify({ score: 9.3, dim: 'maintainability' }));
    writeFileSync(join(dir, 'log.json'), JSON.stringify([{ event: 'a' }, { event: 'b' }]));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 2);
    assert.equal(report.verified, 0);
    assert.equal(report.failed, 0);
    assert.equal(report.skipped, 2);
    assert.equal(report.errored, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — counts valid bundle as verified', async () => {
  const dir = tmp();
  try {
    const bundle = createEvidenceBundle({
      bundleId: 'unit_test_bundle',
      evidence: [{ step: 'one' }, { step: 'two' }],
      gitSha: null,
    });
    writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 1);
    assert.equal(report.verified, 1);
    assert.equal(report.failed, 0);
    assert.equal(report.skipped, 0);
    assert.equal(report.proofAdoptionRate, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — counts valid receipt as verified', async () => {
  const dir = tmp();
  try {
    const receipt = createReceipt({
      receiptId: 'unit_test_receipt',
      action: 'unit.test',
      payload: { value: 42 },
      gitSha: null,
    });
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(receipt));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 1);
    assert.equal(report.verified, 1);
    assert.equal(report.skipped, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — counts proof-envelope-bearing manifest as verified', async () => {
  const dir = tmp();
  try {
    const payload = { pass: 99, name: 'unit', generatedAt: new Date().toISOString() };
    const manifest = {
      ...payload,
      proof: createEvidenceBundle({
        bundleId: 'unit_manifest',
        evidence: [{ ...payload }],
        gitSha: null,
      }),
    };
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 1);
    assert.equal(report.verified, 1);
    assert.equal(report.failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — detects tampered bundle as failed', async () => {
  const dir = tmp();
  try {
    const bundle = createEvidenceBundle({
      bundleId: 'tampered',
      evidence: [{ step: 'one', value: 1 }],
      gitSha: null,
    });
    // Tamper: replace the evidence after the bundle was sealed
    const tampered = { ...bundle, evidence: [{ step: 'one', value: 999 }] };
    writeFileSync(join(dir, 'tampered.json'), JSON.stringify(tampered));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 1);
    assert.equal(report.verified, 0);
    assert.equal(report.failed, 1);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].path.endsWith('tampered.json'), true);
    assert.ok(report.failures[0].errors.length > 0, 'failure entry should carry errors');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — counts unparseable JSON as errored', async () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, 'broken.json'), '{ this is not json');
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 1);
    assert.equal(report.errored, 1);
    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0].path.endsWith('broken.json'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — recurses into subdirectories', async () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, 'sub1', 'sub2'), { recursive: true });
    const bundle = createEvidenceBundle({ bundleId: 'nested', evidence: [{ a: 1 }], gitSha: null });
    writeFileSync(join(dir, 'sub1', 'sub2', 'deep.json'), JSON.stringify(bundle));
    writeFileSync(join(dir, 'top.json'), JSON.stringify({ note: 'plain' }));
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 2);
    assert.equal(report.verified, 1);
    assert.equal(report.skipped, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — adoption rate excludes errored files from denominator', async () => {
  const dir = tmp();
  try {
    const bundle = createEvidenceBundle({ bundleId: 'a', evidence: [{ x: 1 }], gitSha: null });
    writeFileSync(join(dir, 'good.json'), JSON.stringify(bundle));
    writeFileSync(join(dir, 'plain.json'), JSON.stringify({ note: 'plain' }));
    writeFileSync(join(dir, 'broken.json'), '{ broken');
    const report = await verifyProofCorpus(dir, { cwd: dir, skipGit: true });
    assert.equal(report.totalFiles, 3);
    assert.equal(report.verified, 1);
    assert.equal(report.skipped, 1);
    assert.equal(report.errored, 1);
    // Adoption rate = verified / (verified + failed + skipped) = 1/2 = 0.5
    assert.equal(report.proofAdoptionRate, 0.5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyProofCorpus — payload-hash-only sanity check via hashDict', async () => {
  const dir = tmp();
  try {
    const payload = { x: 1, y: 'two' };
    const expected = hashDict(payload);
    assert.match(expected, /^[a-f0-9]{64}$/);
    // Sanity: same payload -> same hash, helps confirm test deps
    assert.equal(hashDict({ y: 'two', x: 1 }), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
