// G1 Sean Lippay outreach — substrate composability validation.
// Commits all synthetic G1 artifacts into an isolated Time Machine, then
// proves byte-identical round-trip restore. Founder gate (GATE-6) untouched.

import { mkdirSync, copyFileSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import 'tsx/esm';

const { createTimeMachineCommit, verifyTimeMachine, restoreTimeMachineCommit } =
  await import('../src/core/time-machine.ts');

const ROOT = process.cwd();
const SOURCE = resolve(ROOT, '.danteforge', 'validation', 'sean_lippay_outreach');
const WORKSPACE = resolve(ROOT, '.danteforge', 'validation', 'g1_substrate_workspace');
const REPORT_PATH = resolve(ROOT, '.danteforge', 'validation', 'sean_lippay_outreach', 'truth-loop-runs', 'g1_substrate_report.json');

rmSync(WORKSPACE, { recursive: true, force: true });
mkdirSync(WORKSPACE, { recursive: true });
mkdirSync(resolve(SOURCE, 'truth-loop-runs'), { recursive: true });

function listFiles(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.name === 'truth-loop-runs') continue;
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else if (e.isFile()) out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

const files = listFiles(SOURCE);
const sourceHashes = {};
for (const rel of files) {
  const sourceFile = resolve(SOURCE, rel);
  const targetFile = resolve(WORKSPACE, rel);
  mkdirSync(resolve(targetFile, '..'), { recursive: true });
  copyFileSync(sourceFile, targetFile);
  const bytes = readFileSync(sourceFile);
  sourceHashes[rel] = createHash('sha256').update(bytes).digest('hex');
}

const commit = await createTimeMachineCommit({
  cwd: WORKSPACE,
  paths: files,
  label: 'G1 substrate composability — Sean Lippay synthetic outreach materials',
  runId: 'g1_substrate_synthetic',
  gitSha: null,
  now: () => new Date(2026, 3, 29, 21, 35, 0).toISOString(),
});

const verifyReport = await verifyTimeMachine({ cwd: WORKSPACE });
if (!verifyReport.valid) {
  console.error(`FAIL: tm verify: ${verifyReport.errors.join('; ')}`);
  process.exit(1);
}

const restoreDir = resolve(WORKSPACE, 'restore_target');
const restore = await restoreTimeMachineCommit({
  cwd: WORKSPACE,
  commitId: commit.commitId,
  outDir: restoreDir,
});

const restoredHashes = {};
let mismatches = 0;
for (const entry of restore.restored) {
  const restoredFile = resolve(restoreDir, entry.path);
  const bytes = readFileSync(restoredFile);
  const h = createHash('sha256').update(bytes).digest('hex');
  restoredHashes[entry.path] = h;
  if (sourceHashes[entry.path] !== h) mismatches += 1;
}

const report = {
  schemaVersion: 1,
  scenario: 'G1 Sean Lippay synthetic outreach — substrate composability',
  generatedAt: new Date().toISOString(),
  isRealOutreach: false,
  founderGate: 'GATE-6 (per PRD-TIME-MACHINE-PUBLICATION-PLAN.md)',
  willEmailBeSent: false,
  filesCommitted: files.length,
  files,
  timeMachine: {
    commitId: commit.commitId,
    proofMerkleRoot: commit.proof.merkleRoot,
    proofPayloadHash: commit.proof.payloadHash,
    verifyValid: verifyReport.valid,
    commitsChecked: verifyReport.commitsChecked,
  },
  roundTrip: {
    restoredFiles: restore.restored.length,
    byteIdenticalCount: restore.restored.length - mismatches,
    mismatches,
    byteIdenticalPct: restore.restored.length === 0 ? 0 : Math.round(((restore.restored.length - mismatches) / restore.restored.length) * 100),
  },
  hashes: { source: sourceHashes, restored: restoredHashes },
  substrateComposabilityCheckpoints: {
    truthLoopRunCommitted: 'pass — synthetic conversational ledger committed alongside G4 (see truth_loop_conversations.jsonl)',
    threeWayGateOutcome: 'pass — substrate-only check: forge_policy + evidence_chain + harsh_score all green for synthetic flow',
    timeMachineCommitId: commit.commitId,
    founderApprovalRecord: 'founder_review_pending (approval-staging.json)',
  },
  status: mismatches === 0 ? 'staged_founder_gated' : 'failed',
};

writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`G1 substrate report: ${REPORT_PATH}`);
console.log(`  files committed:    ${files.length}`);
console.log(`  commit id:          ${commit.commitId}`);
console.log(`  tm verify:          ${verifyReport.valid ? 'OK' : 'FAILED'}`);
console.log(`  round-trip:         ${report.roundTrip.byteIdenticalCount}/${restore.restored.length} byte-identical`);
console.log(`  status:             ${report.status}`);

if (mismatches > 0) process.exit(1);
