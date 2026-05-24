// dispensation.ts — Operator-facing CLI for score dispensations (Phase H Slice 6).
//
// A dispensation is an operator-approved exception that pauses autonomy for a
// specific dimension. When any dispensation is outstanding, the crusade refuses
// to run globally (autonomous rule R2). This prevents dispensations from
// becoming a parallel inflation channel — the operator must explicitly clear
// them before the substrate resumes autonomous work.
//
// Subcommands:
//   list                          show all (active + cleared + expired) dispensations
//   create <dimId> <reason>       open a new dispensation against a dimension
//                                 --ttl <duration> sets an expiration (e.g. "7d", "24h", "30m")
//   clear <id>                    mark a dispensation cleared (autonomy can resume)
//
// File format: .danteforge/score-proposals/dispensations/<id>.json
//   { id, dimensionId, reason, createdAt, createdBy, expiresAt?, cleared?: true, clearedAt?: string }
//
// Status is COMPUTED at read time:
//   - cleared: true                    → inactive (explicitly cleared by operator)
//   - expiresAt && now > expiresAt    → inactive (TTL elapsed; equivalent to cleared)
//   - otherwise                       → active (pauses autonomy)
//
// TTL is a defense against the "dispensation graveyard" anti-pattern: forgotten
// open dispensations that silently pause autonomy forever. The operator must
// either clear them OR set a TTL up front.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

const DISPENSATION_DIR = path.join('.danteforge', 'score-proposals', 'dispensations');

// ── Schema ────────────────────────────────────────────────────────────────────

export interface Dispensation {
  id: string;
  dimensionId: string;
  reason: string;
  createdAt: string;
  createdBy?: string;
  /** ISO date — when set, dispensation is treated as cleared once now > expiresAt. */
  expiresAt?: string;
  cleared?: boolean;
  clearedAt?: string;
  clearedBy?: string;
}

export interface DispensationCommandOptions {
  cwd?: string;
  subcommand?: 'list' | 'create' | 'clear';
  dimensionId?: string;
  reason?: string;
  dispensationId?: string;
  user?: string;
  /** TTL string (e.g. "7d", "24h", "30m"). Sets expiresAt on create. */
  ttl?: string;
  json?: boolean;
  // Injection seams
  _readdir?: (p: string) => Promise<string[]>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, d: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _mkdir?: (p: string) => Promise<void>;
  _stdout?: (line: string) => void;
  /** Injection seam for tests — overrides `Date.now()` everywhere. */
  _now?: () => Date;
  /**
   * Time Machine integration seam. Tri-state:
   *   undefined → lazy-import the real createTimeMachineCommit (production)
   *   null      → disable (test paths)
   *   function  → injected mock
   * Best-effort: TM failures never block the dispensation write.
   */
  _createTimeMachineCommit?: ((opts: import('../../core/time-machine.js').CreateTimeMachineCommitOptions) => Promise<unknown>) | null;
}

/**
 * Parse a TTL duration string like "7d", "24h", "30m", "120s".
 * Returns the duration in milliseconds, or throws if the string is malformed.
 * Supported units: s (seconds), m (minutes), h (hours), d (days).
 */
export function parseTtl(ttl: string): number {
  const match = ttl.trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!match) throw new Error(`Invalid TTL "${ttl}". Use a number + unit (s, m, h, d), e.g. "7d", "24h", "30m".`);
  const n = parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return n * multipliers[unit]!;
}

/** Returns true when the dispensation is no longer active (cleared OR expired). */
export function isDispensationInactive(disp: Dispensation, now: Date = new Date()): boolean {
  if (disp.cleared) return true;
  if (disp.expiresAt) {
    const expiry = new Date(disp.expiresAt).getTime();
    if (Number.isFinite(expiry) && now.getTime() > expiry) return true;
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function defaultIO() {
  return {
    readdir: (p: string) => fs.readdir(p),
    readFile: (p: string) => fs.readFile(p, 'utf8'),
    writeFile: async (p: string, d: string) => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, d, 'utf8');
    },
    exists: async (p: string) => {
      try { await fs.access(p); return true; } catch { return false; }
    },
    mkdir: async (p: string) => { await fs.mkdir(p, { recursive: true }); },
  };
}

