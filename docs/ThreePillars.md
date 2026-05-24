DanteForge: The Three Pillars — Finish the Foundation
The integrated PRD
This is the comprehensive PRD to complete the three substrate pillars that must land before any further extension work (native code search, research mode, or anything else) proceeds. These three pieces close the structural gaps that allow the substrate to inflate scores or miss orphan failures. After this lands, the substrate is foundationally honest. Everything else builds on top.
Important context for Claude Code: Do not interleave this work with Phase L/M/N/O/P/Q/R from the autonomous frontier-reaching PRD. Those phases assume this foundation exists. If you have started any of those phases already, pause them, complete this PRD, then resume. The phase tags here use the I prefix (Integrity) so they don't conflict with prior numbering.
The three pillars are:

Pillar 1 (Phase I1): Single-writer reconciler that closes the six bypass surfaces
Pillar 2 (Phase I2): Orphan audit promoted to a substrate-level harden check
Pillar 3 (Phase I3): Production-import-recency as the sixth harden check

They must ship in order. Each builds on the prior. Do not parallelize.

Table of contents

Architectural vision and prerequisites
Constitutional invariants
Pillar 1: Single-writer reconciler (close six bypasses)
Pillar 2: Orphan audit as substrate gate
Pillar 3: Production-import-recency as sixth harden check
Integration validation across pillars
Cross-project rollout
Comprehensive verification artifacts
Consolidated stop conditions
What this enables


