// Proof-anchor Pass 23 — adversarial review + remediation cycle.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
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

const reviewPath = resolve(ROOT, '.danteforge/PASS_23_ADVERSARIAL_REVIEW.md');
const receiptPath = resolve(ROOT, '.danteforge/PASS_23_ADVERSARIAL_REVIEW_RECEIPT.md');
const tmValidationHash = sha256(readFileSync(resolve(ROOT, 'src/core/time-machine-validation.ts'), 'utf-8'));
const remediationTestHash = sha256(readFileSync(resolve(ROOT, 'tests/time-machine-delegate52-substrate-and-content.test.ts'), 'utf-8'));
const reviewHash = existsSync(reviewPath) ? sha256(readFileSync(reviewPath, 'utf-8')) : null;
const receiptHash = sha256(readFileSync(receiptPath, 'utf-8'));
const docHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/time-machine-empirical-validation-v1.md'), 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 23,
  passName: 'Adversarial review + remediation cycle (3 CRITICAL fixes in code, 6 HIGH/MEDIUM/LOW in doc)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  reviewer: {
    disposition: 'hostile-but-honest (Microsoft Research peer-review hat)',
    reviewFile: '.danteforge/PASS_23_ADVERSARIAL_REVIEW.md',
    reviewHash,
  },

  findings: {
    total: 9,
    bySeverity: { critical: 3, high: 3, medium: 2, low: 1 },
    items: [
      { id: 'F-001', severity: 'CRITICAL', title: 'Time Machine substrate never invoked during DELEGATE-52 round-trips', remediation: 'fixed_in_code', commitMechanism: 'createTimeMachineCommit wired into runDelegate52DomainRoundTrip' },
      { id: 'F-002', severity: 'CRITICAL', title: 'Imported dataset content discarded; synthetic stub used', remediation: 'fixed_in_code', commitMechanism: 'buildImportedDocumentMap + extractDelegate52DocumentContent feed real basic_state/ content' },
      { id: 'F-003', severity: 'CRITICAL', title: 'Paper §5.6 "100K verified" had no proof-anchored evidence', remediation: 'fixed_in_doc_plus_benchmark_scheduled', evidenceFile: '.danteforge/evidence/pass-23-runs/f100k-result.json' },
      { id: 'F-004', severity: 'HIGH', title: '100 deterministic re-runs misframed as "100 fresh-chain runs"', remediation: 'fixed_in_doc' },
      { id: 'F-005', severity: 'HIGH', title: 'Dry-run identity simulator tautology', remediation: 'fixed_in_doc' },
      { id: 'F-006', severity: 'HIGH', title: 'Cost model under-counts; no model SKU pin', remediation: 'fixed_in_doc_plus_appendix' },
      { id: 'F-007', severity: 'MEDIUM', title: 'runClassG source disagrees with paper §5.7', remediation: 'documented_as_limitation' },
      { id: 'F-008', severity: 'MEDIUM', title: 'Domain count math: 124/48/52 inconsistency', remediation: 'fixed_in_doc' },
      { id: 'F-009', severity: 'LOW', title: 'Pass 22 receipt cites non-existent evidence path', remediation: 'fixed_in_receipt' },
    ],
  },

  codeRemediation: {
    file: 'src/core/time-machine-validation.ts',
    fileHash: tmValidationHash,
    additions: [
      'runDelegate52DomainRoundTrip now performs per-edit createTimeMachineCommit (baseline + forward + backward = 1 + 2*roundTrips commits per domain)',
      'buildImportedDocumentMap maps imported rows to real document content',
      'extractDelegate52DocumentContent extracts files["basic_state/..."] or states[0].context fallback',
      'sanitizeDomainKey for filesystem-safe per-domain workspace dirs',
      'ClassDResult.domainRows[] gained timeMachineCommitIds[] and documentSource fields',
    ],
  },

  testCoverage: {
    file: 'tests/time-machine-delegate52-substrate-and-content.test.ts',
    fileHash: remediationTestHash,
    testCount: 3,
    cases: [
      'F-001 — round-trips produce >= 5 TM commits per domain with valid commit IDs',
      'F-002 — imported dataset rows feed real content (documentSource=imported)',
      'F-002 fallback — no dataset → documentSource=synthetic',
    ],
  },

  documentRemediation: {
    paperFile: 'docs/papers/time-machine-empirical-validation-v1.md',
    paperHashAfter: docHash,
    receiptFile: '.danteforge/PASS_23_ADVERSARIAL_REVIEW_RECEIPT.md',
    receiptHash,
  },

  truthBoundary: {
    allowedClaim: '3 CRITICAL flaws found, all 3 remediated. DELEGATE-52 substrate-on path is now genuinely substrate-on; uses real dataset content. Paper §5.6 100K claim is honestly env-var-gated.',
    forbiddenClaims: [
      'DanteForge has executed live LLM round-trips against DELEGATE-52 (still GATE-1)',
      'F_100000 benchmark has produced final numbers (run is in flight at anchor time)',
      'runClassG matches the paper sub-checks (documented as future-pass candidate)',
    ],
  },

  unblocks: [
    'Pass 25 LaTeX preprint — markdown source revised, LaTeX needs parallel update',
    'Pass 26 outreach draft — references post-remediation paper hash',
    'GATE-1 founder action — when fired, produces meaningful substrate-on D1/D3/D4',
  ],

  verifyChain: {
    typecheck: 'pass',
    lint: 'pass',
    antiStub: 'pass',
    pass23RemediationTests: 'pass (3/3)',
    pass19ExistingLiveTests: 'pass (6/6 still green with substrate wired)',
    f100kBenchmark: 'in_flight',
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_23_adversarial_review_remediation',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-23-adversarial-review.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 23 manifest: ${outPath}`);
console.log(`  findings:                ${manifest.findings.total} (${manifest.findings.bySeverity.critical} crit / ${manifest.findings.bySeverity.high} hi / ${manifest.findings.bySeverity.medium} med / ${manifest.findings.bySeverity.low} low)`);
console.log(`  tm-validation hash:      ${tmValidationHash.slice(0, 16)}...`);
console.log(`  remediation test count:  ${manifest.testCoverage.testCount}`);
console.log(`  doc hash (post-fix):     ${docHash.slice(0, 16)}...`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
