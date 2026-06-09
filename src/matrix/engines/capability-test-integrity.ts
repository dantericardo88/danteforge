// capability-test-integrity.ts — the yardstick auditor: does a dimension's capability_test actually
// MEASURE something real, or is it a self-fulfilling stub the autonomous loop would no-op against?
//
// Outcome honesty (classifyOutcomeKind + orphan/wiring/no-stub) is strong, but the capability_test —
// the metric the autonomous build loop drives toward — was only ever EXECUTED, never audited for
// integrity. That is the hole the fleet's stubs live in: a `python scripts/dante.py test X` that checks
// its own inline fixtures (never the wired product) ALWAYS passes, so the loop sees "metric already at
// target" and builds nothing. This module classifies every dim's yardstick so the conductor can treat a
// fake metric as SETUP WORK (author a real, failing, competitor-grounded test) instead of a passing one.
//
// HONESTY: this only READS + classifies. It never marks a stub as real. The definitive proof that a
// yardstick exercises wired code is the dynamic sensitivity probe (break the callsite → a real test must
// fail) — built on top of this static pass; here we surface the strong static signals deterministically.

import path from 'node:path';
import { isStructuralFileCheck, isTestSuiteCommand } from './outcome-quality.js';
import { buildWiredBasenames } from './outcome-integrity.js';

export type YardstickVerdict =
  /** Invokes the REAL product (node dist/index.js <cmd>, danteforge <cmd>, or a built binary) — the
   *  strongest yardstick; a dynamic sensitivity probe can confirm it depends on production code. */
  | 'REAL_PRODUCT_PROBE'
  /** A test suite / runner that exercises a WIRED production callsite — real, but tier-capped at T4. */
  | 'REAL_TEST'
  /** readFileSync/existsSync — proves code EXISTS, not that it RUNS. Capped at 7.0; not a frontier metric. */
  | 'STRUCTURAL_ONLY'
  /** A test/script with NO wired production callsite — it can only be checking its own fixtures. The
   *  fleet-wide failure mode; the loop must AUTHOR a real test before it can build the dim. */
  | 'SELF_FULFILLING_STUB'
  /** A literal `exit 1` / `exit 0` / trivial placeholder — no capability declared yet. */
  | 'SCAFFOLD'
  /** No capability_test declared (or no_capability_test marker). */
  | 'NONE';

export interface YardstickAudit {
  dimId: string;
  verdict: YardstickVerdict;
  command: string | null;
  /** Production src/ callsites the dim declares (via its outcomes) that are wired into production. */
  wiredCallsites: string[];
  hasLadder: boolean;
  reason: string;
  /** True when the autonomous loop must AUTHOR a real, failing, competitor-grounded yardstick before it
   *  can honestly build this dim — a fake/structural/missing metric cannot drive real capability work. */
  needsAuthoring: boolean;
}

interface DimLike {
  id: string;
  capability_test?: { command?: string } | { no_capability_test: true } | unknown;
  no_capability_test?: boolean;
  outcomes?: Array<Record<string, unknown>>;
}

/** A real product invocation (not a test runner): the CLI itself, or a built binary. */
function looksLikeProductRun(cmd: string): boolean {
  if (isTestSuiteCommand(cmd)) return false;
  return /(?:node\s+dist\/index\.js|(?:^|\s|&&\s*)danteforge)\s+[a-z][\w-]*/i.test(cmd)
    || /target[/\\](?:release|debug)[/\\]/i.test(cmd)
    || /(?:^|\s)\.[/\\](?:bin|dist)[/\\]/.test(cmd);
}

/** A trivial placeholder command (matrix-build scaffold) — no real capability behind it. */
function isScaffoldCommand(cmd: string): boolean {
  const c = cmd.trim().toLowerCase();
  return /^exit\s+\d+$/.test(c) || c === 'true' || c === 'false' || c === ':' || c.length === 0;
}

function capabilityCommandOf(dim: DimLike): string | null {
  if (dim.no_capability_test) return null;
  const ct = dim.capability_test as { command?: string; no_capability_test?: boolean } | undefined;
  if (!ct || ct.no_capability_test) return null;
  return typeof ct.command === 'string' && ct.command.trim() ? ct.command : null;
}

