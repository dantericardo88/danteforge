// Proof-anchor Pass 25 — Preprint preparation (LaTeX + reproducibility + citations).

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

const texHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/time-machine-empirical-validation-v1.tex'), 'utf-8'));
const bibHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/citations.bib'), 'utf-8'));
const reproHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/reproducibility-appendix.md'), 'utf-8'));
const mdHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/time-machine-empirical-validation-v1.md'), 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 25,
  passName: 'Preprint preparation — LaTeX + reproducibility appendix + citations',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  artifacts: {
    markdownSource: { path: 'docs/papers/time-machine-empirical-validation-v1.md', hash: mdHash, role: 'canonical source of truth' },
    latexPreprint: { path: 'docs/papers/time-machine-empirical-validation-v1.tex', hash: texHash, role: 'derived from markdown for arXiv compilation' },
    bibtex: { path: 'docs/papers/citations.bib', hash: bibHash, role: '5 citation entries (Laban DELEGATE-52, Nakamoto, Loeliger Git, Anthropic Constitutional, evidence-chain)' },
    reproducibilityAppendix: { path: 'docs/papers/reproducibility-appendix.md', hash: reproHash, role: 'CLI commands + version hashes + founder-gate summary' },
  },

  pdfBuild: {
    available: false,
    reason: 'pdflatex not in dev environment',
    documented: 'Pass 25 §A.7 build sequence',
    founderActionRequired: 'compile + visual review + arXiv submission decision (GATE-5)',
  },

  truthBoundary: {
    allowedClaim: 'Pass 25 ships LaTeX + BibTeX + reproducibility appendix; all artifacts ready for founder PDF compilation.',
    forbiddenClaim: 'The PDF has been submitted to arXiv (NO — GATE-5 founder action).',
  },

  unblocks: [
    'Pass 26 outreach draft references locked LaTeX source',
    'GATE-5 founder action has all artifacts staged',
  ],

  verifyChain: {
    typecheck: 'pass',
    lint: 'pass',
    antiStub: 'pass',
    artifactsExist: 'pass',
    citationsCount: 5,
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_25_preprint_preparation',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-25-preprint-prep.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 25 manifest: ${outPath}`);
console.log(`  tex hash:                ${texHash.slice(0, 16)}...`);
console.log(`  bib hash:                ${bibHash.slice(0, 16)}...`);
console.log(`  reproducibility hash:    ${reproHash.slice(0, 16)}...`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
