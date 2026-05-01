// Proof-anchor Pass 44: PRD remainder closure.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
const runDir = resolve(evidenceDir, 'pass-44-runs');
mkdirSync(runDir, { recursive: true });

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function readJson(path) {
  if (!existsSync(path) || statSync(path).size === 0) {
    throw new Error(`Required JSON artifact missing or empty: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function hashFile(relativePath) {
  const file = resolve(ROOT, relativePath);
  return {
    path: relativePath.replaceAll('\\', '/'),
    hash: sha256(readFileSync(file)),
    bytes: statSync(file).size,
  };
}

function summarizeClassF(report) {
  const result = report.classes?.F;
  return {
    reportStatus: report.status,
    classStatus: result?.status ?? 'missing',
    runId: report.runId,
    outDir: report.outDir,
    benchmarks: result?.benchmarks ?? [],
  };
}

const f1mStdout = resolve(ROOT, '.danteforge', 'time-machine', 'validation', 'pass-44-f1m.stdout.json');
const f1mReport = readJson(f1mStdout);
const f1mEvidencePath = resolve(runDir, 'f1m-result.json');
writeFileSync(f1mEvidencePath, JSON.stringify(f1mReport, null, 2) + '\n', 'utf8');

const generatedAt = new Date().toISOString();
const gitSha = getGitSha();

const trackedArtifacts = [
  'package.json',
  'src/core/time-machine-validation.ts',
  'src/core/time-machine.ts',
  'src/cli/index.ts',
  'src/cli/commands/time-machine.ts',
  'scripts/preflight-delegate52.mjs',
  'scripts/proof-anchor-pass-44.mjs',
  'tests/time-machine-class-f-benchmark.test.ts',
  'tests/delegate52-preflight-script.test.ts',
  'docs/PRD-TIME-MACHINE-PUBLICATION-PLAN.md',
  'docs/PRD-FORGE-V1.1-Closure.md',
  'docs/papers/time-machine-empirical-validation-v1.md',
  'docs/papers/time-machine-empirical-validation-v1.tex',
  'docs/papers/reproducibility-appendix.md',
].map(hashFile);

const generatedArtifacts = [
  {
    path: '.danteforge/evidence/pass-44-runs/f1m-result.json',
    hash: sha256(readFileSync(f1mEvidencePath)),
    bytes: statSync(f1mEvidencePath).size,
  },
];

const manifest = {
  schemaVersion: 1,
  pass: 44,
  passName: 'PRD remainder closure: preflight path and Class F optimized benchmark',
  generatedAt,
  gitSha,
  closureMode: 'agent_buildable_no_paid_or_public_founder_gates',
  classFOneMillion: summarizeClassF(f1mReport),
  delegate52Preflight: {
    status: 'prepared_not_executed',
    command: 'npm run delegate52:preflight',
    budgetUsd: 2,
    domains: 3,
    roundTripsPerDomain: 1,
    gateBoundary: 'not GATE-1; does not update live D1/D3/D4 paper tables',
  },
  founderGatesPreserved: [
    'GATE-1 full live DELEGATE-52 paid/provider run',
    'GATE-3 accepted 1M benchmark pass',
    'GATE-5 arXiv submission',
    'GATE-6 Microsoft/Sean outreach send',
    'GATE-NPM package publication',
    'GATE-ARTICLE-XV ratification',
    'GATE-TRUTH-LOOP-RATING founder ratings',
  ],
  trackedArtifacts,
  generatedArtifacts,
  truthBoundary: {
    allowedClaim: 'Pass 44 optimized Class F benchmark generation, added graceful benchmark controls, and prepared a tiny DELEGATE-52 preflight path.',
    forbiddenClaim: 'DanteForge has passed the 1M Class F benchmark or live-validated DELEGATE-52.',
  },
};

const receiptLines = [
  '# Pass 44 PRD Remainder Closure Receipt',
  '',
  `Generated: ${generatedAt}`,
  `Git SHA: ${gitSha ?? 'unknown'}`,
  '',
  `Class F report status: ${manifest.classFOneMillion.reportStatus}`,
  `Class F class status: ${manifest.classFOneMillion.classStatus}`,
  '',
  'Benchmarks:',
  ...manifest.classFOneMillion.benchmarks.map(item => `- ${item.id}: completed ${item.completedCommits ?? 0}/${item.targetCommits ?? item.commitCount}; build=${item.buildMs ?? 0}ms verify=${item.verifyMs ?? 0}ms restore=${item.restoreMs ?? 0}ms query=${item.queryMs ?? 0}ms pass=${item.passedThreshold === true}${item.failureReason ? `; ${item.failureReason}` : ''}`),
  '',
  `DELEGATE-52 preflight: ${manifest.delegate52Preflight.status}`,
  `Preflight command: ${manifest.delegate52Preflight.command}`,
  '',
  'Founder gates preserved:',
  ...manifest.founderGatesPreserved.map(gate => `- ${gate}`),
  '',
  'Allowed claim:',
  manifest.truthBoundary.allowedClaim,
  '',
  'Forbidden claim:',
  manifest.truthBoundary.forbiddenClaim,
  '',
];

const receiptPath = resolve(ROOT, '.danteforge', 'PASS_44_PRD_REMAINDER_CLOSURE_RECEIPT.md');
writeFileSync(receiptPath, receiptLines.join('\n'), 'utf8');

manifest.receipt = {
  file: `.danteforge/${basename(receiptPath)}`,
  hash: sha256(readFileSync(receiptPath)),
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_44_prd_remainder_closure',
  gitSha,
  evidence: [{ ...manifest }],
  createdAt: generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-44-prd-remainder-closure.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`Proof-anchored Pass 44 PRD remainder closure: ${outPath}`);
console.log(`  Class F:                  ${manifest.classFOneMillion.classStatus}`);
console.log(`  preflight:                ${manifest.delegate52Preflight.status}`);
console.log(`  proof payload hash:       ${manifest.proof.payloadHash.slice(0, 16)}...`);
