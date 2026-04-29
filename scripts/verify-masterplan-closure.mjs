// Codex closure verifier for PRD-MASTER + Addendum-001.
//
// This script does not declare founder-gated work complete. It records the
// current evidence state, scores the Dante trio through the canonical scorer,
// and writes a human-readable Codex stamp plus machine-readable evidence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import 'tsx/esm';

const { computeCanonicalScore } = await import('../src/core/harsh-scorer.js');
const { createEvidenceBundle } = await import('@danteforge/evidence-chain');

const ROOT = process.cwd();
const evidenceDir = resolve(ROOT, '.danteforge', 'evidence');
mkdirSync(evidenceDir, { recursive: true });

const requiredDocs = [
  'docs/PRD-MASTER-DanteForge-Ecosystem-Build.md',
  'docs/PRD-MASTER-ADDENDUM-001-Function-Level-Harvest.md',
];

const requiredReceipts = [
  '.danteforge/BUILD_RECEIPT.md',
  '.danteforge/INFERNO_RECEIPT.md',
  '.danteforge/INFERNO_2_RECEIPT.md',
  '.danteforge/INFERNO_3_RECEIPT.md',
  '.danteforge/INFERNO_4_RECEIPT.md',
  '.danteforge/INFERNO_5_RECEIPT.md',
  '.danteforge/INFERNO_6_RECEIPT.md',
  '.danteforge/INFERNO_7_RECEIPT.md',
];

const truthLoopFiles = [
  'src/spine/schemas/run.schema.json',
  'src/spine/schemas/artifact.schema.json',
  'src/spine/schemas/evidence.schema.json',
  'src/spine/schemas/verdict.schema.json',
  'src/spine/schemas/next_action.schema.json',
  'src/spine/schemas/budget_envelope.schema.json',
  'src/spine/truth_loop/runner.ts',
  'src/spine/truth_loop/reconciler.ts',
  'src/cli/commands/truth-loop-list.ts',
];

const functionComparisonDocs = [
  '.danteforge/OSS_HARVEST/dante_to_prd_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_grill_me_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_tdd_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_triage_issue_function_comparison.md',
  '.danteforge/OSS_HARVEST/dante_design_an_interface_function_comparison.md',
];

const rawHarvestFiles = [
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__brainstorming__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__writing-plans__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__test-driven-development__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__verification-before-completion__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__systematic-debugging__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__dispatching-parallel-agents__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__subagent-driven-development__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__requesting-code-review__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__receiving-code-review__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__writing-skills__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/superpowers/skills__using-git-worktrees__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/openspec/AGENTS.md', allowEmpty: true, note: 'Current OpenSpec root AGENTS.md is an empty source file; implementation evidence comes from opsx.md/change.ts/spec.ts.' },
  { path: '.danteforge/OSS_HARVEST/raw/openspec/opsx.md' },
  { path: '.danteforge/OSS_HARVEST/raw/openspec/change.ts' },
  { path: '.danteforge/OSS_HARVEST/raw/openspec/spec.ts' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__to-prd__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__tdd__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__grill-with-docs__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__improve-codebase-architecture__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__triage__SKILL.md' },
  { path: '.danteforge/OSS_HARVEST/raw/mattpocock/skills__engineering__diagnose__SKILL.md' },
];

const founderGated = [
  'Phase 5 founder rating 8.5+ for the Sean Lippay output.',
  'Phase 5 actual Sean Lippay email send and human-confirmed truth-loop closure.',
  'Article XIV formal founder ratification.',
  'PRD-24 / PRD-25 authoring, because those PRDs do not exist yet.',
];

const ecosystemOpen = [
  'DanteCode is below the 9+ all-dimension trio target.',
  'DanteAgents is below the 9+ all-dimension trio target.',
  'DanteDojo and DanteHarvest downstream PRD adoption is staged, not proven in those sister repos.',
];

function statPath(relativePath, options = {}) {
  const absolutePath = resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    return { path: relativePath, status: 'missing', ok: false };
  }
  const bytes = readFileSync(absolutePath).length;
  const emptyOk = options.allowEmpty === true;
  return {
    path: relativePath,
    status: bytes > 0 || emptyOk ? 'present' : 'empty',
    ok: bytes > 0 || emptyOk,
    bytes,
    note: options.note,
  };
}

async function scoreRepo(name, cwd) {
  if (!existsSync(cwd)) {
    return { repo: name, cwd, status: 'missing', ok: false };
  }
  const score = await computeCanonicalScore(cwd);
  const below = Object.entries(score.dimensions)
    .filter(([, value]) => value < 9)
    .map(([dimension, value]) => ({ dimension, value }));
  return {
    repo: name,
    cwd,
    status: 'scored',
    ok: below.length === 0,
    overall: score.overall,
    gitSha: score.gitSha,
    dimensionsAtOrAbove9: Object.keys(score.dimensions).length - below.length,
    dimensionCount: Object.keys(score.dimensions).length,
    below9: below,
  };
}

