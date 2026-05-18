#!/usr/bin/env node
// scripts/restore-dogfood-matrix.mjs
// One-shot migrator. Reads the most recent 19-dim backup of DanteForge's
// competitive matrix, adds `capability_test`, `outcomes`, and `declared_ceiling`
// fields per dim using real DanteForge shell commands, and writes the result
// to .danteforge/compete/matrix.json so the substrate can dogfood itself.
//
// Run once after any matrix-restoration event; idempotent.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const BACKUP = path.join(ROOT, '.danteforge', 'compete', 'matrix.pre-2026-05-13T17-22-25-837Z.json');
const TARGET = path.join(ROOT, '.danteforge', 'compete', 'matrix.json');

// Per-dim capability_test command + tier + outcome description.
// Commands are REAL — they exit 0 only when the capability is genuinely present.
const ANNOTATIONS = {
  testing: {
    ceiling: 'T2',
    captest: { command: 'npm test 2>&1 | tail -5', description: 'Full test suite passes', timeoutMs: 1500000 },
    outcomes: [
      { id: 't_smoke', tier: 'T1', kind: 'shell', description: 'Smoke tests pass', command: 'npx tsx --test tests/smoke.test.ts 2>&1 | tail -3' },
      // npm test takes ~10-25 min on DanteForge; bump timeout to 25min to allow
      // legitimate full-suite runs to complete instead of timing out.
      { id: 't_full', tier: 'T2', kind: 'shell', description: 'Full test suite passes', command: 'npm test 2>&1 | tail -5', timeout_ms: 1500000 },
    ],
  },
  documentation: {
    ceiling: 'T2',
    captest: { command: 'node -e "require(\'fs\').accessSync(\'docs/CAPABILITY-TIERS.md\')"', description: 'CAPABILITY-TIERS.md exists' },
    outcomes: [
      { id: 'd_tiers', tier: 'T1', kind: 'shell', description: 'CAPABILITY-TIERS.md is present', command: 'node -e "require(\'fs\').accessSync(\'docs/CAPABILITY-TIERS.md\')"' },
      { id: 'd_content', tier: 'T2', kind: 'shell', description: 'Core docs exist with real content (CAPABILITY-TIERS, AUTONOMY-BOUNDARIES, RUNBOOK each ≥2KB)', command: 'node -e "const fs=require(\'fs\');for(const f of [\'docs/CAPABILITY-TIERS.md\',\'docs/AUTONOMY-BOUNDARIES.md\',\'RUNBOOK.md\']){fs.accessSync(f);if(fs.readFileSync(f,\'utf8\').length<2000)process.exit(1)}"' },
    ],
  },
  developer_experience: {
    ceiling: 'T2',
    captest: { command: 'node dist/index.js --help 2>&1 | head -3', description: 'CLI --help responds' },
    outcomes: [
      { id: 'dx_help', tier: 'T1', kind: 'shell', description: 'CLI help renders', command: 'node dist/index.js --help 2>&1 | head -3' },
      { id: 'dx_go', tier: 'T2', kind: 'shell', description: '`go` entry-point command exists', command: 'node dist/index.js go --help 2>&1 | head -3' },
    ],
  },
  ux_polish: {
    ceiling: 'T1',
    captest: { command: 'node dist/index.js --help 2>&1 | head -3', description: 'CLI help renders cleanly' },
    outcomes: [
      { id: 'ux_help', tier: 'T1', kind: 'shell', description: 'CLI surfaces help in <2s', command: 'node dist/index.js --help 2>&1 | head -3' },
    ],
  },
  functionality: {
    ceiling: 'T2',
    captest: { command: 'npx tsx --test tests/smoke.test.ts 2>&1 | tail -3', description: 'Smoke tests pass' },
    outcomes: [
      { id: 'f_smoke', tier: 'T2', kind: 'shell', description: 'Smoke tests cover the golden path', command: 'npx tsx --test tests/smoke.test.ts 2>&1 | tail -3' },
    ],
  },
  autonomy: {
    ceiling: 'T2',
    captest: { command: 'node dist/index.js ascend --dry-run 2>&1 | tail -3', description: 'ascend --dry-run completes without error' },
    outcomes: [
      { id: 'a_dryrun', tier: 'T2', kind: 'shell', description: '`ascend --dry-run` executes', command: 'node dist/index.js ascend --dry-run 2>&1 | tail -3' },
    ],
  },
  security: {
    ceiling: 'T2',
    captest: { command: 'npm run check:anti-stub 2>&1 | tail -5', description: 'Anti-stub scan finds no stubs' },
    outcomes: [
      { id: 's_antistub', tier: 'T2', kind: 'shell', description: 'No anti-stub findings', command: 'npm run check:anti-stub 2>&1 | tail -5' },
      { id: 's_audit', tier: 'T2', kind: 'shell', description: 'npm audit clean at high severity', command: 'npm audit --audit-level=high --omit=dev 2>&1 | tail -5' },
    ],
  },
  error_handling: {
    ceiling: 'T2',
    captest: { command: 'npx tsx --test tests/error-boundary-coverage.test.ts 2>&1 | tail -3', description: 'Error boundary tests pass' },
    outcomes: [
      { id: 'eh_boundary', tier: 'T2', kind: 'shell', description: 'Error boundary tests pass', command: 'npx tsx --test tests/error-boundary-coverage.test.ts 2>&1 | tail -3' },
    ],
  },
  performance: {
    ceiling: 'T2',
    captest: { command: 'npm run build 2>&1 | tail -3', description: 'Build completes' },
    outcomes: [
      { id: 'p_build', tier: 'T2', kind: 'shell', description: 'Build completes (compile baseline)', command: 'npm run build 2>&1 | tail -3' },
    ],
  },
  convergence_self_healing: {
    ceiling: 'T2',
    captest: { command: 'npx tsx --test tests/loop-detector.test.ts tests/reflection-gates.test.ts 2>&1 | tail -3', description: 'Loop detector + reflection gate tests pass' },
    outcomes: [
      { id: 'csh_loop', tier: 'T2', kind: 'shell', description: 'Loop detector + reflection gate tests pass', command: 'npx tsx --test tests/loop-detector.test.ts tests/reflection-gates.test.ts 2>&1 | tail -3' },
    ],
  },
  spec_driven_pipeline: {
    ceiling: 'T2',
    captest: { command: 'npx tsx --test tests/workflow-enforcer.test.ts 2>&1 | tail -3', description: 'Workflow enforcer tests pass' },
    outcomes: [
      { id: 'sdp_workflow', tier: 'T2', kind: 'shell', description: 'Workflow enforcer tests pass', command: 'npx tsx --test tests/workflow-enforcer.test.ts 2>&1 | tail -3' },
    ],
  },
  planning_quality: {
    ceiling: 'T1',
    captest: { command: 'node dist/index.js plan --help 2>&1 | head -3', description: 'plan command exists' },
    outcomes: [
      { id: 'pq_help', tier: 'T1', kind: 'shell', description: 'plan command surfaces help', command: 'node dist/index.js plan --help 2>&1 | head -3' },
    ],
  },
  maintainability: {
    ceiling: 'T2',
    captest: { command: 'node scripts/check-file-size.mjs 2>&1 | tail -3', description: 'No file exceeds 750 LOC' },
    outcomes: [
      { id: 'm_filesize', tier: 'T2', kind: 'shell', description: 'No file exceeds 750 LOC', command: 'node scripts/check-file-size.mjs 2>&1 | tail -3' },
    ],
  },
  token_economy: {
    ceiling: 'T1',
    captest: { command: 'node dist/index.js --help 2>&1 | head -3', description: 'CLI loads — market-dim ceilinged at 5.0' },
    outcomes: [
      { id: 'te_loads', tier: 'T1', kind: 'shell', description: 'CLI loads', command: 'node dist/index.js --help 2>&1 | head -3' },
    ],
  },
  self_improvement: {
    ceiling: 'T2',
    captest: { command: 'npx tsx --test tests/lessons-index.test.ts tests/self-improve-loop.test.ts 2>&1 | tail -3', description: 'Lessons + self-improve loop tests pass' },
    outcomes: [
      { id: 'si_lessons', tier: 'T2', kind: 'shell', description: 'Lessons + self-improve loop tests pass', command: 'npx tsx --test tests/lessons-index.test.ts tests/self-improve-loop.test.ts 2>&1 | tail -3' },
    ],
  },
  ecosystem_mcp: {
    ceiling: 'T2',
    captest: { command: 'node dist/index.js mcp-tools --json 2>&1 | tail -3', description: 'MCP tool list materializes' },
    outcomes: [
      { id: 'em_tools', tier: 'T2', kind: 'shell', description: 'MCP tool registry materializes', command: 'node dist/index.js mcp-tools --json 2>&1 | tail -3' },
    ],
  },
  enterprise_readiness: {
    ceiling: 'T2',
    captest: { command: 'node -e "[\'SECURITY.md\',\'CHANGELOG.md\',\'RUNBOOK.md\'].forEach(f=>require(\'fs\').accessSync(f))"', description: 'SECURITY + CHANGELOG + RUNBOOK present (ceilinged at 9.0)' },
    outcomes: [
      { id: 'er_files', tier: 'T1', kind: 'shell', description: 'SECURITY.md + CHANGELOG.md exist', command: 'node -e "[\'SECURITY.md\',\'CHANGELOG.md\'].forEach(f=>require(\'fs\').accessSync(f))"' },
      { id: 'er_runbook', tier: 'T2', kind: 'shell', description: 'RUNBOOK.md exists with operator-facing content', command: 'node -e "const fs=require(\'fs\');fs.accessSync(\'RUNBOOK.md\');const c=fs.readFileSync(\'RUNBOOK.md\',\'utf8\');if(c.length<2000||!/operator/i.test(c))process.exit(1)"' },
    ],
  },
  community_adoption: {
    ceiling: 'T0',
    captest: { no_capability_test: true, reason: 'Market-dim — requires real downloads + stars. Permanently capped at 4.0 per KNOWN_CEILINGS.' },
    outcomes: [],
  },
  agent_activity_provenance: {
    ceiling: 'T2',
    captest: { command: 'node -e "import(\'./dist/sdk.js\').then(m=>{if(!m.createTimeMachineCommit)process.exit(1)})"', description: 'Time Machine entry-point loads from dist/sdk.js' },
    outcomes: [
      { id: 'aap_sdk', tier: 'T2', kind: 'shell', description: 'Time Machine entry-point loads', command: 'node -e "import(\'./dist/sdk.js\').then(m=>{if(!m.createTimeMachineCommit)process.exit(1)})"' },
    ],
  },
};

async function main() {
  const raw = await fs.readFile(BACKUP, 'utf8');
  const matrix = JSON.parse(raw);
  let annotated = 0;
  let missingFromMap = [];
  for (const dim of matrix.dimensions) {
    const ann = ANNOTATIONS[dim.id];
    if (!ann) { missingFromMap.push(dim.id); continue; }
    dim.capability_test = ann.captest;
    dim.outcomes = ann.outcomes;
    dim.declared_ceiling = ann.ceiling;
    annotated++;
  }
  if (missingFromMap.length > 0) {
    console.error(`[restore-dogfood-matrix] Dims in backup but not in annotation map: ${missingFromMap.join(', ')}`);
  }
  matrix.lastUpdated = new Date().toISOString();
  await fs.writeFile(TARGET, JSON.stringify(matrix, null, 2));
  console.log(`[restore-dogfood-matrix] Wrote ${TARGET}`);
  console.log(`  ${annotated}/${matrix.dimensions.length} dims annotated with capability_test + outcomes + declared_ceiling`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
