// declarations.ts — `danteforge declarations <list|drop|prune>` — the operator surface for the
// gate-confirmed declarations ledger.
//
// The ledger is the durability layer git operations cannot touch; until this command existed the
// only removal path was hand-deleting files no doc named (adversarial finding 4a). `drop` is the
// SANCTIONED removal: it tombstones the outcome id so neither the loadMatrix overlay nor a later
// gate-confirmed re-record can resurrect it. `prune` deletes a dim's whole ledger file — losing
// both earn-durability AND removal-durability for that dim (loud warning). `list` shows what is
// durably held and what is tombstoned, per dim.

import { logger } from '../../core/logger.js';
import {
  loadAllLedgerEntries,
  tombstoneDeclaration,
  pruneDeclarations,
} from '../../core/declarations-ledger.js';

export interface DeclarationsCliOptions {
  action: 'list' | 'drop' | 'prune';
  dimId?: string;
  outcomeId?: string;
  reason?: string;
  cwd?: string;
  json?: boolean;
}

export interface DeclarationsCliResult {
  ok: boolean;
  action: DeclarationsCliOptions['action'];
  detail: string;
}

export async function runDeclarationsCli(options: DeclarationsCliOptions): Promise<DeclarationsCliResult> {
  const cwd = options.cwd ?? process.cwd();

  if (options.action === 'list') {
    const entries = await loadAllLedgerEntries(cwd);
    if (options.json) {
      process.stdout.write(JSON.stringify([...entries.values()], null, 2) + '\n');
      return { ok: true, action: 'list', detail: `${entries.size} dim(s)` };
    }
    if (entries.size === 0) {
      logger.info('[declarations] ledger is empty — no gate-confirmed snapshots recorded yet (run `danteforge validate <dim>` to a clean full pass).');
      return { ok: true, action: 'list', detail: 'empty' };
    }
    logger.info('');
    logger.success(`Declarations ledger — ${entries.size} dim(s) with durable gate-confirmed snapshots`);
    for (const [dimId, entry] of entries) {
      const dead = entry.tombstones ?? [];
      logger.info(`  ${dimId.padEnd(30)} ${entry.outcomes.length} outcome(s)  (updated ${entry.updatedAt.slice(0, 19)})`);
      for (const o of entry.outcomes) logger.info(`    ✓ ${o.id} [${o.tier}]`);
      for (const t of dead) logger.info(`    ✖ ${t.outcomeId} — tombstoned ${t.removedAt.slice(0, 10)}: ${t.reason}`);
    }
    return { ok: true, action: 'list', detail: `${entries.size} dim(s)` };
  }

  if (!options.dimId) {
    logger.error(`[declarations] ${options.action} requires a <dimId>.`);
    return { ok: false, action: options.action, detail: 'missing dimId' };
  }

  if (options.action === 'drop') {
    if (!options.outcomeId) {
      logger.error('[declarations] drop requires <dimId> <outcomeId>.');
      return { ok: false, action: 'drop', detail: 'missing outcomeId' };
    }
    const reason = options.reason ?? 'operator removal via danteforge declarations drop';
    const r = await tombstoneDeclaration(cwd, options.dimId, options.outcomeId, reason);
    if (!r.ok) return { ok: false, action: 'drop', detail: 'tombstone write failed (see warning above)' };
    if (r.alreadyTombstoned) {
      logger.info(`[declarations] ${options.dimId}/${options.outcomeId} was already tombstoned — nothing new written.`);
    } else {
      logger.success(`[declarations] tombstoned ${options.dimId}/${options.outcomeId}${r.removedFromOutcomes ? ' (removed from the durable snapshot)' : ' (id was not in the snapshot — the tombstone still blocks future restores/re-records)'}.`);
      logger.info('  The loadMatrix overlay will no longer restore it, and a future gate-confirmed validate cannot re-record it.');
      logger.info('  Remember to also remove the outcome from .danteforge/compete/matrix.json if it is still declared there.');
    }
    return { ok: true, action: 'drop', detail: `${options.dimId}/${options.outcomeId}` };
  }

  // prune
  const deleted = await pruneDeclarations(cwd, options.dimId);
  if (deleted) {
    logger.warn(`[declarations] PRUNED the whole ledger file for "${options.dimId}" — gate-confirmed durability AND removal-durability for this dim are gone. The next git reset can wipe its matrix.json declarations with no recovery, and prior tombstones no longer block re-records.`);
  } else {
    logger.info(`[declarations] no ledger file for "${options.dimId}" — nothing to prune.`);
  }
  return { ok: true, action: 'prune', detail: deleted ? 'deleted' : 'no file' };
}
