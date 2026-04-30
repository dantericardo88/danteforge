// Proof-anchor Pass 36 — hybrid compute closure.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import 'tsx/esm';

const { createEvidenceBundle, sha256 } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
const runDir = resolve(evidenceDir, 'pass-36-runs');
mkdirSync(evidenceDir, { recursive: true });

function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function readJson(path, required = true) {
  if (!existsSync(path) || statSync(path).size === 0) {
    if (required) throw new Error(`Required JSON artifact missing or empty: ${path}`);
    return null;
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function hashFile(relativePath) {
  const path = resolve(ROOT, relativePath);
  return {
    path: relativePath.replaceAll('\\', '/'),
    hash: sha256(readFileSync(path)),
    bytes: statSync(path).size,
  };
}

function summarizeClassF(artifact) {
  if (!artifact) return { status: 'missing', benchmarks: [] };
  if (artifact.status === 'timeout' || artifact.status === 'failed') return artifact;
  const result = artifact.classes?.F;
  return {
    status: result?.status ?? artifact.status ?? 'unknown',
    benchmarks: result?.benchmarks ?? [],
    reportStatus: artifact.status,
    runId: artifact.runId,
    outDir: artifact.outDir,
  };
}

function summarizeLiveBlocked(report) {
  const result = report.classes?.D;
  return {
    status: result?.status ?? report.status ?? 'unknown',
    liveBlockers: result?.liveBlockers ?? [],
    publicReleasedDomains: result?.publicReleasedDomains,
    publicReleasedRows: result?.publicReleasedRows,
    limitations: result?.limitations ?? [],
    runId: report.runId,
    outDir: report.outDir,
  };
}

const f1mResultPath = resolve(runDir, 'f1m-result.json');
const f1mTimeoutPath = resolve(runDir, 'f1m-timeout.json');
const f1mFailurePath = resolve(runDir, 'f1m-failure.json');
const f1mArtifact = readJson(f1mResultPath, false)
  ?? readJson(f1mTimeoutPath, false)
  ?? readJson(f1mFailurePath, false);

if (!f1mArtifact) {
  throw new Error('No Class F 1M result, timeout, or failure artifact found for Pass 36.');
}

const liveBlocked = readJson(resolve(runDir, 'delegate52-live-blocked.json'));
const generatedAt = new Date().toISOString();

const manifest = {
  schemaVersion: 1,
  pass: 36,
  passName: 'Hybrid compute closure',
  generatedAt,
  gitSha: getGitSha(),
  closureMode: 'compute_only_no_public_or_paid_founder_gates',

  classFOneMillion: summarizeClassF(f1mArtifact),
  delegate52LiveGate: summarizeLiveBlocked(liveBlocked),

  founderGatesPreserved: [
    'GATE-1 live DELEGATE-52 paid/provider run',
    'GATE-5 arXiv submission',
    'GATE-6 Microsoft/Sean outreach send',
    'GATE-NPM package publication',
    'GATE-ARTICLE-XV ratification',
    'GATE-TRUTH-LOOP-RATING founder ratings',
  ],

  trackedArtifacts: [
    hashFile('docs/TRUTH_LOOP_FOUNDER_CLOSURE_CANDIDATES.md'),
    hashFile('docs/PRD-TIME-MACHINE-PUBLICATION-PLAN.md'),
    hashFile('docs/PRD-FORGE-V1.1-Closure.md'),
    hashFile('docs/papers/time-machine-empirical-validation-v1.md'),
    hashFile('docs/papers/time-machine-empirical-validation-v1.tex'),
    hashFile('docs/papers/reproducibility-appendix.md'),
    hashFile('scripts/proof-anchor-pass-36.mjs'),
  ],

  generatedArtifacts: [
    existsSync(f1mResultPath) && statSync(f1mResultPath).size > 0
      ? { path: '.danteforge/evidence/pass-36-runs/f1m-result.json', hash: sha256(readFileSync(f1mResultPath)), bytes: statSync(f1mResultPath).size }
      : existsSync(f1mTimeoutPath)
        ? { path: '.danteforge/evidence/pass-36-runs/f1m-timeout.json', hash: sha256(readFileSync(f1mTimeoutPath)), bytes: statSync(f1mTimeoutPath).size }
        : { path: '.danteforge/evidence/pass-36-runs/f1m-failure.json', hash: sha256(readFileSync(f1mFailurePath)), bytes: statSync(f1mFailurePath).size },
    { path: '.danteforge/evidence/pass-36-runs/delegate52-live-blocked.json', hash: sha256(readFileSync(resolve(runDir, 'delegate52-live-blocked.json'))), bytes: statSync(resolve(runDir, 'delegate52-live-blocked.json')).size },
  ],

  truthBoundary: {
    allowedClaim: 'Hybrid compute closure is documented and proof-anchored; compute-only Class F 1M status is recorded; live DELEGATE-52 remains fail-closed without founder-controlled prerequisites.',
    forbiddenClaim: 'DanteForge solved or live-validated DELEGATE-52 without a paid/imported live run.',
  },
};

const receiptLines = [
  '# Pass 36 Hybrid Compute Closure Receipt',
  '',
  `Generated: ${generatedAt}`,
  `Git SHA: ${manifest.gitSha ?? 'unknown'}`,
  '',
  `Class F 1M status: ${manifest.classFOneMillion.status}`,
  `DELEGATE-52 live gate status: ${manifest.delegate52LiveGate.status}`,
  `Live blockers: ${manifest.delegate52LiveGate.liveBlockers.join(', ') || 'none'}`,
  '',
  'Founder gates preserved:',
  ...manifest.founderGatesPreserved.map(gate => `- ${gate}`),
  '',
  'Tracked artifacts:',
  ...manifest.trackedArtifacts.map(file => `- ${file.path} (${file.hash.slice(0, 16)}..., ${file.bytes} bytes)`),
  '',
  'Allowed claim:',
  manifest.truthBoundary.allowedClaim,
  '',
  'Forbidden claim:',
  manifest.truthBoundary.forbiddenClaim,
  '',
];

const receiptPath = resolve(ROOT, '.danteforge', 'PASS_36_HYBRID_COMPUTE_CLOSURE_RECEIPT.md');
writeFileSync(receiptPath, receiptLines.join('\n'), 'utf-8');
manifest.receipt = {
  file: `.danteforge/${basename(receiptPath)}`,
  hash: sha256(readFileSync(receiptPath)),
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_36_hybrid_compute_closure',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-36-hybrid-compute-closure.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 36 hybrid compute closure: ${outPath}`);
console.log(`  Class F 1M:              ${manifest.classFOneMillion.status}`);
console.log(`  DELEGATE-52 live gate:   ${manifest.delegate52LiveGate.status}`);
console.log(`  blockers:                ${manifest.delegate52LiveGate.liveBlockers.join(', ') || 'none'}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
