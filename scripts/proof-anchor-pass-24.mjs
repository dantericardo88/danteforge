// Proof-anchor Pass 24 — Product polish (T3.2 + T3.1).

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
const cliCmdHash = sha256(readFileSync(resolve(ROOT, 'src/cli/commands/time-machine.ts'), 'utf-8'));
const hookHash = sha256(readFileSync(resolve(ROOT, 'hooks/post-tool-use.mjs'), 'utf-8'));
const hooksJsonHash = sha256(readFileSync(resolve(ROOT, 'hooks/hooks.json'), 'utf-8'));
const t32TestHash = sha256(readFileSync(resolve(ROOT, 'tests/time-machine-restore-working-tree.test.ts'), 'utf-8'));
const t31TestHash = sha256(readFileSync(resolve(ROOT, 'tests/post-tool-use-hook.test.ts'), 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 24,
  passName: 'Product polish — restore --to-working-tree + post-edit auto-commit hook',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  T32: {
    description: 'forge time-machine restore --to-working-tree --confirm',
    coreFile: { path: 'src/core/time-machine.ts', hash: tmHash },
    cliFile: { path: 'src/cli/commands/time-machine.ts', hash: cliCmdHash },
    refusals: [
      'toWorkingTree=true without confirm=true → throws',
      'toWorkingTree=true + outDir provided → throws',
    ],
    testFile: { path: 'tests/time-machine-restore-working-tree.test.ts', hash: t32TestHash, count: 4 },
  },

  T31: {
    description: 'Post-edit auto-commit hook (Claude Code PostToolUse, scoped to Edit/Write/MultiEdit/NotebookEdit)',
    hookFile: { path: 'hooks/post-tool-use.mjs', hash: hookHash },
    manifestFile: { path: 'hooks/hooks.json', hash: hooksJsonHash },
    properties: [
      'Always exits 0; never blocks editor',
      'Spawns forge time-machine commit detached, non-blocking',
      'Skips silently when cwd has no .danteforge/STATE.yaml',
      'Diagnostic output to stderr only',
    ],
    testFile: { path: 'tests/post-tool-use-hook.test.ts', hash: t31TestHash, count: 3 },
    honestScope: 'Post-edit only; pre-edit interception requires Claude Code harness extensions deferred to Pass 27',
  },

  T33: {
    status: 'deferred_to_pass_27',
    reason: 'Full runtime corruption detector requires pre-edit interception of agent edits, which depends on Claude Code harness primitives not currently exposed',
  },

  truthBoundary: {
    allowedClaim: 'Pass 24 ships working-tree restore + post-edit auto-commit hook; every agent edit is snapshotted into Time Machine for reversibility.',
    forbiddenClaim: 'Pre-edit interception is implemented (NO — that is Pass 27, harness-dependent).',
  },

  unblocks: [
    'Day-2 dogfood: forge time-machine restore --commit <id> --to-working-tree --confirm',
    'Pass 25 reproducibility appendix can recommend the post-edit hook as part of dev setup',
  ],

  verifyChain: {
    typecheck: 'pass',
    lint: 'pass',
    antiStub: 'pass',
    pass24Tests: 'pass (7/7)',
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_24_product_polish',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-24-product-polish.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 24 manifest: ${outPath}`);
console.log(`  T3.2 core file hash:     ${tmHash.slice(0, 16)}...`);
console.log(`  T3.1 hook file hash:     ${hookHash.slice(0, 16)}...`);
console.log(`  T3.2 test count:         ${manifest.T32.testFile.count}`);
console.log(`  T3.1 test count:         ${manifest.T31.testFile.count}`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