function genDispensationId(): string {
  return `disp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function listDispensations(
  cwd: string,
  io: ReturnType<typeof defaultIO>,
): Promise<Dispensation[]> {
  const dir = path.join(cwd, DISPENSATION_DIR);
  if (!(await io.exists(dir))) return [];
  let files: string[];
  try { files = await io.readdir(dir); } catch { return []; }
  const out: Dispensation[] = [];
  for (const f of files.filter(n => n.endsWith('.json'))) {
    try {
      const raw = await io.readFile(path.join(dir, f));
      const parsed = JSON.parse(raw) as Dispensation;
      if (parsed && parsed.id && parsed.dimensionId) out.push(parsed);
    } catch { /* skip */ }
  }
  return out;
}

async function findDispensation(
  cwd: string,
  id: string,
  io: ReturnType<typeof defaultIO>,
): Promise<{ disp: Dispensation; path: string } | null> {
  const dir = path.join(cwd, DISPENSATION_DIR);
  const p = path.join(dir, `${id}.json`);
  if (!(await io.exists(p))) return null;
  try {
    const raw = await io.readFile(p);
    return { disp: JSON.parse(raw) as Dispensation, path: p };
  } catch {
    return null;
  }
}

// ── Subcommand: list ──────────────────────────────────────────────────────────

export async function dispensationList(options: DispensationCommandOptions = {}): Promise<Dispensation[]> {
  const cwd = options.cwd ?? process.cwd();
  const io = {
    readdir: options._readdir ?? defaultIO().readdir,
    readFile: options._readFile ?? defaultIO().readFile,
    writeFile: options._writeFile ?? defaultIO().writeFile,
    exists: options._exists ?? defaultIO().exists,
    mkdir: options._mkdir ?? defaultIO().mkdir,
  };
  const now = (options._now ?? (() => new Date()))();
  const dispensations = await listDispensations(cwd, io);

  if (options.json) {
    process.stdout.write(JSON.stringify(dispensations, null, 2) + '\n');
    return dispensations;
  }

  logger.info('');
  logger.info(chalk.bold('Dispensations'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');

  const expired = dispensations.filter(d => !d.cleared && d.expiresAt && now.getTime() > new Date(d.expiresAt).getTime());
  const active = dispensations.filter(d => !isDispensationInactive(d, now));
  const cleared = dispensations.filter(d => d.cleared);

  if (active.length === 0) {
    logger.info(chalk.green('  ✓ No active dispensations. Autonomy is unblocked.'));
  } else {
    logger.info(chalk.yellow(`  Active (${active.length}) — autonomy is paused globally:`));
    for (const d of active) {
      logger.info(`    ${chalk.yellow('●')} ${chalk.cyan(d.id)}  ${chalk.bold(d.dimensionId)}`);
      logger.info(`      ${chalk.dim(d.reason)}`);
      const ttlLine = d.expiresAt
        ? ` (expires ${d.expiresAt})`
        : '';
      logger.info(`      ${chalk.dim(`created ${d.createdAt}${d.createdBy ? ' by ' + d.createdBy : ''}${ttlLine}`)}`);
    }
  }
  if (expired.length > 0) {
    logger.info('');
    logger.info(chalk.dim(`  Expired (${expired.length}) — TTL elapsed, treated as cleared:`));
    for (const d of expired.slice(0, 10)) {
      logger.info(`    ${chalk.dim('◌')} ${chalk.dim(d.id)}  ${chalk.dim(d.dimensionId)}  ${chalk.dim('expired ' + (d.expiresAt ?? '?'))}`);
    }
    if (expired.length > 10) logger.info(chalk.dim(`    … and ${expired.length - 10} more`));
  }
  if (cleared.length > 0) {
    logger.info('');
    logger.info(chalk.dim(`  Cleared (${cleared.length}):`));
    for (const d of cleared.slice(0, 10)) {
      logger.info(`    ${chalk.dim('○')} ${chalk.dim(d.id)}  ${chalk.dim(d.dimensionId)}  ${chalk.dim('cleared ' + (d.clearedAt ?? '?'))}`);
    }
    if (cleared.length > 10) logger.info(chalk.dim(`    … and ${cleared.length - 10} more`));
  }
  logger.info('');
  return dispensations;
}

// ── Subcommand: create ────────────────────────────────────────────────────────

export async function dispensationCreate(options: DispensationCommandOptions = {}): Promise<Dispensation> {
  if (!options.dimensionId) throw new Error('dispensation create: dimensionId required');
  if (!options.reason || options.reason.length < 10) {
    throw new Error('dispensation create: reason required (min 10 chars) — explain why this exception is needed');
  }
  const cwd = options.cwd ?? process.cwd();
  const io = {
    readdir: options._readdir ?? defaultIO().readdir,
    readFile: options._readFile ?? defaultIO().readFile,
    writeFile: options._writeFile ?? defaultIO().writeFile,
    exists: options._exists ?? defaultIO().exists,
    mkdir: options._mkdir ?? defaultIO().mkdir,
  };
  const now = (options._now ?? (() => new Date()))();
  const disp: Dispensation = {
    id: genDispensationId(),
    dimensionId: options.dimensionId,
    reason: options.reason,
    createdAt: now.toISOString(),
    createdBy: options.user,
  };
  if (options.ttl) {
    const ms = parseTtl(options.ttl);
    disp.expiresAt = new Date(now.getTime() + ms).toISOString();
  }
  const filePath = path.join(cwd, DISPENSATION_DIR, `${disp.id}.json`);
  await io.writeFile(filePath, JSON.stringify(disp, null, 2));
  await recordDispensationCommit(disp, filePath, cwd, 'created', options._createTimeMachineCommit);

  if (options.json) {
    process.stdout.write(JSON.stringify(disp, null, 2) + '\n');
  } else {
    logger.warn(`Created dispensation ${disp.id} for ${disp.dimensionId}.`);
    if (disp.expiresAt) {
      logger.warn(`TTL: expires ${disp.expiresAt}. After that, the dispensation auto-clears and autonomy resumes.`);
    } else {
      logger.warn(`No TTL set. Operator must clear it: danteforge dispensation clear ${disp.id}`);
    }
    logger.warn(`Autonomy is now paused globally.`);
  }
  return disp;
}

// ── Subcommand: clear ─────────────────────────────────────────────────────────

export async function dispensationClear(options: DispensationCommandOptions = {}): Promise<Dispensation> {
  if (!options.dispensationId) throw new Error('dispensation clear: id required');
  const cwd = options.cwd ?? process.cwd();
  const io = {
    readdir: options._readdir ?? defaultIO().readdir,
    readFile: options._readFile ?? defaultIO().readFile,
    writeFile: options._writeFile ?? defaultIO().writeFile,
    exists: options._exists ?? defaultIO().exists,
    mkdir: options._mkdir ?? defaultIO().mkdir,
  };
  const found = await findDispensation(cwd, options.dispensationId, io);
  if (!found) throw new Error(`dispensation clear: no dispensation found with id "${options.dispensationId}"`);
  const cleared: Dispensation = {
    ...found.disp,
    cleared: true,
    clearedAt: new Date().toISOString(),
    clearedBy: options.user,
  };
  await io.writeFile(found.path, JSON.stringify(cleared, null, 2));
  await recordDispensationCommit(cleared, found.path, cwd, 'cleared', options._createTimeMachineCommit);

  if (options.json) {
    process.stdout.write(JSON.stringify(cleared, null, 2) + '\n');
  } else {
    logger.success(`Cleared dispensation ${cleared.id} for ${cleared.dimensionId}.`);
  }
  return cleared;
}

/**
 * Phase H Time Machine integration: record dispensation state changes
 * (create / clear) as causal commits. Each event matters for autonomy audit
 * because a dispensation pauses the substrate globally. Mirrors the
 * outcome-runner.ts:recordOutcomeEvidenceCommit pattern.
 * Best-effort — TM failures never block the dispensation write.
 */
async function recordDispensationCommit(
  disp: Dispensation,
  filePath: string,
  cwd: string,
  kind: 'created' | 'cleared',
  override?: DispensationCommandOptions['_createTimeMachineCommit'],
): Promise<void> {
  if (override === null) return;
  try {
    const createFn = override
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    await createFn({
      cwd,
      paths: [filePath],
      label: `dispensation-${kind}/${disp.dimensionId}/${disp.id}`,
      causalLinks: {
        materials: [filePath],
        inputDependencies: [],
      },
    });
  } catch {
    // best-effort
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runDispensationCommand(opts: DispensationCommandOptions = {}): Promise<void> {
  const sub = opts.subcommand ?? 'list';
  if (sub === 'list') await dispensationList(opts);
  else if (sub === 'create') await dispensationCreate(opts);
  else if (sub === 'clear') await dispensationClear(opts);
  else throw new Error(`unknown dispensation subcommand: ${sub}`);
}
