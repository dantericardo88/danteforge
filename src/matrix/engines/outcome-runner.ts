// Matrix Kernel — Outcome runner (Phase G).
//
// Runs every outcome a dim declares, writes per-outcome evidence files keyed
// by gitSha + outcome.id, and produces the OutcomeEvidence map that
// computeDerivedScore consumes. Mirrors the Phase A probe pattern with
// adapted semantics — each outcome is its own self-contained shell command,
// no monorepo detection, no per-package mapping (outcomes are dim-scoped).

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  applyOutcomeDefaults,
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidence,
  type OutcomeEvidenceEntry,
} from '../types/outcome.js';
import { isEvidenceStale } from '../types/capability-test.js';

const execFileAsync = promisify(execFile);
const OUTCOME_EVIDENCE_DIR = path.join('.danteforge', 'outcome-evidence');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunOutcomeOptions {
  dimensionId: string;
  outcome: Outcome;
  cwd: string;
  /** Force re-execution even when cached evidence for this SHA exists. */
  forceCold?: boolean;
  // Injection seams (hermetic tests)
  _spawn?: (cmd: string, opts: SpawnOpts) => SpawnResult;
  _readGitSha?: (cwd: string) => Promise<string | null>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, data: string) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  /**
   * Phase H Time Machine integration: injection seam for tests.
   * Called best-effort after evidence is written. Production code uses the
   * default `createTimeMachineCommit` from src/core/time-machine.ts.
   * If undefined (the default), the runner lazy-imports the real function.
   * A null/no-op function disables the integration (for tests).
   */
  _createTimeMachineCommit?: ((opts: import('../../core/time-machine.js').CreateTimeMachineCommitOptions) => Promise<unknown>) | null;
}

