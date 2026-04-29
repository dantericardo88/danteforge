/**
 * ID generators for truth-loop entities. Deterministic where possible.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from '@danteforge/evidence-chain';

export function nextRunId(rootDir: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const datePrefix = `run_${yyyy}${mm}${dd}_`;
  const truthLoopDir = resolve(rootDir, '.danteforge', 'truth-loop');
  let max = 0;
  if (existsSync(truthLoopDir)) {
    for (const entry of readdirSync(truthLoopDir)) {
      if (!entry.startsWith(datePrefix)) continue;
      const seq = Number.parseInt(entry.slice(datePrefix.length), 10);
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  }
  const next = String(max + 1).padStart(3, '0');
  return `${datePrefix}${next}`;
}

export function newArtifactId(): string {
  return `art_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function newEvidenceId(): string {
  return `evd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function newClaimId(): string {
  return `clm_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function newVerdictId(runId: string): string {
  return `vrd_${runId.slice(4)}`;
}

export function newNextActionId(runId: string): string {
  return `nax_${runId.slice(4)}`;
}

export function newBudgetEnvelopeId(runId: string): string {
  return `bud_${runId.slice(4)}`;
}

export { sha256 };
