// dispensation.ts — Operator-facing CLI for score dispensations (Phase H Slice 6).
//
// A dispensation is an operator-approved exception that pauses autonomy for a
// specific dimension. When any dispensation is outstanding, the crusade refuses
// to run globally (autonomous rule R2). This prevents dispensations from
// becoming a parallel inflation channel — the operator must explicitly clear
// them before the substrate resumes autonomous work.
//
// Subcommands:
//   list                          show all (active + cleared) dispensations
//   create <dimId> <reason>       open a new dispensation against a dimension
//   clear <id>                    mark a dispensation cleared (autonomy can resume)
//
// File format: .danteforge/score-proposals/dispensations/<id>.json
//   { id, dimensionId, reason, createdAt, createdBy, cleared?: true, clearedAt?: string }

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
  json?: boolean;
  // Injection seams
  _readdir?: (p: string) => Promise<string[]>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, d: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _mkdir?: (p: string) => Promise<void>;
  _stdout?: (line: string) => void;
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
  const dispensations = await listDispensations(cwd, io);

  if (options.json) {
    process.stdout.write(JSON.stringify(dispensations, null, 2) + '\n');
    return dispensations;
  }

  logger.info('');
  logger.info(chalk.bold('Dispensations'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');

  const active = dispensations.filter(d => !d.cleared);
  const cleared = dispensations.filter(d => d.cleared);

  if (active.length === 0) {
    logger.info(chalk.green('  ✓ No active dispensations. Autonomy is unblocked.'));
  } else {
    logger.info(chalk.yellow(`  Active (${active.length}) — autonomy is paused globally:`));
    for (const d of active) {
      logger.info(`    ${chalk.yellow('●')} ${chalk.cyan(d.id)}  ${chalk.bold(d.dimensionId)}`);
      logger.info(`      ${chalk.dim(d.reason)}`);
      logger.info(`      ${chalk.dim(`created ${d.createdAt}${d.createdBy ? ' by ' + d.createdBy : ''}`)}`);
    }
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
  const disp: Dispensation = {
    id: genDispensationId(),
    dimensionId: options.dimensionId,
    reason: options.reason,
    createdAt: new Date().toISOString(),
    createdBy: options.user,
  };
  const filePath = path.join(cwd, DISPENSATION_DIR, `${disp.id}.json`);
  await io.writeFile(filePath, JSON.stringify(disp, null, 2));

  if (options.json) {
    process.stdout.write(JSON.stringify(disp, null, 2) + '\n');
  } else {
    logger.warn(`Created dispensation ${disp.id} for ${disp.dimensionId}.`);
    logger.warn(`Autonomy is now paused globally. Clear with: danteforge dispensation clear ${disp.id}`);
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

  if (options.json) {
    process.stdout.write(JSON.stringify(cleared, null, 2) + '\n');
  } else {
    logger.success(`Cleared dispensation ${cleared.id} for ${cleared.dimensionId}.`);
  }
  return cleared;
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runDispensationCommand(opts: DispensationCommandOptions = {}): Promise<void> {
  const sub = opts.subcommand ?? 'list';
  if (sub === 'list') await dispensationList(opts);
  else if (sub === 'create') await dispensationCreate(opts);
  else if (sub === 'clear') await dispensationClear(opts);
  else throw new Error(`unknown dispensation subcommand: ${sub}`);
}
