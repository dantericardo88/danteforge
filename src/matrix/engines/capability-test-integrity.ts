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

/** Trivially-green product subcommands that exit 0 regardless of any capability — not real yardsticks. */
const TRIVIAL_SUBCOMMANDS = new Set(['help', '--help', '-h', 'version', '--version', '-v', 'status']);

/** A green-forcing wrapper discards the real exit code (`|| true`, `; exit 0`, `|| echo`, trailing `; :`)
 *  so the command "passes" no matter what the product does — a self-fulfilling-pass signal (red-team). */
export function hasGreenForcingWrapper(cmd: string): boolean {
  return /\|\|\s*(?:true|exit\s+0|echo\b|:)/i.test(cmd) || /;\s*(?:true|exit\s+0|:)\s*$/i.test(cmd.trim());
}

/** Does a single command segment invoke the real product (CLI or built binary) on a NON-trivial subcommand? */
function isProductInvocation(seg: string): boolean {
  const m = /(?:^|\s)(?:node\s+dist\/index\.js|danteforge)\s+(--?[a-z][\w-]*|[a-z][\w-]*)/i.exec(seg);
  if (m) {
    // Grading-integrity #1: a real subcommand followed by ONLY a help/version flag is a USAGE BANNER,
    // not a product run — `validate --help`, `gap --help`, `party --help` exit 0 regardless of whether
    // the capability works. The old check looked only at the subcommand token and missed the trailing
    // flag, so `node dist/index.js gap --help` was misread as a genuine `gap` run.
    if (/(?:^|\s)(?:--help|-h|--version|-v)(?:\s|$)/i.test(seg)) return false;
    return !TRIVIAL_SUBCOMMANDS.has(m[1]!.toLowerCase());
  }
  return /target[/\\](?:release|debug)[/\\]/i.test(seg) || /(?:^|\s)\.[/\\](?:bin|dist)[/\\]/.test(seg);
}

/** A command whose EXIT is decided by a real, non-trivial product invocation. STRUCTURAL, not substring:
 *  the exit-determining (LAST) segment must itself be the product run — no green-forcing wrapper, no
 *  self-deciding `node -e`/fixture tail. Closes the red-team's "glue a product token to an inline fixture"
 *  bypass (`danteforge help; node -e "exit(0)"`, `node dist/index.js x || true`). */
export function looksLikeProductRun(cmd: string): boolean {
  if (isTestSuiteCommand(cmd)) return false;
  if (hasGreenForcingWrapper(cmd)) return false;
  const segs = cmd.split(/;|&&|\|\||\||\n/).map(s => s.trim()).filter(Boolean);
  const last = segs[segs.length - 1];
  if (!last) return false;
  if (/\bnode\s+-e\b/i.test(last) || /\b\w*fixture\w*\.(?:m?js|py)\b/i.test(last)) return false;
  return isProductInvocation(last);
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
  if (hasGreenForcingWrapper(command)) {
    return { ...base, verdict: 'SELF_FULFILLING_STUB', reason: 'Command discards its real exit code (|| true / ; exit 0 / || echo) — it passes regardless of the product, so it measures nothing.', needsAuthoring: true };
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
