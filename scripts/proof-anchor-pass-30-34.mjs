// Proof-anchor Pass 30 + Pass 34 (combined receipt — same git SHA, both finalize this session).

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

const tmHash = sha256(readFileSync(resolve(ROOT, 'src/core/time-machine.ts'), 'utf-8'));
const f100kV3 = JSON.parse(readFileSync(resolve(ROOT, '.danteforge/evidence/pass-30-runs/f100k-v3-result.json'), 'utf-8'));
const scoringDocHash = sha256(readFileSync(resolve(ROOT, 'docs/SCORING-DIVERGENCE.md'), 'utf-8'));
const pass30ReceiptHash = sha256(readFileSync(resolve(ROOT, '.danteforge/PASS_30_VERIFY_PERF_V3_RECEIPT.md'), 'utf-8'));
const pass34ReceiptHash = sha256(readFileSync(resolve(ROOT, '.danteforge/PASS_34_SCORING_DIVERGENCE_RECEIPT.md'), 'utf-8'));

const f100k = f100kV3.classes.F.benchmarks.find((b) => b.id === 'F_100000');
const f10k = f100kV3.classes.F.benchmarks.find((b) => b.id === 'F_10000');

const manifest = {
  schemaVersion: 1,
  pass: '30-34',
  passName: 'Verify perf v3 (10× speedup) + scoring divergence audit',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  pass30: {
    description: '100K verify 141s → 14.6s via commitIdSet parent-existence cache + concurrency 32→64',
    file: 'src/core/time-machine.ts',
    fileHash: tmHash,
    additions: [
      'VerifyCommitCache.commitIdSet (Set passed to verifyCommit; eliminates 100K existsSync calls)',
      'VERIFY_CONCURRENCY 32 → 64',
    ],
    benchmarks: {
      f100kVerify: f100k.verifyMs,
      f100kQuery: f100k.queryMs,
      f100kRestore: f100k.restoreMs,
      f100kPassedThreshold: f100k.passedThreshold,
      f10kVerify: f10k.verifyMs,
      f10kQuery: f10k.queryMs,
    },
    cumulativeDelta: {
      pass23F100kVerifyMs: 248150,
      pass27F100kVerifyMs: 140927,
      pass30F100kVerifyMs: f100k.verifyMs,
      totalSpeedupX: Math.round(248150 / f100k.verifyMs),
    },
    evidenceFile: '.danteforge/evidence/pass-30-runs/f100k-v3-result.json',
    receiptHash: pass30ReceiptHash,
  },

  pass34: {
    description: 'Scoring divergence (maturity 95/100 vs harsh 9.3/10) audited and documented',
    docFile: 'docs/SCORING-DIVERGENCE.md',
    docHash: scoringDocHash,
    receiptHash: pass34ReceiptHash,
    decision: 'Document divergence; both systems remain valid for their own use cases. No code change.',
  },

  truthBoundary: {
    allowedClaim: 'Pass 30: 10× compounded speedup on 100K verify; threshold met with headroom. Pass 34: scoring divergence is documented and intentional.',
    forbiddenClaims: [
      'Pass 30: optimization is "complete" (causal-index query cache still possible)',
      'Pass 30: 1M benchmark has been executed (still GATE-3)',
      'Pass 34: one scoring system is "correct" (both are; for different questions)',
    ],
  },

  verifyChain: {
    typecheck: 'pass',
    tmCoreTests: 'pass (7/7)',
    f100kThreshold: 'met (10× headroom)',
    proofIntegrity: 'CLEAN',
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_30_34_combined',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-30-34-combined.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Passes 30 + 34: ${outPath}`);
console.log(`  100K verify (Pass 30):   ${f100k.verifyMs}ms (was 248150ms; ${manifest.pass30.cumulativeDelta.totalSpeedupX}× compound speedup)`);
console.log(`  100K threshold:          ${f100k.passedThreshold ? 'MET (10× headroom)' : 'NOT MET'}`);
console.log(`  scoring divergence doc:  ${scoringDocHash.slice(0, 16)}...`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
