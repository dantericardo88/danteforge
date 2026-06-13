// ceiling-receipt.ts — signed "honest ceiling" records for the autonomous frontier loop.
//
// The orchestrator is "complete" when every dim is FRONTIER_REACHED *or* has a ceiling receipt:
// a durable, auditable statement of WHY a dim cannot honestly reach 9.0 right now. This is how
// "all to 9" stays honest — an unreachable dim gets a signed ceiling, never a faked green. A
// receipt can carry a `reviewAfter` so an environment/R&D ceiling is re-attempted once the world
// changes (network enabled, host installed, more research done), rather than written off forever.

import fs from 'node:fs/promises';
import path from 'node:path';

const CEILING_DIR_REL = path.join('.danteforge', 'ceilings');

export type CeilingCause =
  | 'market-cap'        // structural cap (community_adoption / enterprise_readiness) — pre-release can't reach 9
  | 'r-and-d-gap'       // the honest score IS the result (e.g. swe_bench pass-rate) — long-horizon research
  | 'environment'       // missing host/network/device/key — fixable substrate, re-attempt after
  | 'generator-ceiling' // the agent genuinely could not build the frontier capability this pass
  | 'court-rejected'    // the frontier-review-court judged the evidence not genuine competitor parity
  | 'build-failed'      // the build/evidence/court sub-command FAILED TO RUN (crash / no evidence) — NOT a
                        // court rejection. An operational blocker, re-attempt after fixing the build. The
                        // engine must never record a failed-to-run push as 'generator-ceiling'/'court-rejected'.
  | 'spec-incomplete';  // the dim's frontier_spec is missing genuinely-human real-user-path fields
                        // (observed_capability / category_delta / observable artifact) — the loop auto-derived
                        // what it honestly could; reaching 9.0 requires authoring the rest. Actionable + re-openable.

export interface CeilingReceipt {
  dimId: string;
  /** The honest score the dim is held at. */
  cap: number;
  cause: CeilingCause;
  /** Human-readable reason. */
  detail: string;
  /** Which gates/checks/court verdicts capped it. */
  failedGates: string[];
  /** What a human or the environment must do to lift it (e.g. "enable network for go mod download"). */
  requiredExternalAction?: string;
  /** The court's verdict when cause is court-rejected / generator-ceiling. */
  councilVote?: { pass: number; fail: number; summary: string };
  timeMachineCommit?: string | null;
  recordedAt: string;
  /** ISO date after which the orchestrator should RE-ATTEMPT this dim (env/r-and-d ceilings). */
  reviewAfter?: string;
  /** The engine commit SHA that MINTED this ceiling (CH-018). generator-ceiling / build-failed /
   *  court-rejected ceilings measure the GENERATOR (the build+court engine); when the engine that
   *  failed them materially changes, their premise is stale and the orchestrator re-opens them
   *  cause-awarely instead of holding forever (run 3g–3k minted 8 permanent ceilings while plan
   *  decomposition and codex judging were structurally broken; the fixed engine never retried them).
   *  Absent on legacy receipts — we never invent provenance, so a receipt with no engineSha is held. */
  engineSha?: string;
}

/** Causes whose premise IS the generator/engine — they re-open when the engine SHA changes (CH-018).
 *  market-cap / spec-incomplete / environment / r-and-d are about the WORLD or the SPEC, not the
 *  engine, so an engine rebuild does not invalidate them. */
const ENGINE_BOUND_CAUSES: ReadonlySet<CeilingCause> = new Set<CeilingCause>(['generator-ceiling', 'build-failed', 'court-rejected']);

/**
 * Should this ceiling re-open because the engine that minted it has changed? Pure (CH-018).
 * Only engine-bound causes re-open, and only when the receipt CARRIES a minting SHA that differs
 * from the current engine SHA. A receipt with no engineSha (legacy) or an unknown current SHA is
 * left untouched — re-opening on absent provenance would be guessing.
 */
export function shouldReopenForEngine(receipt: CeilingReceipt, currentEngineSha: string | null): boolean {
  if (!currentEngineSha || !receipt.engineSha) return false;
  if (!ENGINE_BOUND_CAUSES.has(receipt.cause)) return false;
  return receipt.engineSha !== currentEngineSha;
}

function receiptPath(cwd: string, dimId: string): string {
  return path.join(cwd, CEILING_DIR_REL, `${dimId}.json`);
}

export async function writeCeilingReceipt(
  cwd: string,
  receipt: CeilingReceipt,
  _write: (p: string, c: string) => Promise<void> = async (p, c) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, c, 'utf8');
  },
): Promise<void> {
  await _write(receiptPath(cwd, receipt.dimId), JSON.stringify(receipt, null, 2) + '\n');
}

export async function loadCeilingReceipt(
  cwd: string,
  dimId: string,
  _read: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<CeilingReceipt | null> {
  try {
    return JSON.parse(await _read(receiptPath(cwd, dimId))) as CeilingReceipt;
  } catch {
    return null;
  }
}

export async function loadAllCeilingReceipts(
  cwd: string,
  _readdir: (p: string) => Promise<string[]> = (p) => fs.readdir(p),
  _read: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<CeilingReceipt[]> {
  let entries: string[];
  try { entries = await _readdir(path.join(cwd, CEILING_DIR_REL)); } catch { return []; }
  const out: CeilingReceipt[] = [];
  for (const e of entries) {
    if (!e.endsWith('.json')) continue;
    try { out.push(JSON.parse(await _read(path.join(cwd, CEILING_DIR_REL, e))) as CeilingReceipt); } catch { /* skip */ }
  }
  return out;
}

/**
 * Is the ceiling still in force? A receipt with no `reviewAfter` is permanent until manually
 * lifted (e.g. market-cap). One with a `reviewAfter` is active only until that date — after which
 * the orchestrator should re-attempt the dim (the env/research may have changed).
 */
export function isCeilingActive(receipt: CeilingReceipt, nowIso: string): boolean {
  if (!receipt.reviewAfter) return true;
  return nowIso < receipt.reviewAfter;
}

/**
 * A dim counts as "done" for STOP accounting when it is at the frontier OR carries an active
 * ceiling. Market caps and confirmed generator ceilings are terminal-done; an expired env/R&D
 * ceiling is NOT done (re-attempt).
 */
export function isDimComplete(atFrontier: boolean, receipt: CeilingReceipt | null, nowIso: string): boolean {
  if (atFrontier) return true;
  return receipt != null && isCeilingActive(receipt, nowIso);
}