/** The dim's declared production callsites (src/ files from its outcomes) that are WIRED into production. */
function wiredCallsitesOf(dim: DimLike, wired: Set<string>): string[] {
  const out: string[] = [];
  for (const o of dim.outcomes ?? []) {
    const cs = o.required_callsite;
    if (typeof cs !== 'string' || !cs || /TODO/i.test(cs)) continue;
    // A production callsite (not a test file) whose module name is imported by production code.
    // buildWiredBasenames stores module names WITHOUT extension, so strip the file extension to match.
    const isTestFile = /\.(test|spec)\.[tj]sx?$|[._-]test\.(py|go|rs|mjs)$|(^|[/\\])tests?[/\\]/i.test(cs);
    const moduleName = path.basename(cs).replace(/\.[^.]+$/, '');
    if (!isTestFile && wired.has(moduleName)) out.push(cs);
  }
  return [...new Set(out)];
}

/** Classify one dimension's capability_test. `wired` is the project's wired-basename set; `hasLadder`
 *  is whether a competitor-grounded Score Ladder exists for the dim. Pure + deterministic. */
export function auditCapabilityTest(dim: DimLike, wired: Set<string>, hasLadder: boolean): YardstickAudit {
  const command = capabilityCommandOf(dim);
  const wiredCallsites = wiredCallsitesOf(dim, wired);
  const base = { dimId: dim.id, command, wiredCallsites, hasLadder };

  if (!command) {
    return { ...base, verdict: 'NONE', reason: 'No capability_test declared (capped at 5.0).', needsAuthoring: true };
  }
  if (isScaffoldCommand(command)) {
    return { ...base, verdict: 'SCAFFOLD', reason: `Placeholder command "${command}" — no real capability behind it yet.`, needsAuthoring: true };
  }
  if (isStructuralFileCheck(command)) {
    return { ...base, verdict: 'STRUCTURAL_ONLY', reason: 'Structural file check (readFileSync/existsSync) — proves code exists, not that it runs; cannot exceed 7.0.', needsAuthoring: true };
  }
  if (looksLikeProductRun(command)) {
    return { ...base, verdict: 'REAL_PRODUCT_PROBE', reason: 'Invokes the real product — the strongest yardstick (confirm dependence with a dynamic sensitivity probe).', needsAuthoring: false };
  }
  // A test suite or script: it is only a REAL yardstick if it exercises WIRED production code. With no
  // wired production callsite, it can only be checking its own fixtures — the self-fulfilling stub.
  if (wiredCallsites.length > 0) {
    return { ...base, verdict: 'REAL_TEST', reason: `Exercises wired production callsite(s): ${wiredCallsites.join(', ')} (tier-capped at T4/7.0 unless a real product run is added).`, needsAuthoring: false };
  }
  return {
    ...base, verdict: 'SELF_FULFILLING_STUB',
    reason: 'No wired production callsite — this command cannot prove it exercises the real product, so it can only be checking its own fixtures. The loop must author a real, ladder-grounded yardstick.',
    needsAuthoring: true,
  };
}

/** Audit every dimension's capability_test for a matrix. Builds the wired-basename set ONCE. */
export async function auditAllCapabilityTests(
  matrix: { dimensions: DimLike[] },
  projectPath: string,
  hasLadderFn: (dimId: string) => boolean,
): Promise<YardstickAudit[]> {
  const wired = await buildWiredBasenames(projectPath);
  return matrix.dimensions.map(d => auditCapabilityTest(d, wired, hasLadderFn(d.id)));
}

/** A one-line census of yardstick verdicts (for the conductor + the CLI summary). */
export function summarizeYardsticks(audits: YardstickAudit[]): Record<YardstickVerdict, number> {
  const counts = { REAL_PRODUCT_PROBE: 0, REAL_TEST: 0, STRUCTURAL_ONLY: 0, SELF_FULFILLING_STUB: 0, SCAFFOLD: 0, NONE: 0 } as Record<YardstickVerdict, number>;
  for (const a of audits) counts[a.verdict]++;
  return counts;
}
