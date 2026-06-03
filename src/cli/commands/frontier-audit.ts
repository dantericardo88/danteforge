// frontier-audit.ts — the human side of the non-blocking audit-escrow.
//
//   danteforge frontier-audit                         list pending court decisions to spot-check
//   danteforge frontier-audit <dim> --confirm --reviewer NAME
//   danteforge frontier-audit <dim> --fail --reviewer NAME --note "..."   (downgrades the dim)
//
// A FAILED audit downgrades the dim's frontier_spec from `validated` back to `frozen` (the frontier
// gate then re-caps it to 8.0, re-opening it for the orchestrator) and records the reviewer's note
// as a lesson. None of this blocks the loop — it just corrects course on the next cycle.

import path from 'node:path';
import { loadMatrix, saveMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import type { FrontierSpec } from '../../core/frontier-spec.js';
import { loadAuditQueue, resolveAudit, type AuditEscrowEntry } from '../../core/audit-escrow.js';

export interface FrontierAuditOptions {
  dimId?: string;
  confirm?: boolean;
  fail?: boolean;
  reviewer?: string;
  note?: string;
  json?: boolean;
  cwd?: string;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _saveMatrix?: (m: CompeteMatrix, cwd: string) => Promise<void>;
  _loadQueue?: (cwd: string) => Promise<AuditEscrowEntry[]>;
  _resolve?: typeof resolveAudit;
  _now?: string;
}

export interface FrontierAuditResult {
  mode: 'list' | 'resolved';
  pending?: AuditEscrowEntry[];
  resolved?: { dimId: string; outcome: 'confirmed' | 'failed'; downgraded: boolean };
}

export async function runFrontierAudit(options: FrontierAuditOptions): Promise<FrontierAuditResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loadQueue = options._loadQueue ?? loadAuditQueue;

  // ── List mode ─────────────────────────────────────────────────────────────────
  if (!options.dimId) {
    const queue = await loadQueue(cwd);
    const pending = queue.filter(e => e.status === 'pending');
    logger.info('');
    logger.success(`Frontier audit queue — ${pending.length} pending (of ${queue.length} total):`);
    for (const e of pending) {
      logger.info(`  • ${e.dimId.padEnd(28)} ${e.kind}  vote ${e.councilVote.pass}P/${e.councilVote.fail}F`);
      logger.info(`      replay: ${e.replayCommand}`);
    }
    if (pending.length > 0) {
      logger.info('');
      logger.info('  Spot-check any: danteforge frontier-audit <dim> --confirm|--fail --reviewer <you> [--note "..."]');
      logger.info('  (This never blocks the loop — a --fail just downgrades that dim on the next cycle.)');
    }
    if (options.json) process.stdout.write(JSON.stringify({ mode: 'list', pending }, null, 2) + '\n');
    return { mode: 'list', pending };
  }

  // ── Resolve mode ──────────────────────────────────────────────────────────────
  if (options.confirm === options.fail) throw new Error('Provide exactly one of --confirm or --fail.');
  if (!options.reviewer) throw new Error('--reviewer <name> is required to resolve an audit.');
  const outcome: 'confirmed' | 'failed' = options.confirm ? 'confirmed' : 'failed';
  const now = options._now ?? new Date().toISOString();

  const resolveFn = options._resolve ?? resolveAudit;
  const entry = await resolveFn(cwd, options.dimId, { outcome, reviewer: options.reviewer, note: options.note, nowIso: now });

  let downgraded = false;
  if (outcome === 'failed') {
    const loadFn = options._loadMatrix ?? loadMatrix;
    const saveFn = options._saveMatrix ?? saveMatrix;
    const matrix = await loadFn(cwd);
    const dim = matrix?.dimensions.find(d => d.id === options.dimId);
    const spec = dim ? (dim as unknown as { frontier_spec?: FrontierSpec }).frontier_spec : undefined;
    if (matrix && spec && spec.status === 'validated') {
      spec.status = 'frozen'; // re-caps to 8.0 via the frontier gate → re-opens for the orchestrator
      await saveFn(matrix, cwd);
      downgraded = true;
    }
    logger.warn(`[frontier-audit] ${options.dimId}: FAILED by ${options.reviewer}${downgraded ? ' — downgraded to 8.0 (frozen), re-opened' : ''}. ${options.note ?? ''}`);
  } else {
    logger.success(`[frontier-audit] ${options.dimId}: CONFIRMED by ${options.reviewer}.`);
  }

  const result: FrontierAuditResult = { mode: 'resolved', resolved: { dimId: options.dimId, outcome, downgraded } };
  if (options.json) process.stdout.write(JSON.stringify({ ...result, entry }, null, 2) + '\n');
  return result;
}
