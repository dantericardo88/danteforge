// declarations-ledger.ts — durable persistence for gate-confirmed outcome DECLARATIONS.
//
// WHY THIS EXISTS (fleet run 1, 2026-06-10): gate-confirmed outcomes[] entries lived ONLY
// as uncommitted local state in .danteforge/compete/matrix.json, because the protocol
// forbids staging matrix.json (kernel-owned; the pre-commit hook blocks it). The
// autopilot's git operations (reset --hard, branch switches) and matrix rewrites then
// wiped them — earns evaporated on 3/3 repos. The ledger snapshots each dim's declared
// outcomes OUTSIDE git's blast radius, one JSON file per dimension under
// `.danteforge/compete/declarations/`.
//
// THE SELF-IGNORING-DIRECTORY TRICK: on first write the ledger also creates
// `declarations/.gitignore` containing `*` — git ignores everything in the directory
// INCLUDING the .gitignore itself, in every repo regardless of the repo's own .gitignore.
// Untracked-and-ignored files are exactly the class of files `git reset --hard` and
// branch switches can never touch, so the ledger survives the operations that wiped the
// fleet's earns. (An explicit `git clean -fdx` still removes it — that is a deliberate
// operator action, not autopilot churn.)
//
// WRITERS:
//   - recordDeclarations — the validate gate (runValidateCli), and ONLY on a full-pass /
//     integrity-clean run, so a failing or capped run can never launder a bad
//     declaration into durability.
//   - updateLedgeredOutcomes — the grounding engine's write-through for SANCTIONED
//     downgrades/repairs. It can only REPLACE ids the ledger already holds (never add),
//     so a downgraded entry becomes the durable truth without opening a laundering path.
//   - tombstoneDeclaration — the sanctioned REMOVAL path (adversarial finding 4a): an
//     outcome legitimately deleted from matrix.json must stay deleted. A tombstone both
//     removes the outcome from the dim's ledgered set and blocks every future restore
//     (overlay) and re-record (recordDeclarations) of that id.
// READER: loadMatrix overlays missing declarations back into the in-memory matrix; the
// matrix entry always wins on id collision, so a ground-outcomes downgrade (written back
// into matrix.json) is never resurrected from an older ledger snapshot.
//
// Every entry point is best-effort and NEVER throws: a corrupt or unreadable ledger file
// warns and is treated as absent — the ledger is a recovery net, not a load-bearing gate.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import type { Outcome } from '../matrix/types/outcome.js';

const LEDGER_DIR_SEGMENTS = ['.danteforge', 'compete', 'declarations'] as const;

/**
 * Sanctioned-removal record. While a tombstone for an outcome id exists, the overlay
 * never restores that id and recordDeclarations never re-records it — removal is
 * durable, exactly like the declarations themselves.
 */
export interface DeclarationTombstone {
  outcomeId: string;
  removedAt: string;
  reason: string;
}

/** On-disk shape of one per-dimension ledger file. */
export interface DeclarationsLedgerEntry {
  dimensionId: string;
  outcomes: Outcome[];
  updatedAt: string;
  /** Provenance of the OUTCOMES array. Tombstones carry their own (removedAt/reason). */
  recordedBy: 'validate-gate' | 'operator-tombstone';
  /**
   * Optional for backwards compatibility: ledger files written before tombstones
   * existed parse unchanged (absent field = no removals).
   */
  tombstones?: DeclarationTombstone[];
}

/** Injectable fs surface so tests never touch the real disk. */
export interface LedgerFs {
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  mkdir: (p: string) => Promise<void>;
  readdir: (p: string) => Promise<string[]>;
  exists: (p: string) => Promise<boolean>;
  unlink: (p: string) => Promise<void>;
}

export interface LedgerOptions {
  /** Seam: override any subset of fs operations (tests). Unset members use the real fs. */
  _fs?: Partial<LedgerFs>;
}

