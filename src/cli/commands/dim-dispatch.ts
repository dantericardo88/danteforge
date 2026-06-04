// dim-dispatch — the router that EXECUTES dim-triage's routes, not just prints them.
//
// surgical            → run the autoresearch agent loop on the dim, run its outcomes, then PROMOTE the
//                       self-score up to the freshly-derived value through the gate (so the win is
//                       finally visible in overallSelfScore — the score-path gap).
// feature_construction → hand off: matrixdev/forge is an agent-driven slash-command loop, not a CLI we
//                       can spawn, so emit a concrete instruction for it instead of fabricating a run.
// yardstick_bug / ceilinged / unknown → report (fix the test / already capped / needs human judgment).

import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { loadMatrix, saveMatrix } from '../../core/compete-matrix.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { promoteVerifiedScore, type PromoteResult } from '../../core/promote-score.js';
import { NEEDS_SHELL, splitCommand } from '../../core/autoresearch-engine.js';
import { classifyMatrixDims, type LooseDim } from './dim-triage.js';
import type { DimClassification } from '../../core/dim-triage.js';

export interface DispatchRunners {
  /** Run the autoresearch agent loop against a dim's capability_test. */
  runAutoresearch: (dim: LooseDim, cwd: string, timeBudget: string) => Promise<void>;
  /** Re-execute the dim's declared outcomes so loadMatrix can derive a fresh score. */
  runOutcomes: (dimId: string, cwd: string) => Promise<void>;
  /** Run the capability_test; true iff it exits 0. */
  runCapabilityTest: (command: string, cwd: string) => Promise<boolean>;
}

interface DimDispatchOpts {
  target?: number;
  max?: number;
  time?: string;
  dryRun?: boolean;
  json?: boolean;
  _loadMatrix?: typeof loadMatrix;
  _saveMatrix?: typeof saveMatrix;
  _isLLMAvailable?: () => Promise<boolean>;
  _callLLM?: (prompt: string) => Promise<string>;
  _fileExists?: (p: string) => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
  _runners?: Partial<DispatchRunners>;
}

export interface DispatchAction {
  dimId: string;
  category: DimClassification['category'];
  action: 'executed' | 'handoff' | 'skipped';
  promote?: PromoteResult;
  note: string;
}

const CLI = (): string => process.argv[1] ?? 'dist/index.js';

function defaultRunners(): DispatchRunners {
  return {
    runAutoresearch: (dim, cwd, timeBudget) => {
      const cmd = dim.capability_test?.command;
      if (!cmd) return Promise.resolve();
      // --isolate: each experiment runs in a clean worktree, so dim-dispatch never mutates the user tree.
      return spawnCli([`autoresearch`, `improve ${dim.label || dim.id}`, '--measurement-command', cmd, '--time', timeBudget, '--isolate'], cwd);
    },
    runOutcomes: (dimId, cwd) => spawnCli(['outcomes', '--dim', dimId, '--force-cold'], cwd),
    runCapabilityTest: (command, cwd) => runCapabilityTest(command, cwd),
  };
}

