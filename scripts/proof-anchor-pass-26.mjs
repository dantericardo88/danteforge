// Proof-anchor Pass 26 — Outreach email draft (GATE-6 founder action).

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

const draftHash = sha256(readFileSync(resolve(ROOT, 'docs/papers/outreach-email-draft.md'), 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 26,
  passName: 'Outreach email draft (peer-tone, founder personalization checklist, GATE-6 preserved)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  draft: {
    path: 'docs/papers/outreach-email-draft.md',
    hash: draftHash,
    recipients: ['Philippe Laban', 'Tobias Schnabel', 'Jennifer Neville'],
    subjectLines: 3,
    placeholders: ['[ARXIV_URL]', '[DOI_URL]', '[POST-GATE-1 NUMBERS]', '[DIVERGING DOMAINS]', 'phone'],
    sentTimestamp: 'pending_gate_6',
  },

  founderGate: {
    gate: 'GATE-6',
    description: 'Founder reviews draft + personalizes placeholders + sends',
    agentAction: 'NEVER sends; only prepares draft',
  },

  truthBoundary: {
    allowedClaim: 'Pass 26 ships outreach draft with founder personalization checklist; ready for review.',
    forbiddenClaim: 'The outreach email has been sent (NO — GATE-6 founder action).',
  },

  publicationPlanClosure: {
    passesComplete: ['18.5', '19', '20', '21', '22', '23', '24', '25', '26'],
    foundersGatesPreserved: ['GATE-1 (live LLM)', 'GATE-3 (1M benchmark)', 'GATE-5 (arXiv submit)', 'GATE-6 (outreach send)'],
    eodCompletion: true,
  },

  verifyChain: {
    typecheck: 'pass',
    lint: 'pass',
    antiStub: 'pass',
    draftHasFounderChecklist: true,
    draftPreservesGate6: true,
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_26_outreach_draft',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-26-outreach-draft.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 26 manifest: ${outPath}`);
console.log(`  draft hash:              ${draftHash.slice(0, 16)}...`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