function realLedgerFs(): LedgerFs {
  return {
    readFile: (p) => fs.readFile(p, 'utf8'),
    writeFile: (p, c) => fs.writeFile(p, c, 'utf8'),
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    readdir: (p) => fs.readdir(p),
    exists: async (p) => { try { await fs.access(p); return true; } catch { return false; } },
    unlink: (p) => fs.unlink(p),
  };
}

function resolveFs(opts?: LedgerOptions): LedgerFs {
  return { ...realLedgerFs(), ...(opts?._fs ?? {}) };
}

export function getLedgerDir(cwd: string): string {
  return path.join(cwd, ...LEDGER_DIR_SEGMENTS);
}

// Dim ids are snake_case by convention; sanitize defensively so an adversarial id can
// never escape the ledger directory (path traversal) or yield an invalid filename.
function ledgerFileName(dimId: string): string {
  return dimId.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_') + '.json';
}

function isLedgerEntry(v: unknown): v is DeclarationsLedgerEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e['dimensionId'] !== 'string' || e['dimensionId'].length === 0) return false;
  if (!Array.isArray(e['outcomes'])) return false;
  // Light structural check on each outcome: a string id is the overlay's collision key,
  // so it is the one field the ledger cannot function without. Deeper shape validation
  // stays with isValidOutcome at declaration time — the ledger only stores what the
  // validate gate already accepted, and must not silently drop entries when the Outcome
  // type grows a field.
  if (!(e['outcomes'] as unknown[]).every(o =>
    typeof o === 'object' && o !== null && typeof (o as Record<string, unknown>)['id'] === 'string',
  )) return false;
  // Tombstones are optional (pre-tombstone files have no field); when present each one
  // needs a string outcomeId — the exclusion key removal durability hangs on.
  const t = e['tombstones'];
  if (t === undefined) return true;
  if (!Array.isArray(t)) return false;
  return t.every(x =>
    typeof x === 'object' && x !== null && typeof (x as Record<string, unknown>)['outcomeId'] === 'string',
  );
}

function tombstonedIds(entry: DeclarationsLedgerEntry): Set<string> {
  return new Set((entry.tombstones ?? []).map(t => t.outcomeId));
}

/** The dim's restorable outcomes: ledgered minus tombstoned (defense in depth — a
 *  hand-edited file holding both never resurrects the removed id). */
function liveOutcomes(entry: DeclarationsLedgerEntry): Outcome[] {
  const dead = tombstonedIds(entry);
  if (dead.size === 0) return entry.outcomes;
  return entry.outcomes.filter(o => !dead.has(o.id));
}

async function ensureLedgerDir(io: LedgerFs, cwd: string): Promise<string> {
  const dir = getLedgerDir(cwd);
  await io.mkdir(dir);
  const gitignorePath = path.join(dir, '.gitignore');
  if (!(await io.exists(gitignorePath))) {
    await io.writeFile(gitignorePath, '*\n');
  }
  return dir;
}

async function writeEntry(io: LedgerFs, cwd: string, entry: DeclarationsLedgerEntry): Promise<void> {
  const dir = await ensureLedgerDir(io, cwd);
  await io.writeFile(path.join(dir, ledgerFileName(entry.dimensionId)), JSON.stringify(entry, null, 2));
}

/**
 * Load the FULL ledger entry (outcomes + tombstones) for one dimension. Missing file →
 * null (silent — the common case). Corrupt or malformed file → warn + null. Never throws.
 */