const checks = {
  docs: requiredDocs.map((path) => statPath(path)),
  receipts: requiredReceipts.map((path) => statPath(path)),
  truthLoop: truthLoopFiles.map((path) => statPath(path)),
  functionComparisonDocs: functionComparisonDocs.map((path) => statPath(path)),
  rawHarvestFiles: rawHarvestFiles.map((item) => statPath(item.path, item)),
};

const trioScores = [
  await scoreRepo('DanteForge', 'C:/Projects/DanteForge'),
  await scoreRepo('DanteCode', 'C:/Projects/DanteCode'),
  await scoreRepo('DanteAgents', 'C:/Projects/DanteAgents'),
];

const agentCompletableChecks = [
  ...checks.docs,
  ...checks.receipts,
  ...checks.truthLoop,
  ...checks.functionComparisonDocs,
  ...checks.rawHarvestFiles,
];
const agentCompletableClosed = agentCompletableChecks.every((check) => check.ok) && (trioScores[0]?.overall ?? 0) >= 9;
const trioTargetMet = trioScores.every((repo) => repo.ok);

const evidence = {
  source: 'codex-masterplan-closure-v1',
  generatedAt: new Date().toISOString(),
  generatedBy: 'Codex',
  prds: requiredDocs,
  agentCompletableClosed,
  trioTargetMet,
  checks,
  trioScores,
  founderGated,
  ecosystemOpen,
  stamp: agentCompletableClosed && !trioTargetMet
    ? 'Codex stamp: DanteForge agent-completable masterplan work is closed; ecosystem completion remains open.'
    : 'Codex stamp: masterplan closure is not fully proven.',
};

evidence.proof = createEvidenceBundle({
  bundleId: 'codex_masterplan_closure',
  gitSha: trioScores[0]?.gitSha ?? null,
  evidence: [{ ...evidence }],
  createdAt: evidence.generatedAt,
});

const evidencePath = resolve(evidenceDir, 'codex-masterplan-closure.json');
writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf-8');

const lines = [];
lines.push('# Codex Masterplan Closure Stamp');
lines.push('');
lines.push(`**Generated:** ${evidence.generatedAt}`);
lines.push('**Stamp:** Codex');
lines.push('');
lines.push('## Verdict');
lines.push('');
if (agentCompletableClosed) {
  lines.push('DanteForge-side, agent-completable work from PRD-MASTER and Addendum-001 is closed with evidence.');
} else {
  lines.push('DanteForge-side closure is not fully proven; see failed checks in the JSON evidence.');
}
lines.push('');
lines.push(trioTargetMet
  ? 'The full trio-wide 9+ target is met.'
  : 'The full trio-wide 9+ target is not met yet; DanteCode and DanteAgents still need their own remediation passes.');
lines.push('');
lines.push('## Current Canonical Scores');
lines.push('');
lines.push('| Repo | Overall | Dimensions >=9 | Below 9 | Git SHA |');
lines.push('|---|---:|---:|---|---|');
for (const score of trioScores) {
  if (score.status !== 'scored') {
    lines.push(`| ${score.repo} | missing | missing | missing | missing |`);
    continue;
  }
  const below = score.below9.map((item) => `${item.dimension} ${item.value}`).join(', ') || 'none';
  lines.push(`| ${score.repo} | ${score.overall.toFixed(2)} | ${score.dimensionsAtOrAbove9}/${score.dimensionCount} | ${below} | ${score.gitSha.slice(0, 8)} |`);
}
lines.push('');
lines.push('## Still Open');
lines.push('');
for (const item of founderGated) lines.push(`- ${item}`);
for (const item of ecosystemOpen) lines.push(`- ${item}`);
lines.push('');
lines.push('## Evidence');
lines.push('');
lines.push(`Machine-readable evidence: \`${evidencePath.replaceAll('\\', '/')}\``);
lines.push('');
lines.push('This stamp deliberately does not claim the founder-gated business send, formal ratification, or sister-repo maturity work is complete.');

const stampPath = resolve(ROOT, 'docs', 'CODEX_MASTERPLAN_CLOSURE_STAMP.md');
writeFileSync(stampPath, lines.join('\n') + '\n', 'utf-8');

const failed = agentCompletableChecks.filter((check) => !check.ok);
console.log(`Codex closure evidence: ${evidencePath}`);
console.log(`Codex closure stamp: ${stampPath}`);
console.log(`Agent-completable checks: ${agentCompletableClosed ? 'CLOSED' : 'OPEN'} (${failed.length} failed)`);
console.log(`Trio target: ${trioTargetMet ? 'MET' : 'OPEN'}`);
if (failed.length > 0) {
  for (const check of failed) console.log(`  - ${check.path}: ${check.status}`);
}
for (const score of trioScores) {
  if (score.status === 'scored') {
    console.log(`  ${score.repo}: ${score.overall.toFixed(2)} (${score.dimensionsAtOrAbove9}/${score.dimensionCount} dims >=9)`);
  }
}
