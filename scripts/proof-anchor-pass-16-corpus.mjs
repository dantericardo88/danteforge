// Proof-anchor Pass 16 corpus integrity report.
//
// Reads the corpus-integrity output produced by `forge proof --verify-all .danteforge/evidence`,
// wraps in an evidence bundle, and emits a verifiable manifest at
// .danteforge/evidence/pass-16-corpus-integrity.json.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const corpusReportPath = process.argv[2] ?? resolve('C:/tmp/pass16-corpus.json');
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

if (!existsSync(corpusReportPath)) {
  throw new Error(`Corpus report not found: ${corpusReportPath}. Run \`forge proof --verify-all .danteforge/evidence > ${corpusReportPath}\` first.`);
}

function getGitSha() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim(); }
  catch { return null; }
}

const corpusReport = JSON.parse(readFileSync(corpusReportPath, 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 16,
  passName: 'Corpus-wide proof verification (Pass 16)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),
  cli: 'danteforge proof --verify-all .danteforge/evidence',
  corpus: {
    root: corpusReport.root,
    scannedAt: corpusReport.scannedAt,
    totalFiles: corpusReport.totalFiles,
    verified: corpusReport.verified,
    failed: corpusReport.failed,
    skipped: corpusReport.skipped,
    errored: corpusReport.errored,
    proofAdoptionRate: corpusReport.proofAdoptionRate,
    failureCount: corpusReport.failures?.length ?? 0,
    errorCount: corpusReport.errors?.length ?? 0,
  },
  interpretation: {
    integrityStatus: corpusReport.failed === 0 && corpusReport.errored === 0 ? 'CLEAN' : 'DEGRADED',
    proofAdoptionStage: corpusReport.proofAdoptionRate < 0.05
      ? 'early — most evidence predates Pass 11 proof-spine'
      : corpusReport.proofAdoptionRate < 0.5
        ? 'partial — proof spine wired into newer artifacts only'
        : 'mature — majority of corpus is proof-anchored',
    nextActions: [
      'Continue emitting proof-anchored artifacts in every pass (Passes 11-15 already do)',
      'Optionally back-fill pre-Pass-11 receipts with proof envelopes if forensic provenance becomes important',
      'Wire `forge proof --verify-all` into CI / pre-commit so the integrity stays CLEAN',
    ],
  },
  testEvidence: {
    unitTestFile: 'tests/proof-verify-all.test.ts',
    unitTestCount: 10,
    cliFlag: '--verify-all <dir>',
    exitCodeOnFailure: 1,
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_16_corpus_integrity',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-16-corpus-integrity.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored corpus integrity manifest: ${outPath}`);
console.log(`  scanned files:           ${manifest.corpus.totalFiles}`);
console.log(`  verified:                ${manifest.corpus.verified}`);
console.log(`  failed:                  ${manifest.corpus.failed}`);
console.log(`  skipped (no proof):      ${manifest.corpus.skipped}`);
console.log(`  errored:                 ${manifest.corpus.errored}`);
console.log(`  proof adoption rate:     ${(manifest.corpus.proofAdoptionRate * 100).toFixed(1)}%`);
console.log(`  integrity status:        ${manifest.interpretation.integrityStatus}`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:       ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
