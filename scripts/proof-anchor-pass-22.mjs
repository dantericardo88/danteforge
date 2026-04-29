// Proof-anchor Pass 22 — Comparison document v1 draft.

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

const docPath = resolve(ROOT, 'docs/papers/time-machine-empirical-validation-v1.md');
const docContent = readFileSync(docPath, 'utf-8');
const docHash = sha256(docContent);
const docLines = docContent.split('\n').length;
const docWords = docContent.split(/\s+/).filter(Boolean).length;

const manifest = {
  schemaVersion: 1,
  pass: 22,
  passName: 'Comparison document v1 draft (replicates DELEGATE-52, founder-gated placeholders for live D)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  document: {
    path: 'docs/papers/time-machine-empirical-validation-v1.md',
    contentHash: docHash,
    lines: docLines,
    words: docWords,
    sections: [
      'Abstract',
      '§1 Background: DELEGATE-52',
      '§2 Architectural principles',
      '§3 DanteForge implementation',
      '§4 Validation methodology',
      '§5 Results (with FOUNDER-GATED placeholders for D1/D3/D4)',
      '§6 Implications',
      '§7 Limitations',
      '§8 Future work',
      '§9 Acknowledgments',
      '§10 Reproducibility',
      '§11 Citations',
    ],
  },

  citedEvidence: [
    'pass-18-5-git-binding.json (Pass 18.5)',
    'pass-19-live-delegate52.json (Pass 19)',
    'pass-20-real-fs-import.json (Pass 20)',
    'pass-21-class-g.json (Pass 21)',
  ],

  founderGatedPlaceholders: {
    'D1 cost-of-Time-Machine': 'requires GATE-1 live run',
    'D2 byte-identical (structurally guaranteed)': 'documented as 52/52 expected; formal value awaits live run',
    'D3 causal-source identification rate': 'requires GATE-1 live run',
    'D4 corruption rate with substrate active': 'requires GATE-1 live run',
    'F 1M scale': 'requires GATE-3 founder env-var override',
  },

  truthBoundary: {
    allowedClaims: [
      'Time Machine substrate has run at real-fs PRD scale and met Class A/B/C minimum-success criteria',
      'Public 48-domain DELEGATE-52 dataset imported and harness-validated',
      'Live executor built and dry-run-validated',
      'Class G substrate composability end-to-end validated against synthetic scenarios',
    ],
    forbiddenClaims: [
      'DanteForge has executed live LLM round-trips against DELEGATE-52 (requires GATE-1)',
      'The Sean Lippay outreach has been sent (this is GATE-6)',
      'The 1M-commit benchmark has been executed (requires GATE-3)',
      'The 76 withheld DELEGATE-52 environments have been validated (license)',
    ],
  },

  unblocks: [
    'Pass 23 adversarial review can target this exact document hash',
    'Pass 25 LaTeX preprint conversion has the canonical markdown source',
  ],
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_22_comparison_document_v1',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-22-comparison-document.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 22 manifest: ${outPath}`);
console.log(`  doc path:                docs/papers/time-machine-empirical-validation-v1.md`);
console.log(`  doc hash:                ${docHash.slice(0, 16)}...`);
console.log(`  doc lines:               ${docLines}`);
console.log(`  doc words:               ${docWords}`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:       ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
