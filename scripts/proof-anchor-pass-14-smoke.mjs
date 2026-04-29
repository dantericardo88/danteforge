// Proof-anchor Pass 14 install/pack smoke-test outcome.
//
// Captures the smoke-test results JSON, the tarball hash, and the package version,
// then wraps in an evidence bundle for verification via `danteforge proof --verify`.
//
// Usage: node scripts/proof-anchor-pass-14-smoke.mjs <path-to-tarball> <smoke-result-json>

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const tarballPath = process.argv[2] ?? resolve('C:/tmp/danteforge-evidence-chain-1.0.0.tgz');
const smokeResultPath = process.argv[3] ?? resolve('C:/tmp/evidence-chain-consumer-test/smoke-result.json');

const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

if (!existsSync(tarballPath)) throw new Error(`Tarball not found: ${tarballPath}`);

function getGitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return null; }
}

const tarballBytes = readFileSync(tarballPath);
const tarballHash = sha256(new Uint8Array(tarballBytes));
const tarballSize = statSync(tarballPath).size;

let smokeResult;
if (existsSync(smokeResultPath)) {
  smokeResult = JSON.parse(readFileSync(smokeResultPath, 'utf-8'));
} else {
  // No saved JSON; reconstruct minimum metadata
  smokeResult = {
    package: '@danteforge/evidence-chain',
    version: '1.0.0',
    schemaVersion: 'evidence-chain.v1',
    note: 'smoke-result.json not found; ran from console output instead',
  };
}

const manifest = {
  schemaVersion: 1,
  pass: 14,
  passName: 'External-consumer install/pack smoke test (Pass 14)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),
  tarball: {
    path: tarballPath.replaceAll('\\', '/'),
    sizeBytes: tarballSize,
    sha256: tarballHash,
    npmName: smokeResult.package,
    npmVersion: smokeResult.version,
  },
  smokeTest: smokeResult,
  consumerProjectPath: 'C:/tmp/evidence-chain-consumer-test (outside repo, ESM module project)',
  smokeScript: 'scripts/smoke-evidence-chain-external.mjs',
  conclusion: smokeResult.status === 'pass'
    ? 'External-consumer install + import + tamper-detection all work as documented. Package is consumer-ready.'
    : 'Smoke test reported failures; package is NOT consumer-ready.',
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_14_install_smoke',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-14-install-smoke.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored smoke manifest: ${outPath}`);
console.log(`  tarball sha256:        ${tarballHash.slice(0, 16)}...`);
console.log(`  tarball size:          ${tarballSize} bytes`);
console.log(`  smoke status:          ${smokeResult.status ?? 'unknown'}`);
if (smokeResult.passed !== undefined) {
  console.log(`  smoke pass count:      ${smokeResult.passed}/${smokeResult.total}`);
}
console.log(`  proof bundle:          ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:    ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:     ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:               ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