1. Architectural vision and prerequisites
What this completes
DanteForge currently has the harden gate working on the proposal path (matrix-development-engine.ts:376). It catches inflation when score writes flow through mergeScoreProposals. But six other surfaces in the codebase bypass that gate entirely — they write to dim.scores.self directly via updateDimensionScore + saveMatrix or via the _saveMatrix injection seam.
The harden gate currently has five checks (capability_test, claim-auditor, hardcoded-fallback, import-resolves, functional-diff). The DanteHarvest audit revealed a sixth failure mode (orphan implementations — capability test passes, but the module is never imported from production code). The DanteCode audit revealed a seventh (replacement-not-supplement — new module exists alongside legacy module that's still primary). Neither of these is currently caught by any gate.
This PRD closes both gaps:

Eliminate the six bypass surfaces so every score write must go through the gate
Add two new gate checks (orphan audit + production-import-recency) that catch the failure modes the existing five checks miss

After this lands, the substrate's score-write path is single-source-of-truth and the gate detects the failure modes the recent audits surfaced empirically.
Prerequisites
This PRD assumes:

The outcome-derived scoring PRD's Phase E (closing the six bypasses) is not complete — this PRD does that work properly
Phase F-K of outcome-derived scoring (outcome runner, derived computation, score lock) may or may not be complete; this PRD does not depend on them
The existing harden gate at matrix-development-engine.ts:376 is functional
The capability ladder (T0-T6) with score caps is in place
.danteforge/score-proposals/ exists and is the canonical proposal storage location
The existing five harden checks are working

If any of these prerequisites are not true, stop and report. Do not attempt to bootstrap missing prerequisites within this PRD.
Why these three pillars and not more
Five other improvements have been discussed but are deferred to the autonomous frontier-reaching PRD or to outcome-derived scoring completion: native code search, research mode, outcome-derived scoring lock, refactor-only crusade, per-project migration. None of those compose meaningfully on top of a substrate with bypass surfaces open. The three pillars are the minimum honest foundation.

2. Constitutional invariants
These hold throughout. Stop and report if any would be violated.
C1. No new external runtime dependencies. All work is native TypeScript using existing DanteForge libraries plus Node's standard library and git as a subprocess.
C2. Backward compatibility for valid operations. Operations that should succeed (proposing a score change with valid evidence) continue to work. Operations that should fail (inflating without evidence) now fail consistently across all surfaces.
C3. No silent score changes anywhere. Every score change is logged with its source surface, the proposal that triggered it, the evidence backing it, and the gate result. Logs live under .danteforge/score-changes/<date>.jsonl.
C4. Dispensation is the only operator escape hatch. When an operator must override the gate (e.g., emergency rollback, manual reconciliation), they use danteforge dispensation create --dim X --reason Y --evidence-path Z. Dispensations are audit-logged, require explicit reason, and expire after configurable time.
C5. The reconciler is itself capability-tested. Pillar 1 introduces a critical chokepoint. If the reconciler has a bug, the entire substrate fails. The reconciler ships with comprehensive capability tests including a wishful-9.0 e2e test against every migrated surface.
C6. No fast path around the reconciler. Every surface that previously wrote scores must now go through the reconciler. Performance concerns about the gate adding latency are not a valid reason to add a bypass. If the gate is too slow, optimize the gate, not the call path.
C7. The orphan audit and recency check apply to all dimensions equally. No dimension gets exempted because "it's a special case." Special cases are exactly how the matrix drifts from honesty over time. If a dimension genuinely cannot be audited this way (e.g., a meta-dimension about the substrate itself), document the exemption explicitly with reason and mark the dimension as audit-exempt in the matrix.

3. Pillar 1: Single-writer reconciler (close six bypasses)
Goal
Build one reconciler function that is the sole writer to dim.scores.self. Migrate all six existing bypass surfaces to route through it. Make any future attempt to write to dim.scores.self outside the reconciler structurally fail.
The six bypass surfaces
From Claude Code's own audit, the surfaces are:
FileLinesWhat it doessrc/cli/commands/compete-amend.ts44, 95danteforge compete --amend dim 9.0 writes score directlysrc/cli/commands/compete-calibrate.ts31Adversarial calibration writes directlysrc/cli/commands/compete.ts438actionRescore via _saveMatrix injection seamsrc/cli/commands/compete.ts624 (or 625)actionSyncScores via same seamsrc/cli/commands/compete.ts710 (or 711)actionAutoSprint via same seamsrc/core/ascend-engine.ts889Autonomous improvement loop direct writesrc/core/compete-matrix.ts405applyAdversarialCalibration in-place mutation
Note: this is actually seven surfaces across five files (compete.ts has three call sites). Claude Code's earlier audit said "six bypasses" but the precise count is seven. Treat all seven as equivalent targets for migration.
The reconciler architecture
Build src/core/single-writer-reconciler.ts:
typescriptimport { type CompeteMatrix, type MatrixDimension } from './compete-matrix.js';
import { runHardenChecks, type HardenResult } from '../matrix/engines/hardener.js';
import { writeScoreChangeLog } from './score-change-log.js';

export interface ScoreProposal {
  dimensionId: string;
  proposedScore: number;
  source: ProposalSource;        // which surface initiated this
  evidence: EvidenceBundle;       // what backs the proposal
  proposerAgent?: string;         // which agent or operator
  dispensationToken?: string;     // only for operator overrides
}

export type ProposalSource =
  | 'mergeScoreProposals'         // the original proposal path (already gated)
  | 'compete-amend'
  | 'compete-calibrate'
  | 'compete-rescore'
  | 'compete-sync-scores'
  | 'compete-auto-sprint'
  | 'ascend-engine-autonomous'
  | 'adversarial-calibration'
  | 'operator-dispensation';

export interface EvidenceBundle {
  capabilityTestEvidencePath?: string;
  hardenEvidencePath?: string;
  runtimeEvidencePath?: string;
  callsitesValidated?: string[];
  customEvidence?: Record<string, unknown>;
}

export interface ReconcileResult {
  status: 'accepted' | 'rejected' | 'capped';
  finalScore: number;             // what was actually written
  hardenResult: HardenResult;
  cappedBy?: string;              // which check capped, if any
  rejectionReason?: string;
  scoreChangeLogId: string;
}

/**
 * THE ONLY FUNCTION THAT MAY WRITE TO dim.scores.self.
 *
 * Every score-writing operation in DanteForge routes through here.
 * The function:
 *   1. Validates the proposal (schema, evidence, dispensation if present)
 *   2. Runs all harden checks
 *   3. Applies score caps from the harden result
 *   4. Writes the (possibly capped) score to the dim
 *   5. Logs the score change with full provenance
 *   6. Returns the result
 *
 * Callers MUST NOT write to dim.scores.self directly. The lint rule
 * (Pillar 1 step I1.5) enforces this.
 */
export async function reconcileScore(
  matrix: CompeteMatrix,
  proposal: ScoreProposal,
  cwd: string,
): Promise<ReconcileResult> {
  // implementation
}
The reconciler is the single chokepoint. All seven existing bypass surfaces, plus the existing mergeScoreProposals path, route through it. Every score write produces a score-change log entry.
Migration steps in order
I1.1 Build the reconciler module (1 day).
Implement src/core/single-writer-reconciler.ts with the API above. Implement src/core/score-change-log.ts for audit logging. Implement src/core/dispensation.ts for the operator-override path.
Write unit tests in tests/core/single-writer-reconciler.test.ts:

Accepts valid proposal with passing evidence
Rejects proposal with missing evidence
Caps score when harden check returns a cap
Logs every operation
Refuses proposal with invalid dispensation token
Accepts proposal with valid dispensation token but logs the override loudly

I1.2 Migrate compete-amend.ts (0.5 day).
Replace the direct updateDimensionScore + saveMatrix calls at lines 44 and 95 with reconcileScore calls. The CLI now writes a proposal and the gate fires. If the operator wants to force a value without evidence, they must use --force-dispensation <reason>.
Add to tests/cli/commands/compete-amend.test.ts:

Standard amend works when evidence is present
Amend rejected when evidence missing
Amend with --force-dispensation succeeds and writes dispensation log
e2e: danteforge compete --amend security 9.0 without evidence is refused

I1.3 Migrate compete-calibrate.ts (0.5 day).
Replace the direct write at line 31 with reconcileScore. The adversarial calibration produces proposals that flow through the gate. Calibration that disagrees with evidence gets capped.
Add to tests/cli/commands/compete-calibrate.test.ts:

Calibration with passing evidence proceeds
Calibration that would inflate beyond evidence cap gets capped to evidence-supported value
Calibration logs all proposals to score-change log

I1.4 Migrate compete.ts three surfaces (1 day).
Lines 438 (actionRescore), 624/625 (actionSyncScores), 710/711 (actionAutoSprint). All three currently use the _saveMatrix injection seam to bypass. Remove the seam entirely and route through reconcileScore. The seam was added for testing convenience and is no longer needed — tests now mock reconcileScore instead.
Rename test mocks from _loadMatrix/_saveMatrix to _reconcileMatrix consistent with the new pattern. Any test that previously injected _saveMatrix now injects _reconcileMatrix.
Add to tests/cli/commands/compete.test.ts:

actionRescore flows through reconciler
actionSyncScores flows through reconciler
actionAutoSprint flows through reconciler
No test injects _saveMatrix (search assertion: grep returns zero hits)

I1.5 Migrate ascend-engine.ts:889 (0.5 day).
The autonomous improvement loop currently writes via updateDimensionScore + saveMatrix. Replace with reconcileScore. The autonomous loop now produces proposals; if a proposal fails the gate, the loop logs the failure and moves to the next dimension instead of writing the inflated score.
Add to tests/core/ascend-engine.test.ts:

Autonomous loop writes via reconciler
Failed proposals from autonomous loop are logged, not written
Loop continues after a rejected proposal

I1.6 Migrate compete-matrix.ts:405 applyAdversarialCalibration (0.5 day).
The function currently mutates the matrix in place. Refactor so it returns a list of ScoreProposal objects instead. Callers iterate and route each through reconcileScore. This is the cleanest refactor because the function's job becomes "propose calibrations," not "apply them."
Update all callers of applyAdversarialCalibration to reconcile the returned proposals.
Add to tests/core/compete-matrix.test.ts:

applyAdversarialCalibration returns proposals
Returned proposals carry source = 'adversarial-calibration'
No in-place mutation occurs

I1.7 Add the structural lint rule (0.5 day).
After migration, add a lint rule that fails the build if any code outside single-writer-reconciler.ts writes to dim.scores.self. Implement as a custom ESLint rule or as a pre-commit grep check:
javascript// hooks/pre-commit-score-write-check.mjs
import { execSync } from 'node:child_process';

const result = execSync(
  `git grep -n "\\.scores\\.self\\s*=" -- 'src/**/*.ts' ':!src/core/single-writer-reconciler.ts' ':!tests/'`,
  { encoding: 'utf-8' }
).trim();

if (result) {
  console.error('FORBIDDEN: writes to dim.scores.self outside the reconciler:');
  console.error(result);
  process.exit(1);
}
Wire into hooks/pre-commit.mjs. This is the structural guarantee that no new bypass can be introduced silently.
I1.8 Wishful-9.0 e2e test against all migrated surfaces (1 day).
The most important test in this entire PRD. Create tests/e2e/wishful-9-refused-everywhere.test.ts:
typescriptdescribe('wishful 9.0 is refused at every score-writing surface', () => {
  it('refuses via compete --amend without evidence', async () => {
    const result = await runCli(['compete', '--amend', 'security', '9.0']);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('evidence required');
  });

  it('refuses via compete --calibrate when evidence caps below 9.0', async () => {
    // ... setup evidence that caps at 6.0
    const result = await runCli(['compete', '--calibrate', 'security']);
    expect(getScore('security')).toBeLessThanOrEqual(6.0);
  });

  it('refuses via compete --rescore when harden checks fail', async () => { /* ... */ });
  it('refuses via compete --sync-scores when proposal lacks evidence', async () => { /* ... */ });
  it('refuses via compete --auto-sprint when capability test fails', async () => { /* ... */ });
  it('refuses via ascend-engine autonomous loop', async () => { /* ... */ });
  it('refuses via applyAdversarialCalibration', async () => { /* ... */ });

  it('accepts proposed score when evidence and harden checks pass', async () => {
    // setup passing evidence
    const result = await runCli(['compete', '--amend', 'security', '8.0']);
    expect(result.exitCode).toBe(0);
    expect(getScore('security')).toBe(8.0);
  });

  it('accepts dispensation override with audit log', async () => {
    const result = await runCli([
      'compete', '--amend', 'security', '9.0',
      '--force-dispensation', 'emergency rollback for incident #123',
    ]);
    expect(result.exitCode).toBe(0);
    expect(readDispensationLog()).toContainEntry({
      dim: 'security',
      score: 9.0,
      reason: 'emergency rollback for incident #123',
    });
  });
});
This test is the validation that Pillar 1 is structurally complete. If any case fails, do not proceed to Pillar 2.
Pillar 1 stop conditions

Any migrated surface still writes via the old path → halt, audit, fix
The lint rule produces false positives on legitimate code → refine the rule, do not exempt the code
The reconciler has a bug that rejects valid proposals → halt all work, fix the reconciler, re-run all surface tests
A surface cannot be cleanly migrated (e.g., legacy code structure won't allow it) → halt, surface for human review, decide whether to refactor the surface or document an exemption with reason
Performance regression more than 2x on score-write paths → halt, optimize the reconciler, do not add a fast path

Pillar 1 verification artifacts
After Pillar 1 completes:

src/core/single-writer-reconciler.ts exists and is the only file that writes to dim.scores.self (lint check confirms)
All seven bypass surfaces routed through the reconciler
All migration unit tests pass
The e2e wishful-9.0-refused test passes for all seven surfaces
Pre-commit lint rule active and tested
Score change log accumulates entries from every surface


4. Pillar 2: Orphan audit as substrate gate
Goal
The DanteHarvest grep methodology that caught the orphan failure mode becomes a first-class harden check. Any dimension whose capability_callsite is only imported from its own capability test (or not imported at all from production code) is capped at score 6.0.
This is the structural fix for the DanteHarvest pattern where 13 of 50 dimensions had real implementations that passed capability tests but were never wired into production. The current five harden checks miss this because they verify the capability works in isolation, not that the capability is actually used.
The check specification
Build src/matrix/engines/orphan-audit.ts:
typescriptimport { type MatrixDimension } from '../../core/compete-matrix.js';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

export interface OrphanAuditResult {
  dimensionId: string;
  callsite: string;
  passed: boolean;                        // true if not orphan
  productionImports: ImportReference[];   // imports from non-test code
  testOnlyImports: ImportReference[];     // imports from *.test.* files
  cap: number;                            // 6.0 if orphan, 10.0 otherwise
  reason: string;
  evidencePath: string;
}

export interface ImportReference {
  file: string;
  lineNumber: number;
  importStatement: string;
  isProduction: boolean;
}

/**
 * Orphan audit: a dimension's capability is orphan if its capability_callsite
 * symbol is not imported from any file outside the capability test itself.
 *
 * Production imports are files NOT matching patterns:
 *   - *.test.ts, *.test.js, *.test.mjs, *.test.cjs
 *   - *.spec.ts, *.spec.js, *.spec.mjs, *.spec.cjs
 *   - **\/tests/**
 *   - **\/__tests__/**
 *   - **\/test-fixtures/**
 *   - **\/.danteforge/capability-tests/**
 *
 * If a dim has zero production imports, it is orphan (cap 6.0).
 * If a dim has ≥1 production imports, it passes (no cap from this check).
 */
export async function runOrphanAudit(
  dim: MatrixDimension,
  cwd: string,
): Promise<OrphanAuditResult> {
  // implementation
}
Implementation steps
I2.1 Build the orphan audit module (1 day).
The audit uses git grep to find all imports of the dimension's capability_callsite.symbol across the repository. It classifies each match as production or test based on the file path patterns above.
For symbol resolution, the audit handles both named imports (import { symbolName }) and namespace imports (import * as ns followed by ns.symbolName). Regex patterns for both should be tested explicitly.
Unit tests in tests/matrix/engines/orphan-audit.test.ts:

Detects production import correctly (returns passed=true)
Detects test-only import correctly (returns passed=false, cap=6.0)
Handles namespace imports
Handles re-exports correctly (counts the re-exporting file as a production import only if that file is itself imported from production)
Returns evidence path with full import map

I2.2 Register as a harden check (0.5 day).
The hardener pipeline at src/matrix/engines/hardener.ts currently runs five checks. Add runOrphanAudit as the sixth. The hardener's existing pattern is:
typescriptconst checks = [
  capabilityTest,
  claimAuditor,
  hardcodedFallback,
  importResolves,
  functionalDiff,
];
becomes:
typescriptconst checks = [
  capabilityTest,
  claimAuditor,
  hardcodedFallback,
  importResolves,
  functionalDiff,
  orphanAudit,  // NEW
];
Each check returns its cap (default Infinity if no cap applies). The hardener returns the minimum of all caps as the final cap.
Update tests/matrix/engines/hardener.test.ts to include orphan audit in the standard pipeline tests.
I2.3 Make it apply to existing matrices retroactively (0.5 day).
Running danteforge harden on an existing project should immediately reveal orphans. Add danteforge harden audit-orphans as a CLI subcommand that runs only the orphan check across all dims and produces a report.
Add to src/cli/commands/harden.ts the new subcommand. Tests in tests/cli/commands/harden.test.ts:

harden audit-orphans runs on a fixture project
Identifies orphan dims correctly
Caps their scores via the reconciler (Pillar 1 integration — this is where Pillar 1 enables Pillar 2)
Logs each cap to the score-change log with source = 'orphan-audit-promotion'

I2.4 Capability test for the orphan audit itself (0.5 day).
Add .danteforge/capability-tests/orphan_audit.sh that proves the orphan audit fires correctly:
bash#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Build a fixture where one symbol is imported from test only, one from production
node --experimental-vm-modules tests/fixtures/orphan-audit-fixture-setup.mjs

# Run orphan audit
output=$(node dist/cli/danteforge.js harden audit-orphans --format json)

# Assert: orphan dim is detected and capped
echo "$output" | jq -e '.orphans | length >= 1' > /dev/null
echo "$output" | jq -e '.orphans[0].cap == 6.0' > /dev/null
echo "$output" | jq -e '.orphans[0].reason | contains("only imported from test")' > /dev/null

# Cleanup
node --experimental-vm-modules tests/fixtures/orphan-audit-fixture-teardown.mjs

echo "PASS: orphan_audit capability test"
I2.5 Document the check (0.5 day).
Update docs/harden-checks.md (or create if missing) with documentation of the six checks. The orphan audit's section explains:

What it detects
The cap it applies
How to remediate (wire the module into production code, not just tests)
How to handle legitimate exemptions (the dim is intentionally test-only — document with explicit audit_exempt: 'test-only-by-design' field on the dim, with reason)

Pillar 2 stop conditions

Orphan audit produces false positives (flags production-imported modules as orphan) → fix the audit, do not lower the bar
Orphan audit cannot determine production vs test files reliably → expand the path patterns or move to AST-based classification
Existing projects have so many orphans that the cap drops are too aggressive → that's the truth surfacing; do not soften the cap, surface honestly
A dim is legitimately test-only and the audit cannot be exempted cleanly → add the audit_exempt field, document the reason in the dim metadata

Pillar 2 verification artifacts
After Pillar 2 completes:

src/matrix/engines/orphan-audit.ts implemented
Registered as the sixth harden check
danteforge harden audit-orphans CLI subcommand works
Capability test passes
Documentation in docs/harden-checks.md
Score-change log shows all orphan-related caps applied to existing matrices


5. Pillar 3: Production-import-recency as sixth harden check
Wait — Pillar 2 already added the sixth check (orphan audit). Pillar 3 adds the seventh. Let me correct the framing: the harden gate had five checks; orphan audit becomes the sixth; production-import-recency becomes the seventh.
Goal
A dimension whose capability_callsite is imported from production code but the importing file hasn't been modified in main-branch git history within N days (default 30) is capped at score 7.0. This catches the replacement-not-supplement failure mode from the DanteCode and DanteHarvest audits where new modules exist but legacy modules are still primary in active production code.
The check specification
Build src/matrix/engines/recency-check.ts:
typescriptimport { type MatrixDimension } from '../../core/compete-matrix.js';

export interface RecencyCheckResult {
  dimensionId: string;
  callsite: string;
  passed: boolean;
  importingFiles: ImportingFile[];
  freshestImportingFile?: ImportingFile;
  daysSinceFreshest: number;
  thresholdDays: number;            // default 30
  cap: number;                      // 7.0 if stale, 10.0 if fresh
  reason: string;
  evidencePath: string;
}

export interface ImportingFile {
  file: string;
  lastModifiedMainCommit: string;   // git sha of last main-branch commit touching this file
  lastModifiedDate: Date;
  daysSinceModified: number;
  tracesToEntryPoint: boolean;      // does this file's import graph reach a user-facing entry point?
  entryPointPath?: string;
}

/**
 * Production-import-recency check: a dimension's capability is "stale" if
 * none of its production imports are in files that were modified on main
 * within the last N days AND trace to a user-facing entry point.
 *
 * "User-facing entry point" patterns:
 *   - src/cli/**\/*.ts (CLI commands)
 *   - src/api/**\/*.ts (API routes)
 *   - src/mcp/**\/*.ts (MCP tool exports)
 *   - bin/* (executable scripts)
 *   - Other patterns configurable per-project at .danteforge/config/entry-points.json
 *
 * Cap of 7.0 if no fresh+traceable importing file exists.
 * No cap from this check if at least one fresh+traceable importing file exists.
 */
export async function runRecencyCheck(
  dim: MatrixDimension,
  cwd: string,
  thresholdDays: number = 30,
): Promise<RecencyCheckResult>;
Implementation steps
I3.1 Build the recency check module (1 day).
The check requires two operations:
First, git log to find last-modified date of each importing file on the main branch:
typescriptfunction getLastMainCommitForFile(file: string, cwd: string): GitCommitInfo {
  const result = execSync(
    `git log -1 --format="%H|%aI" --first-parent main -- "${file}"`,
    { cwd, encoding: 'utf-8' }
  ).trim();
  // parse and return
}
Second, trace whether the importing file's call graph reaches a user-facing entry point. Initially implement a simple two-hop check: the importing file is itself imported by a file matching entry-point patterns, OR the importing file matches entry-point patterns. Phase L (if it lands) can replace this with a full call-graph trace.
Unit tests in tests/matrix/engines/recency-check.test.ts:

Fresh import (modified yesterday) and entry-point-reachable → passes
Fresh import but not entry-point-reachable → caps at 7.0
Stale import (modified 60 days ago) → caps at 7.0
No production imports at all → passes through (orphan audit handles this case at Pillar 2)
Configurable threshold works (override default 30 days)

I3.2 Configurable entry-point patterns (0.5 day).
Per-project entry-point configuration at .danteforge/config/entry-points.json:
json{
  "patterns": [
    "src/cli/**/*.ts",
    "src/api/**/*.ts",
    "src/mcp/**/*.ts",
    "bin/*"
  ],
  "exclusions": [
    "src/cli/internal/**"
  ],
  "thresholdDays": 30
}
Defaults if the config file is absent. Test that the config is honored.
I3.3 Register as a harden check (0.5 day).
Add runRecencyCheck to the hardener pipeline:
typescriptconst checks = [
  capabilityTest,
  claimAuditor,
  hardcodedFallback,
  importResolves,
  functionalDiff,
  orphanAudit,
  recencyCheck,  // NEW
];
Same minimum-cap semantics: hardener returns the minimum of all caps.
I3.4 CLI surface (0.5 day).
Add danteforge harden audit-recency as a CLI subcommand. Same pattern as orphan audit. Produces a report of stale dimensions.
Tests in tests/cli/commands/harden.test.ts:

harden audit-recency runs on a fixture project
Identifies stale dims correctly
Caps via the reconciler with source = 'recency-check-promotion'

I3.5 Capability test (0.5 day).
Add .danteforge/capability-tests/recency_check.sh:
bash#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# Build a fixture with one fresh-and-traceable import, one stale import, one fresh-but-not-traceable
node --experimental-vm-modules tests/fixtures/recency-fixture-setup.mjs

output=$(node dist/cli/danteforge.js harden audit-recency --format json)

# Assert: stale dim capped at 7.0
echo "$output" | jq -e '.stale | map(select(.cap == 7.0)) | length >= 1' > /dev/null

# Assert: fresh-and-traceable dim is not capped
echo "$output" | jq -e '.passed | length >= 1' > /dev/null

# Assert: fresh-but-not-traceable dim is capped at 7.0 with traceability reason
echo "$output" | jq -e '.stale | map(select(.reason | contains("does not trace to entry point"))) | length >= 1' > /dev/null

node --experimental-vm-modules tests/fixtures/recency-fixture-teardown.mjs

echo "PASS: recency_check capability test"
I3.6 Documentation update (0.5 day).
Update docs/harden-checks.md with the seventh check. Explain:

What it catches (the replacement-not-supplement pattern)
The default 30-day threshold and how to override
How to remediate (modify the relevant production file recently, or document an architectural cap)
The entry-point pattern configuration

Pillar 3 stop conditions

Git log is too slow on large repos → cache results by file+sha
Entry-point patterns produce too many false negatives (lots of stale dims) → audit the patterns, adjust the config
The two-hop entry-point check produces too many false positives → expand the trace depth or wait for Phase L's call-graph capability
30-day threshold flags too many real dims as stale → adjust the default after auditing what the dims actually look like, but do not weaken the check past meaningful

Pillar 3 verification artifacts
After Pillar 3 completes:

src/matrix/engines/recency-check.ts implemented
Registered as the seventh harden check
danteforge harden audit-recency CLI subcommand works
Capability test passes
Documentation in docs/harden-checks.md
Score-change log shows all recency-related caps applied to existing matrices


6. Integration validation across pillars
After all three pillars land individually, run a combined integration test that proves the whole system holds together.
The integrated end-to-end test
tests/e2e/three-pillars-integration.test.ts:
typescriptdescribe('three pillars integration', () => {
  it('full path: surface → reconciler → all seven harden checks → cap → log', async () => {
    // Setup: a project with three dims:
    //   - dim_real: real implementation, fresh production import, entry-point-traceable
    //   - dim_orphan: real implementation, only test imports
    //   - dim_stale: real implementation, production import is 60 days old

    // Run autonomous improvement loop, which tries to set all three to 9.0
    await runCli(['compete', '--auto-sprint']);

    // Assert: dim_real reaches 9.0 (passes everything)
    expect(getScore('dim_real')).toBe(9.0);

    // Assert: dim_orphan capped at 6.0 by orphan audit
    expect(getScore('dim_orphan')).toBe(6.0);

    // Assert: dim_stale capped at 7.0 by recency check
    expect(getScore('dim_stale')).toBe(7.0);

    // Assert: score-change log contains entries for all three with proper source attribution
    const log = readScoreChangeLog();
    expect(log).toContainEntryMatching({ dim: 'dim_real', cap: null });
    expect(log).toContainEntryMatching({ dim: 'dim_orphan', cappedBy: 'orphan-audit' });
    expect(log).toContainEntryMatching({ dim: 'dim_stale', cappedBy: 'recency-check' });

    // Assert: no bypass occurred (every score change came through reconciler)
    const writes = grepForScoreSelfWrites();
    expect(writes).toEqual([]);  // lint rule guarantees this
  });

  it('the lint rule catches any new bypass attempt', async () => {
    // Programmatically add a file that writes dim.scores.self outside the reconciler
    writeFile('src/test-bypass.ts', 'dim.scores.self = 9.0;');

    const result = await runPreCommit();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('FORBIDDEN: writes to dim.scores.self outside the reconciler');

    deleteFile('src/test-bypass.ts');
  });

  it('every existing project audit produces honest caps when run with all three pillars', async () => {
    // Run the integrated harden against DanteHarvest's current state
    // The expected outcome: orphans cap to 6.0, stale entries cap to 7.0
    // Composite score drops honestly to reflect the true state

    const beforeScore = getCompositeScore('danteharvest-fixture');
    await runCli(['harden', '--all'], { cwd: 'tests/fixtures/danteharvest-fixture' });
    const afterScore = getCompositeScore('danteharvest-fixture');

    expect(afterScore).toBeLessThan(beforeScore);
    expect(afterScore).toBeLessThanOrEqual(7.2);  // matches the empirical audit finding
  });
});
This three-part test is the final validation. If it passes, the three pillars are complete.

7. Cross-project rollout
After DanteForge itself has the three pillars complete and self-tested:
Phase R1: DanteForge self-audit.
Run danteforge harden --all on DanteForge's own dimension matrix. Document the score change. Expected: some drop from the current composite, possibly significant. Surface honestly.
Phase R2: DanteHarvest re-audit.
The DanteHarvest grep audit was done manually and found composite 9.07 → 7.12. Running the new substrate with all three pillars should reproduce roughly that result automatically. If it does, the substrate has reproduced manual audit findings programmatically.
Phase R3: DanteFinance re-audit.
Should reproduce the 8.93 → 7.56 audit finding automatically.
Phase R4: DanteCode re-audit.
The DanteCode audit was the most rigorous (four parallel agents). The substrate should reproduce roughly 7.23 → 6.97 (the empirical finding).
If all four reproduce within ±0.3 of the manual audit findings, the substrate has demonstrated it can replace manual audits. That's the final proof of completion.

8. Comprehensive verification artifacts
After everything completes, paste these back:
Reconciler artifacts:

src/core/single-writer-reconciler.ts with full implementation
src/core/score-change-log.ts
src/core/dispensation.ts
Score-change log entries showing all seven migrated surfaces have written through the reconciler in tests

Migration artifacts:

Diff for each migrated file showing the old direct write removed and the reconciler call added
Test output for each migrated surface
Pre-commit lint output proving the structural guarantee

E2E test artifacts:

Output of tests/e2e/wishful-9-refused-everywhere.test.ts passing all cases
Output of tests/e2e/three-pillars-integration.test.ts passing all cases

Orphan audit artifacts:

src/matrix/engines/orphan-audit.ts
.danteforge/capability-tests/orphan_audit.sh output
Sample run of danteforge harden audit-orphans on a fixture
docs/harden-checks.md updated

Recency check artifacts:

src/matrix/engines/recency-check.ts
.danteforge/capability-tests/recency_check.sh output
Sample run of danteforge harden audit-recency on a fixture
.danteforge/config/entry-points.json example
docs/harden-checks.md updated

Cross-project rollout artifacts:

Before/after composite scores for DanteForge, DanteHarvest, DanteFinance, DanteCode
Comparison table: manual audit finding vs substrate-generated finding
Honest documentation of any divergence


9. Consolidated stop conditions
Pillar 1 (reconciler) stops:

Reconciler has a bug that rejects valid proposals → halt all work
Performance regression more than 2x on any score-write path → optimize gate, don't bypass
Lint rule produces false positives → refine rule, don't exempt
A surface can't be cleanly migrated → halt, surface for human review

Pillar 2 (orphan audit) stops:

False positives flagging production-imported modules as orphan → fix audit
Can't distinguish production from test files reliably → expand patterns or move to AST
Audit too aggressive on existing projects → that's truth surfacing; don't soften

Pillar 3 (recency check) stops:

Git log too slow on large repos → cache by file+sha
Entry-point patterns produce false negatives → audit and adjust config
30-day threshold flags too many real dims → adjust default after auditing

Universal stops:

Constitutional invariant violation
Phase order violation (working on Pillar 2 before Pillar 1 is verified complete)
Cross-project rollout reveals systematic issues → halt, fix in DanteForge first
Composite score drops on any project by more than 2.5 points → that's expected for some projects but warrants explicit operator review before proceeding


10. What this enables
After all three pillars land:
Structural inflation prevention. Score writes have a single chokepoint. The seven bypass surfaces are gone. New bypasses are caught by the lint rule. Inflation cannot happen via the surface paths that previously allowed it.
Orphan failure mode detected automatically. The DanteHarvest grep audit becomes a substrate primitive that runs on every harden invocation. Orphans get capped at 6.0 automatically. No manual audit needed to surface them.
Replacement-not-supplement detected automatically. The DanteCode replacement-not-supplement pattern (new modules exist alongside legacy that's still primary) gets caught by the recency check. Stale-but-imported modules cap at 7.0. The substrate cannot pretend new work has shipped when the production code path still uses the old version.
The score becomes an honest measurement. The composite score reflects (a) capability that works, (b) is actually used in production, (c) recently used in code that traces to user-facing entry points. Any of those three failing caps the score honestly. Inflation is structurally prevented.
The autonomous frontier-reaching PRD can build on top. Phase L (native code search) becomes leverage on top of an honest foundation. Phases N-R (research mode, parallel agents, synthesis) compose cleanly because the score they're optimizing against is honest. Without this work, all of those phases compound the proxy problem.
Manual audits become substrate operations. The four-parallel-agent audit on DanteCode, the grep audit on DanteHarvest — these become operations the substrate runs itself. Future projects don't require manual audit setup; they get the audit automatically on every harden invocation.
The substrate completes its foundational layer. Outcome-derived scoring (Phases E-K of the prior PRD) addressed the writable-target problem at the schema level. This PRD addresses it at the implementation level (seven bypass surfaces) and adds the two missing failure-mode detectors that empirical audits surfaced. Together, the substrate now catches:

Stubs with sophisticated harness (capability_test)
Inflated claims (claim-auditor)
Hardcoded fallbacks (hardcoded-fallback)
Silent stubs (import-resolves)
Identical output for distinct inputs (functional-diff)
Orphan implementations (orphan-audit — Pillar 2)
Stale production imports (recency-check — Pillar 3)
Bypass surfaces (single-writer reconciler — Pillar 1)

Eight structural defenses against the AI-coding-loop failure modes that the empirical audits have surfaced over the past month. After this lands, the next set of failure modes only becomes visible when the substrate is actually used on real work with consequences outside the system.

One concrete clarification before this runs
Two things to confirm with Claude Code before starting:
1. Is the prior PRD's Phase E complete? Phase E from the outcome-derived scoring PRD was supposed to close the six (or seven) bypasses. If that work has landed in any form, this PRD's Pillar 1 may overlap. Have Claude Code report which of the seven bypass surfaces are already migrated to the proposal+reconciler pattern, and which are not. Then this PRD's Pillar 1 only covers the ones still bypassing.
2. The phase L/M work that just landed (commits 228fb3f and 80db822) — what specifically is in it? If those commits touched any of the seven bypass surfaces, the migration may be partially done. Claude Code should report on each of the seven surfaces: which is migrated, which is not, and which has a partial migration that needs completing.
Once these two questions are answered, this PRD becomes the precise scope of remaining work. Without those answers, there's a risk of duplicating completed work or missing already-partial migrations.

Paste this PRD to Claude Code working on DanteForge as docs/PRDs/three-pillars-foundation.md. The work belongs in DanteForge. It completes the substrate's foundational layer. Everything else — native code search, research mode, autonomous frontier-reaching — composes on top of this. Without this, those phases compound the proxy problem they're nominally trying to solve.
Report after each pillar. Do not interleave pillars. Do not skip ahead.