export async function dimDispatch(opts: DimDispatchOpts = {}): Promise<void> {
  return withErrorBoundary('dim-dispatch', async () => {
    const cwd = process.cwd();
    const target = opts.target ?? 7.0;
    const max = opts.max ?? 3;
    const time = opts.time ?? '10m';
    const loadMatrixFn = opts._loadMatrix ?? ((c?: string) => loadMatrix(c, (p) => fs.readFile(p, 'utf8'))); // bypass cache → fresh derived
    const saveMatrixFn = opts._saveMatrix ?? saveMatrix;
    const callLLMFn = opts._callLLM ?? ((p: string) => callLLM(p, undefined, { enrichContext: false, cwd }));
    const fileExists = opts._fileExists ?? (async (p: string) => { try { await fs.access(p); return true; } catch { return false; } });
    const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const runners = { ...defaultRunners(), ...opts._runners };

    const matrix = await loadMatrixFn(cwd);
    if (!matrix) { logger.error('No competitive matrix found. Run `danteforge compete` first.'); process.exitCode = 1; return; }

    const llmOk = await (opts._isLLMAvailable ?? isLLMAvailable)();
    const classes = await classifyMatrixDims(matrix.dimensions as LooseDim[], {
      cwd, target, fileExists, readFile, llmOk, callLLM: callLLMFn, excluded: new Set(matrix.excludedDimensions ?? []),
    });

    const surgical = classes.filter(c => c.category === 'surgical').slice(0, max);
    const feature = classes.filter(c => c.category === 'feature_construction');
    logger.info(`Dispatch plan: ${surgical.length} surgical → autoresearch+promote, ${feature.length} feature → matrixdev handoff (target ${target}).`);

    if (opts.dryRun) {
      for (const c of [...surgical, ...feature]) logger.info(`  ${c.category === 'surgical' ? 'EXEC ' : 'HANDOFF'} ${c.id} — ${c.reason}`);
      logger.info('--dry-run: no execution.');
      if (opts.json) process.stdout.write(JSON.stringify({ planned: { surgical: surgical.map(c => c.id), feature: feature.map(c => c.id) } }, null, 2) + '\n');
      return;
    }

    const actions: DispatchAction[] = [];
    const byId = new Map((matrix.dimensions as LooseDim[]).map(d => [d.id, d]));

    for (const c of surgical) {
      const dim = byId.get(c.id);
      const cmd = dim?.capability_test?.command;
      if (!dim || !cmd) { actions.push({ dimId: c.id, category: c.category, action: 'skipped', note: 'no capability_test command' }); continue; }
      logger.info(`[dispatch] ${c.id}: autoresearch (budget ${time})...`);
      await runners.runAutoresearch(dim, cwd, time);
      await runners.runOutcomes(c.id, cwd);
      const passed = await runners.runCapabilityTest(cmd, cwd);
      // Reload so derived reflects the fresh outcome evidence, then promote self through the gate.
      const fresh = await loadMatrixFn(cwd);
      const promote = fresh ? promoteVerifiedScore(fresh, c.id, { capabilityTestPassed: passed, agent: 'dim-dispatch' }) : undefined;
      if (fresh && promote?.promoted) await saveMatrixFn(fresh, cwd);
      actions.push({ dimId: c.id, category: c.category, action: 'executed', promote, note: promote?.reason ?? 'no score change' });
      logger.info(`[dispatch] ${c.id}: capability_test ${passed ? 'PASS' : 'fail'}; ${promote?.reason ?? 'no promote'}`);
    }

    for (const c of feature) {
      actions.push({ dimId: c.id, category: c.category, action: 'handoff', note: `run /matrixdev or /forge on ${c.id} — feature-scale work, not a surgical edit` });
    }

    const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
    const mkdir = opts._mkdir ?? (async (p: string) => { await fs.mkdir(p, { recursive: true }); });
    await writeDispatchReport(cwd, matrix.project, actions, mkdir, writeFile);
    if (opts.json) { process.stdout.write(JSON.stringify({ actions }, null, 2) + '\n'); return; }
    printSummary(actions);
  });
}

// ── default real execution helpers ──────────────────────────────────────────────

function spawnCli(args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [CLI(), ...args], { cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
}

function runCapabilityTest(command: string, cwd: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let file: string; let args: string[];
    if (NEEDS_SHELL.test(command)) {
      if (process.platform === 'win32') { file = process.env.ComSpec || 'cmd.exe'; args = ['/d', '/s', '/c', command]; }
      else { file = '/bin/sh'; args = ['-c', command]; }
    } else { const parts = splitCommand(command); file = parts[0] ?? ''; args = parts.slice(1); }
    if (!file) { resolve(false); return; }
    const child = spawn(file, args, { cwd, stdio: 'ignore', windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function writeDispatchReport(cwd: string, project: string, actions: DispatchAction[], mkdir: (p: string) => Promise<void>, writeFile: (p: string, c: string) => Promise<void>): Promise<void> {
  const dir = path.join(cwd, '.danteforge', 'triage');
  await mkdir(dir).catch(() => { /* best-effort */ });
  const lines = [`# Dimension Dispatch — ${project}`, '', '| dim | category | action | result |', '|-----|----------|--------|--------|'];
  for (const a of actions) lines.push(`| ${a.dimId} | ${a.category} | ${a.action} | ${a.note.replace(/\|/g, '\\|')} |`);
  await writeFile(path.join(dir, 'DIM_DISPATCH.md'), lines.join('\n') + '\n').catch(() => { /* best-effort */ });
}

function printSummary(actions: DispatchAction[]): void {
  const promoted = actions.filter(a => a.promote?.promoted);
  logger.info('');
  logger.success('=== Dimension Dispatch ===');
  logger.info(`  executed (surgical):  ${actions.filter(a => a.action === 'executed').length}`);
  logger.info(`  promoted (score ↑):   ${promoted.length}`);
  logger.info(`  handoff (feature):    ${actions.filter(a => a.action === 'handoff').length}`);
  for (const a of promoted) logger.success(`  ${a.dimId}: ${a.promote!.before} → ${a.promote!.after}`);
}
