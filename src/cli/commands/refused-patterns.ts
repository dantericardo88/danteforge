// refused-patterns — CLI surface for the refused-patterns blocklist.
// Lists, adds, removes, and clears patterns proven not to work,
// so they are never re-adopted by OSS-intel or harvest queues.

import { logger } from '../../core/logger.js';
import {
  loadRefusedPatterns,
  saveRefusedPatterns,
  type RefusedPatternsStore,
  type RefusedPattern,
} from '../../core/refused-patterns.js';

export interface RefusedPatternsOptions {
  add?: string;
  remove?: string;
  clear?: boolean;
  cwd?: string;
  _load?: () => Promise<RefusedPatternsStore>;
  _save?: (store: RefusedPatternsStore) => Promise<void>;
}

export interface RefusedPatternsResult {
  action: 'list' | 'add' | 'remove' | 'clear';
  patternCount: number;
  changed: boolean;
}

export async function runRefusedPatterns(options: RefusedPatternsOptions = {}): Promise<RefusedPatternsResult> {
  const cwd = options.cwd ?? process.cwd();
  const load = options._load ?? (() => loadRefusedPatterns(cwd));
  const save = options._save ?? ((store: RefusedPatternsStore) => saveRefusedPatterns(store, cwd));

  // ── Clear ──────────────────────────────────────────────────────────────────
  if (options.clear) {
    const store: RefusedPatternsStore = { version: '1.0.0', patterns: [], updatedAt: new Date().toISOString() };
    await save(store);
    logger.success('Refused-patterns blocklist cleared.');
    return { action: 'clear', patternCount: 0, changed: true };
  }

  // ── Add ────────────────────────────────────────────────────────────────────
  if (options.add) {
    const store = await load();
    const already = store.patterns.some(p => p.patternName === options.add);
    if (already) {
      logger.info(`Pattern "${options.add}" is already in the refused list.`);
      return { action: 'add', patternCount: store.patterns.length, changed: false };
    }
    const entry: RefusedPattern = {
      patternName: options.add,
      sourceRepo: 'manual',
      refusedAt: new Date().toISOString(),
      reason: 'manual',
    };
    store.patterns.push(entry);
    store.updatedAt = new Date().toISOString();
    await save(store);
    logger.success(`Added "${options.add}" to refused-patterns blocklist.`);
    return { action: 'add', patternCount: store.patterns.length, changed: true };
  }

  // ── Remove ─────────────────────────────────────────────────────────────────
  if (options.remove) {
    const store = await load();
    const before = store.patterns.length;
    store.patterns = store.patterns.filter(p => p.patternName !== options.remove);
    if (store.patterns.length === before) {
      logger.warn(`Pattern "${options.remove}" was not found in the refused list.`);
      return { action: 'remove', patternCount: before, changed: false };
    }
    store.updatedAt = new Date().toISOString();
    await save(store);
    logger.success(`Removed "${options.remove}" from refused-patterns blocklist.`);
    return { action: 'remove', patternCount: store.patterns.length, changed: true };
  }

  // ── List (default) ─────────────────────────────────────────────────────────
  const store = await load();
  if (store.patterns.length === 0) {
    logger.info('No refused patterns. The blocklist is empty.');
    return { action: 'list', patternCount: 0, changed: false };
  }

  logger.info(`Refused patterns (${store.patterns.length}):\n`);
  for (const p of store.patterns) {
    const date = new Date(p.refusedAt).toLocaleDateString();
    const delta = p.laggingDelta !== undefined ? ` | delta: ${p.laggingDelta.toFixed(2)}` : '';
    logger.info(`  • ${p.patternName} (${p.sourceRepo}) — ${p.reason}${delta} — ${date}`);
  }
  logger.info('');
  logger.info('Use --add <name> to manually block, --remove <name> to unblock, --clear to wipe.');

  return { action: 'list', patternCount: store.patterns.length, changed: false };
}
