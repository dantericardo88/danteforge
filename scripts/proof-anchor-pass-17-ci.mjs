// Proof-anchor Pass 17 — corpus integrity CI integration.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

function getGitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return null; }
}

function readUtf8(rel) {
  const abs = resolve(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`Missing: ${rel}`);
  return readFileSync(abs, 'utf-8');
}

const checkScriptContent = readUtf8('scripts/check-proof-integrity.mjs');
const checkTestContent = readUtf8('tests/check-proof-integrity.test.ts');
const packageJsonContent = readUtf8('package.json');

// Run the check live and capture its output for the manifest
let liveCheckOutput;
try {
  liveCheckOutput = execSync('node scripts/check-proof-integrity.mjs --json', { cwd: ROOT, encoding: 'utf-8' });
} catch (e) {
  liveCheckOutput = e.stdout?.toString() ?? '';
}
const liveCheckReport = JSON.parse(liveCheckOutput);

const manifest = {
  schemaVersion: 1,
  pass: 17,
  passName: 'CI integration of proof corpus integrity check (Pass 17)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  integration: {
    npmScript: 'check:proof-integrity',
    scriptPath: 'scripts/check-proof-integrity.mjs',
    scriptHash: sha256(checkScriptContent),
    wiredInto: 'verify:all',
    verifyAllChain: 'npm run verify && npm run check:proof-integrity && npm run build && npm --prefix vscode-extension run verify',
    placement: 'between verify (which runs typecheck/lint/anti-stub/test) and build — fast (~1s) and catches drift before any build artifacts are produced.',
    exitContract: { '0': 'CLEAN — verified+skipped only', '1': 'DEGRADED — at least one failed or errored receipt' },
    cliFlags: ['<dir> (positional, defaults to .danteforge/evidence)', '--json (machine-readable output)'],
  },

  testCoverage: {
    file: 'tests/check-proof-integrity.test.ts',
    fileHash: sha256(checkTestContent),
    testCount: 7,
    cases: [
      'empty directory exits 0 (CLEAN)',
      'directory with valid receipt exits 0',
      'tampered bundle exits 1 (DEGRADED)',
      'unparseable JSON exits 1 (errored)',
      'non-proof JSON only is CLEAN (pre-Pass-11 receipts contract)',
      '--json flag emits machine-readable output',
      'recurses into subdirectories',
    ],
    spawnsRealSubprocess: true,
  },

  liveCheckResult: {
    integrityStatus: liveCheckReport.failed === 0 && liveCheckReport.errored === 0 ? 'CLEAN' : 'DEGRADED',
    totalFiles: liveCheckReport.totalFiles,
    verified: liveCheckReport.verified,
    failed: liveCheckReport.failed,
    skipped: liveCheckReport.skipped,
    errored: liveCheckReport.errored,
    proofAdoptionRate: liveCheckReport.proofAdoptionRate,
  },

  packageJsonHash: sha256(packageJsonContent),

  what_this_changes: [
    'verify:all chain now refuses to build if any proof-bearing receipt fails verification',
    'Tampered evidence anywhere under .danteforge/evidence/ becomes a blocking CI failure',
    'Adoption rate is observable via `npm run check:proof-integrity` for any future score-arc tracking',
    'Founder/CI can run `node scripts/check-proof-integrity.mjs --json` to get machine-readable status',
  ],

  what_this_does_NOT_change: [
    'Pre-commit hook (hooks/pre-commit.mjs) untouched — agent does not modify user-owned operational hooks',
    'Default `npm run verify` chain unchanged — integrity check is in `verify:all`, not `verify`',
    'Pre-Pass-11 receipts without proof envelopes still pass (skipped, not failed) — backfill is a deferred forensic-provenance feature',
  ],
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_17_ci_integration',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-17-ci-integration.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored CI integration manifest: ${outPath}`);
console.log(`  npm script:              ${manifest.integration.npmScript}`);
console.log(`  wired into:              ${manifest.integration.wiredInto}`);
console.log(`  test count:              ${manifest.testCoverage.testCount}`);
console.log(`  live check status:       ${manifest.liveCheckResult.integrityStatus}`);
console.log(`  live verified/failed:    ${manifest.liveCheckResult.verified}/${manifest.liveCheckResult.failed}`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:       ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
