// Proof-anchor Pass 44.1 — pre-flight live LLM data + paper reframe.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

function safeRead(p) {
  try { return readFileSync(resolve(ROOT, p), 'utf-8'); } catch { return null; }
}

const receiptHash = sha256(safeRead('.danteforge/PASS_44_PREFLIGHT_LIVE_DATA_RECEIPT.md') ?? '');
const paperHash = sha256(safeRead('docs/papers/time-machine-empirical-validation-v1.md') ?? '');
const findingsHash = sha256(safeRead('docs/papers/preflight-findings.md') ?? '');

const manifest = {
  schemaVersion: 1,
  pass: '44.1',
  passName: 'Pre-flight live LLM data — substrate validated, predictions falsified, paper reframed',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  spend: {
    runA: 0.10, runB: 0.39, runC: 0.81, runD: 0.13,
    total: 1.43, cap: 2.00, underBudget: true,
  },

  realDataFindings: {
    domainsValidated: 4,
    rawCorruptionRate: '100% across all tested domains (4/4 corrupted by Sonnet 4.6)',
    substrateRestoreRetryByteIdentical: '4/4 (graceful degradation always restored clean baseline)',
    noMitigationByteIdentical: '0/3 (corrupted documents persisted in workspace)',
    mitigatedDivergences: '0/4 (retries do NOT recover Sonnet corruption)',
    oscillationDetectorFired: '1/4 (validated on real LLM cycle behavior)',
    causalSourceIdentificationRate: '0% (every divergence multi-region; pre-registered single-region prediction falsified)',
  },

  preregistrationFalsifications: {
    D3SingleRegion: 'FALSIFIED — predicted 80-95%, observed 0% across 13 divergences',
    D4UserNear0: 'FALSIFIED — predicted 0-5% with mitigation, observed 100% (retries do not recover)',
    D2StructurallyGuaranteed: 'CONFIRMED — substrate restored 4/4 workspaces to clean baseline',
    costEnvelope: 'REFINED — was $80-160, now $25-80 based on real per-call cost averaging',
  },

  paperReframe: {
    originalClaim: 'Substrate-level retries reduce user-observed corruption near 0%',
    originalClaimSurvived: false,
    correctedClaim: 'The substrate prevents silent corruption by preserving the user original document when the LLM fails. Without substrate: corrupted documents reach the user. With substrate: original documents preserved + visible failure signal.',
    correctedClaimSupported: 'YES — 3/3 substrate vs 0/3 no-mitigation byte-identical preservation in direct comparison',
    sectionsUpdated: ['§4 (methodology)', '§5.4.2 (pre-flight findings table)', '§6 (implications reframe)', '§7 limitation 10 + 11 (Pass 44 falsifications)'],
  },

  artifacts: {
    receipt: { path: '.danteforge/PASS_44_PREFLIGHT_LIVE_DATA_RECEIPT.md', hash: receiptHash },
    paper: { path: 'docs/papers/time-machine-empirical-validation-v1.md', hash: paperHash },
    findings: { path: 'docs/papers/preflight-findings.md', hash: findingsHash },
    runC: '.danteforge/evidence/preflight-runs/breadth-substrate-clean.json',
    runD: '.danteforge/evidence/preflight-runs/breadth-no-mitigation-clean.json',
  },

  truthBoundary: {
    allowedClaims: [
      'Substrate detects 100% of byte-equality divergences on real Sonnet 4.6 output',
      'Substrate-restore-retry preserves data integrity (3/3 vs 0/3 byteIdentical)',
      'Pass 36 oscillation detector fires correctly on real LLM cycle behavior',
      'Cost projection refined to $25-80 for full GATE-1',
    ],
    forbiddenClaims: [
      'Substrate-level retries reduce LLM corruption (FALSIFIED on Sonnet 4.6)',
      'D3 = 90%+ single-region attribution (FALSIFIED — every divergence multi-region)',
      'Pre-flight is a substitute for full GATE-1 (n=4 domains; full = 48 domains)',
      'The substrate makes the LLM correct (it does not; it preserves data integrity)',
    ],
  },

  probabilityUpdate: {
    pass43PSolveStrong: 0.78,
    pass44PSolveOriginalStrongClaim: 0.25,
    pass44PSolveReframedStrongClaim: 0.85,
    pass44PHonestReplication: 0.92,
    rationale: 'Pre-flight falsified retry-based claim but validated substrate-as-data-integrity-layer. Reframed paper has stronger empirical backing than original.',
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_44_1_preflight_live_data',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-44-1-preflight-live-data.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 44.1 (preflight): ${outPath}`);
console.log(`  total spend:                  $${manifest.spend.total} of $${manifest.spend.cap}`);
console.log(`  domains validated:            ${manifest.realDataFindings.domainsValidated}`);
console.log(`  P(reframed strong claim):     ${manifest.probabilityUpdate.pass44PSolveReframedStrongClaim * 100}%`);
console.log(`  P(honest replication):        ${manifest.probabilityUpdate.pass44PHonestReplication * 100}%`);
console.log(`  proof bundle:                 ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:           ${manifest.proof.payloadHash.slice(0, 16)}...`);
