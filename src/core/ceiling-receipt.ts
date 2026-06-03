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
  | 'court-rejected';   // the frontier-review-court judged the evidence not genuine competitor parity

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
