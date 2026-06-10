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
// WRITER: the validate gate (runValidateCli) — and ONLY on a full-pass / no-integrity-cap
// run, so a failing or capped run can never launder a bad declaration into durability.
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

/** On-disk shape of one per-dimension ledger file. */
export interface DeclarationsLedgerEntry {
  dimensionId: string;
  outcomes: Outcome[];
  updatedAt: string;
  recordedBy: 'validate-gate';
}

/** Injectable fs surface so tests never touch the real disk. */
export interface LedgerFs {
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  mkdir: (p: string) => Promise<void>;
  readdir: (p: string) => Promise<string[]>;
  exists: (p: string) => Promise<boolean>;
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
  return (e['outcomes'] as unknown[]).every(o =>
    typeof o === 'object' && o !== null && typeof (o as Record<string, unknown>)['id'] === 'string',
  );
}

/**
 * Overwrite the ledger snapshot for one dimension — last gate-confirmed snapshot wins.
 * Creates the self-ignoring `.gitignore` on first write. Returns true when the snapshot
 * was persisted; false (after a warn) on any failure — never throws.
 */
export async function recordDeclarations(
  cwd: string,
  dimId: string,
  outcomes: Outcome[],
  opts?: LedgerOptions,
): Promise<boolean> {
  const io = resolveFs(opts);
  try {
    const dir = getLedgerDir(cwd);
    await io.mkdir(dir);
    const gitignorePath = path.join(dir, '.gitignore');
    if (!(await io.exists(gitignorePath))) {
      await io.writeFile(gitignorePath, '*\n');
    }
    const entry: DeclarationsLedgerEntry = {
      dimensionId: dimId,
      outcomes,
      updatedAt: new Date().toISOString(),
      recordedBy: 'validate-gate',
    };
    await io.writeFile(path.join(dir, ledgerFileName(dimId)), JSON.stringify(entry, null, 2));
    return true;
  } catch (err) {
    logger.warn(`[declarations-ledger] could not record declarations for "${dimId}": ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

/**
 * Load the ledger snapshot for one dimension. Missing file → null (silent — the common
 * case). Corrupt or malformed file → warn + null. Never throws.
 */
export async function loadDeclarations(
  cwd: string,
  dimId: string,
  opts?: LedgerOptions,
): Promise<Outcome[] | null> {
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
    return parsed.outcomes;
  } catch (err) {
    logger.warn(`[declarations-ledger] corrupt ledger file for "${dimId}" — treating as absent: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Load every dimension's ledger snapshot as Map<dimensionId, outcomes[]>. The map is
 * keyed by the dimensionId INSIDE each file (the file content is authoritative, not the
 * filename). Unreadable directory → empty map; per-file corruption warns and skips that
 * file only. Never throws.
 */
export async function loadAllDeclarations(
  cwd: string,
  opts?: LedgerOptions,
): Promise<Map<string, Outcome[]>> {
  const io = resolveFs(opts);
  const out = new Map<string, Outcome[]>();
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
        out.set(parsed.dimensionId, parsed.outcomes);
      } else {
        logger.warn(`[declarations-ledger] malformed ledger file — skipping: ${name}`);
      }
    } catch {
      logger.warn(`[declarations-ledger] corrupt ledger file — skipping: ${name}`);
    }
  }
  return out;
}