interface SpawnOpts {
  shell: boolean;
  cwd: string;
  timeout: number;
  encoding: 'utf8';
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface RunAllOutcomesOptions {
  cwd: string;
  dimensions: Array<{ id: string; outcomes?: Outcome[] }>;
  /** Filter to one dim. */
  dim?: string;
  /** Filter to one tier. */
  tier?: string;
  forceCold?: boolean;
  // Injection seams
  _spawn?: RunOutcomeOptions['_spawn'];
  _readGitSha?: RunOutcomeOptions['_readGitSha'];
  _readFile?: RunOutcomeOptions['_readFile'];
  _writeFile?: RunOutcomeOptions['_writeFile'];
  _mkdir?: RunOutcomeOptions['_mkdir'];
  _exists?: RunOutcomeOptions['_exists'];
  _createTimeMachineCommit?: RunOutcomeOptions['_createTimeMachineCommit'];
  _onProgress?: (msg: string) => void;
}

export interface RunAllOutcomesResult {
  evidence: OutcomeEvidence;
  totalOutcomes: number;
  passingOutcomes: number;
  failingOutcomes: number;
  perDimension: Array<{ dimensionId: string; total: number; passing: number; failing: number }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function defaultReadGitSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function defaultSpawn(cmd: string, opts: SpawnOpts): SpawnResult {
  const r = spawnSync(cmd, [], opts);
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : v ? String(v) : '');
  return { status: r.status, stdout: toStr(r.stdout), stderr: toStr(r.stderr) };
}

function tailLines(s: string, n: number): string {
  return s.split('\n').slice(-n).join('\n');
}

function evidencePathFor(cwd: string, gitSha: string | null, dimensionId: string, outcomeId: string): string {
  const sha = gitSha ?? 'nogit';
  // Sanitize outcomeId for filesystem
  const safeId = outcomeId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeDim = dimensionId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(cwd, OUTCOME_EVIDENCE_DIR, `${sha}-${safeDim}-${safeId}.json`);
}

// ── Run one outcome ──────────────────────────────────────────────────────────

export async function runOneOutcome(options: RunOutcomeOptions): Promise<OutcomeEvidenceEntry> {
  const outcome = applyOutcomeDefaults(options.outcome);
  const cwd = options.cwd;
  const spawn = options._spawn ?? defaultSpawn;
  const gitFn = options._readGitSha ?? defaultReadGitSha;
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFn = options._writeFile ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  const existsFn = options._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  const gitSha = await gitFn(cwd);
  const evidencePath = evidencePathFor(cwd, gitSha, options.dimensionId, outcome.id);

  // Cache hit: same SHA, evidence exists, not forced cold, AND not stale per
  // the tier's freshness window. Stale evidence falls through to re-execute,
  // auto-healing freshness without operator intervention.
  if (!options.forceCold && gitSha && (await existsFn(evidencePath))) {
    try {
      const raw = await readFn(evidencePath);
      const cached = JSON.parse(raw) as OutcomeEvidenceEntry;
      if (cached.gitSha === gitSha) {
        if (!isEvidenceStale(cached.tier, cached.ranAt)) {
          return cached;
        }
        // Stale → drop through to re-run. Subsequent runs will replace this
        // evidence file with fresh ranAt + identical SHA.
      }
    } catch { /* fall through to re-run */ }
  }

  // Kind dispatch: built-in checks bypass the shell runner.
  const kind = outcome.kind ?? 'shell';
  if (kind === 'production-usage-fresh') {
    const start = Date.now();
    const { runProductionUsageFresh, freshResultToEvidence } = await import('./production-usage-fresh.js');
    const freshOutcome = outcome as import('../types/outcome.js').ProductionUsageFreshOutcome;
    const result = await runProductionUsageFresh(freshOutcome, cwd);
    const entry = freshResultToEvidence(freshOutcome, options.dimensionId, result, gitSha, evidencePath, Date.now() - start);
    await writeFn(evidencePath, JSON.stringify(entry, null, 2));
    await recordOutcomeEvidenceCommit(entry, cwd, options._createTimeMachineCommit);
    return entry;
  }
  // 'external-benchmark' and 'telemetry' fall through to shell mode for now (Phase H Slice 2 follow-up).

  // Shell mode: the default — spawn the outcome's shell command.
  const shellOutcome = outcome as import('../types/outcome.js').ShellOutcome;
  if (!shellOutcome.command) {
    throw new Error(`Outcome ${outcome.id} (kind=${kind}) has no command field but the substrate fell through to shell mode`);
  }

  const start = Date.now();
  const timeout = outcome.timeout_ms ?? 60_000;
  let result: SpawnResult;
  try {
    result = spawn(shellOutcome.command, { shell: true, cwd, timeout, encoding: 'utf8' });
  } catch (err) {
    result = {
      status: -1, stdout: '',
      stderr: `spawn error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const durationMs = Date.now() - start;

  const expectedExit = shellOutcome.expected_exit ?? 0;
  const actualExit = result.status ?? 1;
  let passed = actualExit === expectedExit;

  // Check output pattern if declared
  let failureReason: string | undefined;
  if (passed && shellOutcome.expected_output_pattern) {
    try {
      const re = new RegExp(shellOutcome.expected_output_pattern);
      const combined = `${result.stdout}\n${result.stderr}`;
      if (!re.test(combined)) {
        passed = false;
        failureReason = `expected_output_pattern did not match`;
      }
    } catch (err) {
      passed = false;
      failureReason = `bad regex in expected_output_pattern: ${err instanceof Error ? err.message : 'unknown'}`;
    }
  }
  if (!passed && !failureReason) {
    failureReason = `exit ${actualExit} (expected ${expectedExit})`;
  }

  const entry: OutcomeEvidenceEntry = {
    dimensionId: options.dimensionId,
    outcomeId: outcome.id,
    tier: outcome.tier,
    gitSha,
    passed,
    exitCode: actualExit,
    durationMs,
    stdoutTail: tailLines(result.stdout, 100),
    stderrTail: tailLines(result.stderr, 100),
    failureReason,
    ranAt: new Date().toISOString(),
    evidencePath,
  };

  await writeFn(evidencePath, JSON.stringify(entry, null, 2));
  await recordOutcomeEvidenceCommit(entry, cwd, options._createTimeMachineCommit);
  return entry;
}

/**
 * Best-effort Time Machine commit recording an outcome's evidence file.
 * Mirrors the pattern from `matrix-development-engine.ts:333-345`. Crashes
 * are swallowed — the substrate's score/outcome work must never block on the
 * causal substrate. The integration is purely for traceability: future
 * audits can reconstruct which evidence supported which derived-score
 * computation by walking the Time Machine commit graph.
 */
async function recordOutcomeEvidenceCommit(
  entry: OutcomeEvidenceEntry,
  cwd: string,
  override?: RunOutcomeOptions['_createTimeMachineCommit'],
): Promise<void> {
  // Explicit null disables (test seam); undefined falls through to real import.
  if (override === null) return;
  try {
    const createFn = override
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    await createFn({
      cwd,
      paths: [entry.evidencePath],
      label: `outcome-evidence/${entry.dimensionId}/${entry.outcomeId}/${entry.tier}/${entry.passed ? 'pass' : 'fail'}`,
      causalLinks: {
        materials: [entry.evidencePath],
        inputDependencies: [],
      },
    });
  } catch {
    // best-effort — TM failures never block outcome execution
  }
}

// ── Run all outcomes across a set of dims ────────────────────────────────────

export async function runAllOutcomes(options: RunAllOutcomesOptions): Promise<RunAllOutcomesResult> {
  const evidence: OutcomeEvidence = new Map();
  const onProgress = options._onProgress ?? (() => {});
  const perDimension: RunAllOutcomesResult['perDimension'] = [];
  let totalOutcomes = 0;
  let passingOutcomes = 0;
  let failingOutcomes = 0;

  for (const dim of options.dimensions) {
    if (options.dim && dim.id !== options.dim) continue;
    const outcomes = (dim.outcomes ?? []).filter(o => !options.tier || o.tier === options.tier);
    if (outcomes.length === 0) continue;

    let dimPassing = 0;
    let dimFailing = 0;

    for (const outcome of outcomes) {
      onProgress(`Running ${dim.id}/${outcome.id} (${outcome.tier})…`);
      const entry = await runOneOutcome({
        dimensionId: dim.id,
        outcome,
        cwd: options.cwd,
        forceCold: options.forceCold,
        _spawn: options._spawn,
        _readGitSha: options._readGitSha,
        _readFile: options._readFile,
        _writeFile: options._writeFile,
        _mkdir: options._mkdir,
        _exists: options._exists,
        _createTimeMachineCommit: options._createTimeMachineCommit,
      });
      evidence.set(makeEvidenceKey(dim.id, outcome.id), entry);
      totalOutcomes++;
      if (entry.passed) {
        passingOutcomes++;
        dimPassing++;
      } else {
        failingOutcomes++;
        dimFailing++;
      }
    }

    perDimension.push({
      dimensionId: dim.id,
      total: outcomes.length,
      passing: dimPassing,
      failing: dimFailing,
    });
  }

  return { evidence, totalOutcomes, passingOutcomes, failingOutcomes, perDimension };
}

// ── Load existing evidence from disk ─────────────────────────────────────────

/**
 * Read all outcome evidence files for the current git SHA. Used by loadMatrix
 * to populate the OutcomeEvidence map without re-running anything.
 */
export async function loadOutcomeEvidence(
  cwd: string,
  gitSha?: string | null,
  options: {
    _readdir?: (p: string) => Promise<string[]>;
    _readFile?: (p: string) => Promise<string>;
    _exists?: (p: string) => Promise<boolean>;
    _readGitSha?: (cwd: string) => Promise<string | null>;
  } = {},
): Promise<OutcomeEvidence> {
  const readdir = options._readdir ?? ((p: string) => fs.readdir(p));
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const existsFn = options._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });
  const gitFn = options._readGitSha ?? defaultReadGitSha;
  const evidence: OutcomeEvidence = new Map();

  const dir = path.join(cwd, OUTCOME_EVIDENCE_DIR);
  if (!(await existsFn(dir))) return evidence;

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return evidence;
  }

  const targetSha = gitSha ?? await gitFn(cwd);
  const prefix = targetSha ? `${targetSha}-` : 'nogit-';

  for (const f of files.filter(n => n.endsWith('.json') && n.startsWith(prefix))) {
    try {
      const raw = await readFile(path.join(dir, f));
      const entry = JSON.parse(raw) as OutcomeEvidenceEntry;
      if (entry?.dimensionId && entry?.outcomeId) {
        evidence.set(makeEvidenceKey(entry.dimensionId, entry.outcomeId), entry);
      }
    } catch { /* skip unreadable */ }
  }

  return evidence;
}
