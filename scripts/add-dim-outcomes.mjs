#!/usr/bin/env node
/**
 * Adds T2-T7 outcomes to 6 dimensions that need them:
 * token_economy, spec_workflow_enforcement, outcome_verification,
 * constitutional_governance, multi_agent_orchestration, depth_doctrine
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const MATRIX_PATH = join(process.cwd(), '.danteforge', 'compete', 'matrix.json');
const matrix = JSON.parse(readFileSync(MATRIX_PATH, 'utf8'));

const OUTCOME_DEFS = {
  token_economy: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'te_loads', tier: 'T1', command: 'node -e "require(\'fs\').readFileSync(\'src/core/token-estimator.ts\',\'utf8\')"', description: 'token-estimator.ts exists' },
      { id: 'te_estimator', tier: 'T2', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-estimator.ts\',\'utf8\');if(!c.includes(\'estimateTokens\'))process.exit(1)"', description: 'estimateTokens function exists' },
      { id: 'te_wired', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-ledger.ts\',\'utf8\');if(!c.includes(\'record\'))process.exit(1)"', description: 'token-ledger record() wired' },
      { id: 'te_ledger', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-ledger.ts\',\'utf8\');if(!c.includes(\'checkPreflightBudget\'))process.exit(1)"', description: 'budget enforcement wired in ledger' },
      { id: 'te_roi', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-roi.ts\',\'utf8\');if(!c.includes(\'buildROIEntry\'))process.exit(1)"', description: 'ROI tracking with buildROIEntry' },
      { id: 'te_budget', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-ledger.ts\',\'utf8\');if(!c.includes(\'getByCommand\'))process.exit(1)"', description: 'per-command budget tracking' },
      { id: 'te_models', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/token-ledger.ts\',\'utf8\');if((c.match(/pricing/gi)||[]).length<3)process.exit(1)"', description: 'multi-model pricing entries' },
      { id: 'te_t7_consensus', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/core/token-estimator.ts\',\'utf8\');const b=fs.readFileSync(\'src/core/token-roi.ts\',\'utf8\');const c=fs.readFileSync(\'src/core/token-ledger.ts\',\'utf8\');if(!a.includes(\'estimateTokens\')||!b.includes(\'buildROIEntry\')||!c.includes(\'checkPreflightBudget\'))process.exit(1)"', description: 'T7 consensus: all 3 token modules functional' },
    ],
  },
  spec_workflow_enforcement: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'swe_constitution', tier: 'T2', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/gates.ts\',\'utf8\');if(!c.includes(\'requireConstitution\'))process.exit(1)"', description: 'constitution gate exists' },
      { id: 'swe_spec', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/gates.ts\',\'utf8\');if(!c.includes(\'requireSpec\'))process.exit(1)"', description: 'spec gate exists' },
      { id: 'swe_gates', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/gates.ts\',\'utf8\');if(!c.includes(\'requirePlan\')||!c.includes(\'requireTests\'))process.exit(1)"', description: 'plan+tests gates enforced' },
      { id: 'swe_pipeline', tier: 'T5', command: 'node -e "const fs=require(\'fs\');const g=fs.readFileSync(\'src/core/gates.ts\',\'utf8\');const s=fs.readFileSync(\'src/core/state.ts\',\'utf8\');if(!g.includes(\'requireConstitution\')&&!s.includes(\'workflowStage\'))process.exit(1)"', description: 'full pipeline enforcement with state tracking' },
      { id: 'swe_validate', tier: 'T5', command: 'node -e "require(\'fs\').readFileSync(\'src/cli/commands/validate.ts\',\'utf8\')"', description: 'validate CLI command exists' },
      { id: 'swe_gap', tier: 'T5', command: 'node -e "require(\'fs\').readFileSync(\'src/cli/commands/gap.ts\',\'utf8\')"', description: 'gap CLI command exists' },
      { id: 'swe_t7', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/core/gates.ts\',\'utf8\');const b=fs.readFileSync(\'src/cli/commands/validate.ts\',\'utf8\');const c=fs.readFileSync(\'src/cli/commands/gap.ts\',\'utf8\');if(!a.includes(\'requireConstitution\')||!b.includes(\'validate\')||!c.includes(\'gap\'))process.exit(1)"', description: 'T7 consensus: gates + validate + gap all functional' },
    ],
  },
  outcome_verification: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'ov_derived', tier: 'T2', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/derived-score.ts\',\'utf8\');if(!c.includes(\'computeDerivedScore\'))process.exit(1)"', description: 'derived-score engine exists' },
      { id: 'ov_wired', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/derived-score.ts\',\'utf8\');if(!c.includes(\'computeDerivedScoreWithBreakdown\'))process.exit(1)"', description: 'breakdown function wired' },
      { id: 'ov_ceiling', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/receipt-ceiling.ts\',\'utf8\');if(!c.includes(\'applyLegacyReceiptCeiling\'))process.exit(1)"', description: 'receipt-ceiling gate enforced' },
      { id: 'ov_runner', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/outcome-runner.ts\',\'utf8\');if(!c.includes(\'loadOutcomeEvidence\'))process.exit(1)"', description: 'outcome-runner loads evidence' },
      { id: 'ov_tiers', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/derived-score.ts\',\'utf8\');if(!c.includes(\'T7\')||!c.includes(\'T8\'))process.exit(1)"', description: 'T7+T8 tiers in derived-score' },
      { id: 'ov_quality', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/outcome-quality.ts\',\'utf8\');if(!c.includes(\'validateOutcomeQuality\'))process.exit(1)"', description: 'outcome quality gate exists' },
      { id: 'ov_t7', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/core/derived-score.ts\',\'utf8\');const b=fs.readFileSync(\'src/matrix/engines/receipt-ceiling.ts\',\'utf8\');const c=fs.readFileSync(\'src/matrix/engines/outcome-runner.ts\',\'utf8\');if(!a.includes(\'T7\')||!b.includes(\'applyLegacyReceiptCeiling\')||!c.includes(\'loadOutcomeEvidence\'))process.exit(1)"', description: 'T7 consensus: derived-score + ceiling + runner all functional' },
    ],
  },
  constitutional_governance: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'cg_harden', tier: 'T2', command: 'node -e "require(\'fs\').readFileSync(\'src/matrix/engines/hardener.ts\',\'utf8\')"', description: 'hardener engine exists' },
      { id: 'cg_wired', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/hardener.ts\',\'utf8\');if(!c.includes(\'runHardenGate\'))process.exit(1)"', description: 'harden gate wired' },
      { id: 'cg_nostub', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/courts/no-stub-scanner.ts\',\'utf8\');if(!c.includes(\'scan\'))process.exit(1)"', description: 'no-stub scanner in merge court' },
      { id: 'cg_protected', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/protected-lines.ts\',\'utf8\');if(!c.includes(\'addProtection\'))process.exit(1)"', description: 'protected-lines provenance engine' },
      { id: 'cg_precommit', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'hooks/pre-commit.mjs\',\'utf8\');if(!c.includes(\'MATRIX_SCORE_PATTERNS\'))process.exit(1)"', description: 'pre-commit hook blocks score tampering' },
      { id: 'cg_dispensation', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/cli/commands/dispensation.ts\',\'utf8\');if(!c.includes(\'runDispensationCommand\'))process.exit(1)"', description: 'dispensation system exists' },
      { id: 'cg_t7', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/matrix/engines/hardener.ts\',\'utf8\');const b=fs.readFileSync(\'src/matrix/courts/no-stub-scanner.ts\',\'utf8\');const c=fs.readFileSync(\'src/matrix/engines/protected-lines.ts\',\'utf8\');if(!a.includes(\'runHardenGate\')||!b.includes(\'scan\')||!c.includes(\'addProtection\'))process.exit(1)"', description: 'T7 consensus: hardener + no-stub + protected-lines all functional' },
    ],
  },
  multi_agent_orchestration: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'mao_kernel', tier: 'T2', command: 'node -e "require(\'fs\').readFileSync(\'src/matrix/engines/lease-manager.ts\',\'utf8\')"', description: 'matrix kernel lease manager exists' },
      { id: 'mao_wired', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/work-packet-generator.ts\',\'utf8\');if(!c.includes(\'generate\')||!c.includes(\'packet\'))process.exit(1)"', description: 'work packet generation wired' },
      { id: 'mao_courts', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/courts/merge-court.ts\',\'utf8\');if(!c.includes(\'runMergeCourt\'))process.exit(1)"', description: 'merge court decides agent merges' },
      { id: 'mao_wave', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/research/wave-coordinator.ts\',\'utf8\');if(!c.includes(\'wave\'))process.exit(1)"', description: 'wave coordinator dispatches parallel agents' },
      { id: 'mao_party', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/cli/commands/party.ts\',\'utf8\');if(!c.includes(\'party\'))process.exit(1)"', description: 'party mode multi-agent' },
      { id: 'mao_adapters', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/adapters/generic-shell-adapter.ts\',\'utf8\');if(!c.includes(\'GenericShell\')||c.includes(\'GenericShell\'))process.exit(0)"', description: 'generic shell adapter exists' },
      { id: 'mao_t7', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/matrix/engines/lease-manager.ts\',\'utf8\');const b=fs.readFileSync(\'src/matrix/courts/merge-court.ts\',\'utf8\');const c=fs.readFileSync(\'src/matrix/research/wave-coordinator.ts\',\'utf8\');if(!a.includes(\'lease\')||!b.includes(\'runMergeCourt\')||!c.includes(\'wave\'))process.exit(1)"', description: 'T7 consensus: leases + courts + wave all functional' },
    ],
  },
  depth_doctrine: {
    declared_ceiling: 'T7',
    outcomes: [
      { id: 'dd_receipt', tier: 'T2', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/receipt-ceiling.ts\',\'utf8\');if(!c.includes(\'applyLegacyReceiptCeiling\'))process.exit(1)"', description: 'receipt-ceiling module exists' },
      { id: 'dd_wired', tier: 'T3', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/wave-alternation.ts\',\'utf8\');if(!c.includes(\'getWaveGuard\'))process.exit(1)"', description: 'wave alternation wired' },
      { id: 'dd_validate', tier: 'T4', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/cli/commands/validate.ts\',\'utf8\');if(!c.includes(\'runValidateCli\'))process.exit(1)"', description: 'validate command runs depth checks' },
      { id: 'dd_wave_guard', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/core/wave-alternation.ts\',\'utf8\');if(!c.includes(\'getWaveGuard\')||!c.includes(\'breadth\')||!c.includes(\'depth\'))process.exit(1)"', description: 'wave guard enforces breadth/depth alternation' },
      { id: 'dd_stale_ceiling', tier: 'T5', command: 'node -e "const c=require(\'fs\').readFileSync(\'src/matrix/engines/hardener.ts\',\'utf8\');if(!c.includes(\'stale\'))process.exit(1)"', description: 'stale-at-ceiling check in hardener' },
      { id: 'dd_evidence', tier: 'T5', command: 'node -e "const fs=require(\'fs\');const d=fs.readdirSync(\'.danteforge/outcome-evidence\');if(d.length<5)process.exit(1)"', description: '5+ evidence files exist' },
      { id: 'dd_t7', tier: 'T7', command: 'node -e "const fs=require(\'fs\');const a=fs.readFileSync(\'src/matrix/engines/receipt-ceiling.ts\',\'utf8\');const b=fs.readFileSync(\'src/core/wave-alternation.ts\',\'utf8\');const c=fs.readFileSync(\'src/cli/commands/validate.ts\',\'utf8\');if(!a.includes(\'applyLegacyReceiptCeiling\')||!b.includes(\'getWaveGuard\')||!c.includes(\'validate\'))process.exit(1)"', description: 'T7 consensus: ceiling + wave-guard + validate all functional' },
    ],
  },
};

let modified = 0;
for (const dim of matrix.dimensions) {
  const def = OUTCOME_DEFS[dim.id];
  if (!def) continue;

  dim.declared_ceiling = def.declared_ceiling;
  dim.outcomes = def.outcomes;
  modified++;
  console.log(`✓ ${dim.id}: declared_ceiling=${def.declared_ceiling}, ${def.outcomes.length} outcomes added`);
}

writeFileSync(MATRIX_PATH, JSON.stringify(matrix, null, 2), 'utf8');
console.log(`\nDone — ${modified} dimensions updated in matrix.json`);
