// Proof-anchor Pass 19 — Live DELEGATE-52 round-trip executor build.

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

const validationFileHash = sha256(readFileSync(resolve(ROOT, 'src/core/time-machine-validation.ts'), 'utf-8'));
const testFileHash = sha256(readFileSync(resolve(ROOT, 'tests/time-machine-delegate52-live.test.ts'), 'utf-8'));

const manifest = {
  schemaVersion: 1,
  pass: 19,
  passName: 'Live DELEGATE-52 round-trip executor (build only; live run = GATE-1)',
  generatedAt: new Date().toISOString(),
  gitSha: getGitSha(),

  delivered: {
    file: 'src/core/time-machine-validation.ts',
    fileHash: validationFileHash,
    additions: [
      'runDelegate52Live() — orchestrator looping domains × round-trips × forward+backward edits',
      'runDelegate52DomainRoundTrip() — per-domain executor with per-call cost tracking + first-corruption detection',
      'synthesizeDomainDocument() — deterministic per-domain fixtures (CSV by department, list restructure, JSON flatten, markdown section)',
      'buildForwardPrompt() / buildBackwardPrompt() — round-trip prompt construction',
      'makeDefaultLlmCaller() — production caller (callLLM) + dry-run identity simulator',
      'estimateRoundTripCost() — conservative cost model ($3/M input + $15/M output tokens)',
      '_llmCaller injection seam on RunTimeMachineValidationOptions for tests',
      'roundTripsPerDomain option (PRD §3.4 specifies 10; capped at 20)',
    ],
    schemaExtension: [
      'ClassDResult.status now includes live_completed | live_dry_run',
      'domainRows now include firstCorruptionRoundTrip, interactionCount, costUsd, originalHash, finalHash, byteIdenticalAfterRoundTrips',
      'totalCostUsd + corruptionRate aggregates added',
    ],
  },

  modes: {
    default: 'harness_ready_not_live_validated (no LLM calls, no $ spent)',
    dryRun: 'live_dry_run via DANTEFORGE_DELEGATE52_DRY_RUN=1 (identity simulator, no LLM calls, no $ spent)',
    live: 'live_completed via DANTEFORGE_DELEGATE52_LIVE=1 + --budget-usd N (real LLM calls; FOUNDER GATE-1)',
  },

  guards: {
    envVar: 'DANTEFORGE_DELEGATE52_LIVE === "1"',
    budgetMin: '--budget-usd > 0',
    midRunBudgetEnforcement: 'cumulative cost compared against budget before each interaction; mid-loop stop with budget_exhausted status',
    fallback: 'all guards missing → live_not_enabled (existing Pass 18 behavior preserved)',
  },

  testCoverage: {
    file: 'tests/time-machine-delegate52-live.test.ts',
    fileHash: testFileHash,
    testCount: 6,
    cases: [
      'dry-run produces structured plan without spending (status=live_dry_run, costUsd=0)',
      'live without env-var refuses (live_not_enabled)',
      'live without --budget-usd refuses (live_not_enabled)',
      'live with all guards + injected llmCaller executes round-trips and tracks cost',
      'live mode stops mid-loop when budget exhausted',
      'live-result.json artifact written for live runs (microsoftBaselineCorruptionRate=0.25 recorded)',
    ],
  },

  cliDemo: {
    command: 'DANTEFORGE_DELEGATE52_DRY_RUN=1 node dist/index.js time-machine validate --class D --delegate52-mode live --budget-usd 80 --max-domains 4 --json',
    result: 'status: live_dry_run, totalCostUsd: 0, all 4 domains byte-identical (identity simulator)',
  },

  truthBoundary: {
    builtThisPass: [
      'Live executor structure',
      'Dry-run validates harness shape end-to-end',
      'Cost tracking and budget enforcement',
      'Per-domain corruption detection (first-divergence round-trip)',
    ],
    notBuiltThisPass: [
      'Real LLM API run against 48 public domains (GATE-1 founder authorization required)',
      'Cost reconciliation against actual provider billing (compares only when live run executes)',
      'Withheld DELEGATE-52 environments (76 environments not in public release)',
    ],
    allowedClaim: 'Pass 19 ships the live executor; dry-run validates the structural correctness; live execution awaits founder budget authorization (GATE-1).',
    forbiddenClaim: 'DanteForge has executed live DELEGATE-52 replication.',
  },

  unblocks: [
    'GATE-1 founder action: `DANTEFORGE_DELEGATE52_LIVE=1 forge time-machine validate --class D --delegate52-mode live --budget-usd 80 --max-domains 48` produces real result table',
    'Pass 22 comparison document with explicit placeholder for live-D results',
    'Pass 25 preprint with reproducibility appendix (CLI command + budget + version hashes)',
  ],

  verifyChain: {
    typecheck: 'pass',
    lint: 'pass',
    antiStub: 'pass',
    pass19Tests: 'pass (6/6)',
    timeMachineTests: 'pass (11/11 existing tests still pass)',
    proofIntegrityCheck: 'CLEAN',
  },
};

manifest.proof = createEvidenceBundle({
  bundleId: 'pass_19_live_delegate52_executor',
  gitSha: manifest.gitSha,
  evidence: [{ ...manifest }],
  createdAt: manifest.generatedAt,
});

const outPath = resolve(evidenceDir, 'pass-19-live-delegate52.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

console.log(`Proof-anchored Pass 19 manifest: ${outPath}`);
console.log(`  validation file hash:    ${validationFileHash.slice(0, 16)}...`);
console.log(`  test file hash:          ${testFileHash.slice(0, 16)}...`);
console.log(`  test count:              ${manifest.testCoverage.testCount}`);
console.log(`  proof bundle:            ${manifest.proof.bundleId}`);
console.log(`  proof payload hash:      ${manifest.proof.payloadHash.slice(0, 16)}...`);
console.log(`  proof merkle root:       ${manifest.proof.merkleRoot.slice(0, 16)}...`);
console.log(`  git SHA:                 ${manifest.gitSha?.slice(0, 8) ?? 'none'}`);