export async function loadLedgerEntry(
  cwd: string,
  dimId: string,
  opts?: LedgerOptions,
): Promise<DeclarationsLedgerEntry | null> {
  const io = resolveFs(opts);
  const filePath = path.join(getLedgerDir(cwd), ledgerFileName(dimId));
  let raw: string;
  try {
    raw = await io.readFile(filePath);
  } catch (err) {
    // ENOENT (file simply not recorded yet) is the common case — stay silent. Anything
    // else (permissions, seam failure) is surprising enough to warn about.
    if ((err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
      logger.warn(`[declarations-ledger] could not read ledger file for "${dimId}" — treating as absent: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isLedgerEntry(parsed)) {
      logger.warn(`[declarations-ledger] malformed ledger file for "${dimId}" — treating as absent: ${filePath}`);
      return null;
    }
    return parsed;
  } catch (err) {
    logger.warn(`[declarations-ledger] corrupt ledger file for "${dimId}" — treating as absent: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Overwrite the ledger snapshot for one dimension — last gate-confirmed snapshot wins.
 * Existing tombstones are PRESERVED and tombstoned ids are EXCLUDED from the recorded
 * set: a sanctioned removal survives every later full-pass re-record. Creates the
 * self-ignoring `.gitignore` on first write. Returns true when the snapshot was
 * persisted; false (after a warn) on any failure — never throws.
 */
export async function recordDeclarations(
  cwd: string,
  dimId: string,
  outcomes: Outcome[],
  opts?: LedgerOptions,
): Promise<boolean> {
  const io = resolveFs(opts);
  try {
    const existing = await loadLedgerEntry(cwd, dimId, opts);
    const tombstones = existing?.tombstones ?? [];
    const dead = new Set(tombstones.map(t => t.outcomeId));
    const entry: DeclarationsLedgerEntry = {
      dimensionId: dimId,
      outcomes: dead.size === 0 ? outcomes : outcomes.filter(o => !dead.has(o.id)),
      updatedAt: new Date().toISOString(),
      recordedBy: 'validate-gate',
      ...(tombstones.length > 0 ? { tombstones } : {}),
    };
    await writeEntry(io, cwd, entry);
    return true;
  } catch (err) {
    logger.warn(`[declarations-ledger] could not record declarations for "${dimId}": ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Sanctioned removal (adversarial finding 4a): tombstone one outcome id. Removes the
 * outcome from the dim's ledgered set AND records a tombstone so neither the loadMatrix
 * overlay nor a later gate-confirmed re-record can ever bring the id back. Works on a
 * dim with no ledger file yet (writes a tombstone-only entry — the block is still
 * binding for any future record). Never throws; ok=false (after a warn) on failure.
 */
export async function tombstoneDeclaration(
  cwd: string,
  dimId: string,
  outcomeId: string,
  reason: string,
  opts?: LedgerOptions,
): Promise<{ ok: boolean; removedFromOutcomes: boolean; alreadyTombstoned: boolean }> {
  const io = resolveFs(opts);
  try {
    const existing = await loadLedgerEntry(cwd, dimId, opts);
    const tombstones = [...(existing?.tombstones ?? [])];
    const alreadyTombstoned = tombstones.some(t => t.outcomeId === outcomeId);
    if (!alreadyTombstoned) {
      tombstones.push({ outcomeId, removedAt: new Date().toISOString(), reason });
    }
    const priorOutcomes = existing?.outcomes ?? [];
    const kept = priorOutcomes.filter(o => o.id !== outcomeId);
    const removedFromOutcomes = kept.length !== priorOutcomes.length;
    const entry: DeclarationsLedgerEntry = {
      dimensionId: dimId,
      outcomes: kept,
      updatedAt: new Date().toISOString(),
      recordedBy: existing?.recordedBy ?? 'operator-tombstone',
      tombstones,
    };
    await writeEntry(io, cwd, entry);
    return { ok: true, removedFromOutcomes, alreadyTombstoned };
  } catch (err) {
    logger.warn(`[declarations-ledger] could not tombstone "${dimId}/${outcomeId}": ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, removedFromOutcomes: false, alreadyTombstoned: false };
  }
}

/**
 * Write-through for SANCTIONED downgrades/repairs (adversarial finding 4b): replace the
 * ledger's copy of any updated outcome whose id the ledger ALREADY holds (and that is
 * not tombstoned). It can never ADD an id, so it cannot launder an unconfirmed
 * declaration into durability — a gate-derived LOWER snapshot is still the truthful
 * durable state. Returns true when a write happened. Never throws.
 */
export async function updateLedgeredOutcomes(
  cwd: string,
  dimId: string,
  updated: Outcome[],
  opts?: LedgerOptions,
): Promise<boolean> {
  const io = resolveFs(opts);
  try {
    const existing = await loadLedgerEntry(cwd, dimId, opts);
    if (!existing || existing.outcomes.length === 0) return false;
    const dead = tombstonedIds(existing);
    const replacements = new Map(updated.filter(o => !dead.has(o.id)).map(o => [o.id, o]));
    let changed = false;
    const next = existing.outcomes.map(o => {
      const repl = replacements.get(o.id);
      if (repl === undefined || JSON.stringify(repl) === JSON.stringify(o)) return o;
      changed = true;
      return repl;
    });
    if (!changed) return false;
    await writeEntry(io, cwd, { ...existing, outcomes: next, updatedAt: new Date().toISOString() });
    return true;
  } catch (err) {
    logger.warn(`[declarations-ledger] could not write through updates for "${dimId}": ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Delete a dim's ledger file entirely — outcomes AND tombstones. The nuclear option:
 * gate-confirmed durability for the dim is lost (the next git reset can wipe its
 * matrix.json declarations with no recovery), and so is removal durability. Returns
 * true when a file was deleted; false when none existed or on failure. Never throws.
 */
export async function pruneDeclarations(
  cwd: string,
  dimId: string,
  opts?: LedgerOptions,
): Promise<boolean> {
  const io = resolveFs(opts);
  const filePath = path.join(getLedgerDir(cwd), ledgerFileName(dimId));
  try {
    if (!(await io.exists(filePath))) return false;
    await io.unlink(filePath);
    return true;
  } catch (err) {
    logger.warn(`[declarations-ledger] could not prune ledger file for "${dimId}": ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Load the restorable (non-tombstoned) declarations for one dimension. Missing file →
 * null (silent). Corrupt or malformed file → warn + null. Never throws.
 */
export async function loadDeclarations(
  cwd: string,
  dimId: string,
  opts?: LedgerOptions,
): Promise<Outcome[] | null> {
  const entry = await loadLedgerEntry(cwd, dimId, opts);
  return entry === null ? null : liveOutcomes(entry);
}

/**
 * Load every dimension's FULL ledger entry as Map<dimensionId, entry>. The map is keyed
 * by the dimensionId INSIDE each file (the file content is authoritative, not the
 * filename). Unreadable directory → empty map; per-file corruption warns and skips that
 * file only. Never throws.
 */
export async function loadAllLedgerEntries(
  cwd: string,
  opts?: LedgerOptions,
): Promise<Map<string, DeclarationsLedgerEntry>> {
  const io = resolveFs(opts);
  const out = new Map<string, DeclarationsLedgerEntry>();
  const dir = getLedgerDir(cwd);
  let names: string[];
  try {
    if (!(await io.exists(dir))) return out;
    names = (await io.readdir(dir)).filter(n => n.endsWith('.json'));
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const parsed: unknown = JSON.parse(await io.readFile(path.join(dir, name)));
      if (isLedgerEntry(parsed)) {
        out.set(parsed.dimensionId, parsed);
      } else {
        logger.warn(`[declarations-ledger] malformed ledger file — skipping: ${name}`);
      }
    } catch {
      logger.warn(`[declarations-ledger] corrupt ledger file — skipping: ${name}`);
    }
  }
  return out;
}

/**
 * Load every dimension's restorable (non-tombstoned) declarations as
 * Map<dimensionId, outcomes[]>. This is the loadMatrix overlay's read surface — a
 * tombstoned id is structurally invisible here, so the overlay can never restore it.
 */
export async function loadAllDeclarations(
  cwd: string,
  opts?: LedgerOptions,
): Promise<Map<string, Outcome[]>> {
  const entries = await loadAllLedgerEntries(cwd, opts);
  const out = new Map<string, Outcome[]>();
  for (const [dimId, entry] of entries) out.set(dimId, liveOutcomes(entry));
  return out;
}
