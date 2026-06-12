// convergence-health.ts — Convergence & self-healing health checker
// Reads score snapshots, detects stalls, checks STATE.yaml integrity,
// stale lock files, and verify-status consistency.
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { isProcessAlive } from '../../core/state-lock.js';
import { analyzeConvergenceTrend } from '../../core/convergence-trend-analysis.js';

const STATE_DIR = '.danteforge';
const SNAPSHOTS_DIR = 'snapshots';
const LOCK_FILE = 'STATE.lock';
const STATE_FILE = 'STATE.yaml';
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
  repairable?: boolean;
}

export interface ConvergenceHealthResult {
  checks: HealthCheck[];
  overallStatus: CheckStatus;
  timestamp: string;
  recommendations: HealthRecommendation[];
  repairs?: RepairAction[];
}

export interface ConvergenceHealthOptions {
  cwd?: string;
  json?: boolean;
  /** When true, automatically fix detected issues (stale locks, failed verify status) */
  autoRepair?: boolean;
  /** Injection seam: override fs.stat for testing */
  _stat?: (p: string) => Promise<{ mtimeMs: number }>;
  /** Injection seam: override Date.now for testing */
  _now?: () => number;
  /** Injection seam: override readdir for snapshots */
  _readdir?: (p: string) => Promise<string[]>;
  /** Injection seam: override readFile for deterministic tests */
  _readFile?: (p: string, enc: string) => Promise<string>;
  /** Injection seam: override unlink for testing */
  _unlink?: (p: string) => Promise<void>;
  /** Injection seam: override writeFile for testing */
  _writeFile?: (p: string, data: string) => Promise<void>;
  /** Injection seam: override process liveness checks for deterministic tests */
  _isProcessAlive?: (pid: number) => boolean;
}

export interface RepairAction {
  type: string;
  description: string;
  success: boolean;
  error?: string;
}

export type HealthRecommendationAction =
  | 'adversarial-rebase'
  | 'clear-stale-lock'
  | 'inspect-regression'
  | 'repair-state'
  | 'rerun-verify'
  | 'seed-score-snapshots'
  | 'stabilize-oscillation';

export interface HealthRecommendation {
  checkName: string;
  action: HealthRecommendationAction;
  command: string;
  rationale: string;
  urgency: 'low' | 'medium' | 'high';
  repairable: boolean;
}

interface ScoreSnapshot {
  score?: number;
  timestamp?: string;
}

function parseLockPid(raw: string): number | null {
  const pid = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function checkScoreTrend(
  snapshotsPath: string,
  opts: ConvergenceHealthOptions,
): Promise<HealthCheck> {
  const readdir = opts._readdir ?? ((p: string) => fs.readdir(p));
  const readFile = opts._readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));

  try {
    const files = (await readdir(snapshotsPath))
      .filter(f => f.endsWith('.json'))
      .sort()
      .slice(-5);

    if (files.length < 2) {
      return {
        name: 'Score Trend',
        status: 'warn',
        detail: `Only ${files.length} snapshot(s) found — need at least 2 to detect trend`,
      };
    }

    const snapshots: { score: number; ts: string }[] = [];
    for (const file of files) {
      try {
        const raw = await readFile(path.join(snapshotsPath, file), 'utf8');
        const parsed = JSON.parse(raw) as ScoreSnapshot;
        const score = typeof parsed.score === 'number' ? parsed.score : null;
        if (score !== null) {
          snapshots.push({ score, ts: parsed.timestamp ?? file });
        }
      } catch {
        // skip unreadable snapshot
      }
    }

    if (snapshots.length < 2) {
      return {
        name: 'Score Trend',
        status: 'warn',
        detail: 'Insufficient parseable snapshots for trend analysis',
      };
    }

    const first = snapshots[0]!.score;
    const last = snapshots[snapshots.length - 1]!.score;
    const delta = last - first;
    const trend = analyzeConvergenceTrend(snapshots);

    if (trend.status === 'oscillating') {
      return {
        name: 'Score Trend',
        status: 'warn',
        detail:
          `Oscillating - delta ${trend.delta.toFixed(2)} with ${trend.directionChanges} ` +
          `direction changes and ${trend.drawdown.toFixed(2)} drawdown over last ${trend.count} snapshots`,
      };
    }

    if (delta > 0.05) {
      return {
        name: 'Score Trend',
        status: 'ok',
        detail: `Improving — delta +${delta.toFixed(2)} over last ${snapshots.length} snapshots`,
      };
    }

    if (delta < -0.05) {
      return {
        name: 'Score Trend',
        status: 'fail',
        detail: `Regressing — delta ${delta.toFixed(2)} over last ${snapshots.length} snapshots`,
      };
    }

    return {
      name: 'Score Trend',
      status: 'warn',
      detail: `Stalled — delta ${delta.toFixed(2)} over last ${snapshots.length} snapshots (threshold: 0.05)`,
    };
  } catch {
    return {
      name: 'Score Trend',
      status: 'warn',
      detail: 'Snapshots directory not found or unreadable — run danteforge score to create snapshots',
    };
  }
}

async function checkStateYaml(
  stateFilePath: string,
  opts: ConvergenceHealthOptions,
): Promise<HealthCheck> {
  const readFile = opts._readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));

  try {
    const raw = await readFile(stateFilePath, 'utf8');
    // Quick structural validation without importing yaml.
    // STATE.yaml always starts with "project:" key.
    if (!raw.includes('project:')) {
      return {
        name: 'STATE.yaml Integrity',
        status: 'fail',
        detail: 'STATE.yaml missing required "project:" key — file may be corrupt',
      };
    }
    try {
      // Dynamic import yaml so this module stays lightweight.
      const yaml = await import('yaml');
      const parsed = yaml.default.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object');
      return {
        name: 'STATE.yaml Integrity',
        status: 'ok',
        detail: `STATE.yaml is valid (project: ${String(parsed['project'] ?? 'unknown')})`,
      };
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return {
        name: 'STATE.yaml Integrity',
        status: 'fail',
        detail: `STATE.yaml parse error: ${msg}`,
      };
    }
  } catch {
    return {
      name: 'STATE.yaml Integrity',
      status: 'fail',
      detail: 'STATE.yaml is missing — run "danteforge init" to initialise the project',
    };
  }
}

async function checkStaleLock(
  lockPath: string,
  opts: ConvergenceHealthOptions,
): Promise<HealthCheck> {
  const statFn = opts._stat ?? ((p: string) => fs.stat(p));
  const readFile = opts._readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));
  const processAlive = opts._isProcessAlive ?? isProcessAlive;
  const now = opts._now ?? (() => Date.now());

  try {
    const stat = await statFn(lockPath);
    const ageMs = now() - stat.mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      const ageMin = Math.round(ageMs / 60_000);
      let pid: number | null = null;
      try {
        pid = parseLockPid(await readFile(lockPath, 'utf8'));
      } catch {
        // An unreadable old lock is still an abandoned lock candidate.
      }

      if (pid !== null && processAlive(pid)) {
        return {
          name: 'Lock File',
          status: 'warn',
          detail: `Old lock file is held by live process PID ${pid} (${ageMin} min old) - preserving lock`,
          repairable: false,
        };
      }

      return {
        name: 'Lock File',
        status: 'fail',
        detail: `Stale lock file detected (${ageMin} min old) — run "danteforge convergence-health" to auto-clear, or delete ${lockPath}`,
      };
    }
    return {
      name: 'Lock File',
      status: 'warn',
      detail: `Active lock file found (${Math.round(ageMs / 1000)}s old) — another danteforge process may be running`,
    };
  } catch {
    // Lock file doesn't exist — healthy state.
    return {
      name: 'Lock File',
      status: 'ok',
      detail: 'No lock file — system is idle',
    };
  }
}

async function checkVerifyConsistency(
  stateFilePath: string,
  opts: ConvergenceHealthOptions,
): Promise<HealthCheck> {
  const readFile = opts._readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));

  try {
    const raw = await readFile(stateFilePath, 'utf8');
    const yaml = await import('yaml');
    const parsed = yaml.default.parse(raw) as Record<string, unknown>;

    const lastVerifyStatus = parsed['lastVerifyStatus'] as string | undefined;
    const lastVerifiedAt = parsed['lastVerifiedAt'] as string | undefined;

    if (!lastVerifyStatus) {
      return {
        name: 'Verify Status',
        status: 'warn',
        detail: 'No verify status recorded — run "danteforge verify --light" to establish a baseline',
      };
    }

    if (lastVerifyStatus === 'fail') {
      const when = lastVerifiedAt ? ` (last: ${lastVerifiedAt})` : '';
      return {
        name: 'Verify Status',
        status: 'fail',
        detail: `Last verify recorded as FAIL${when} — run "danteforge verify --light" to diagnose`,
      };
    }

    if (lastVerifyStatus === 'warn') {
      return {
        name: 'Verify Status',
        status: 'warn',
        detail: `Last verify status: WARN${lastVerifiedAt ? ` (${lastVerifiedAt})` : ''}`,
      };
    }

    return {
      name: 'Verify Status',
      status: 'ok',
      detail: `Last verify: ${lastVerifyStatus.toUpperCase()}${lastVerifiedAt ? ` at ${lastVerifiedAt}` : ''}`,
    };
  } catch {
    return {
      name: 'Verify Status',
      status: 'warn',
      detail: 'Could not read verify status from STATE.yaml',
    };
  }
}

function recommendationForCheck(check: HealthCheck): HealthRecommendation | null {
  if (check.name === 'Lock File' && check.status === 'fail' && check.repairable !== false) {
    return {
      checkName: check.name,
      action: 'clear-stale-lock',
      command: 'danteforge convergence-health --auto-repair',
      rationale: 'A stale lock can block every convergence loop until it is cleared.',
      urgency: 'high',
      repairable: true,
    };
  }

  if (check.name === 'Verify Status' && check.status === 'fail') {
    return {
      checkName: check.name,
      action: 'rerun-verify',
      command: 'danteforge verify --light --retry 1',
      rationale: 'The last verification failed; rerunning with one retry distinguishes transient failure from a real regression.',
      urgency: 'high',
      repairable: false,
    };
  }

  if (check.name === 'Score Trend' && check.status === 'fail') {
    return {
      checkName: check.name,
      action: 'inspect-regression',
      command: 'danteforge proof --convergence',
      rationale: 'Recent scores regressed, so the next step should collect evidence before applying more changes.',
      urgency: 'high',
      repairable: false,
    };
  }

  if (check.name === 'Score Trend' && check.status === 'warn' && check.detail.includes('Oscillating')) {
    return {
      checkName: check.name,
      action: 'stabilize-oscillation',
      command: 'danteforge harden --dim convergence_self_healing',
      rationale: 'Scores are repeatedly giving back gains; run the harden gate before the next convergence wave.',
      urgency: 'high',
      repairable: false,
    };
  }

  if (check.name === 'Score Trend' && check.status === 'warn' && check.detail.includes('Stalled')) {
    return {
      checkName: check.name,
      action: 'adversarial-rebase',
      command: 'danteforge assess',
      rationale: 'A stalled trend needs an adversarial pass to find the weakness the current loop is missing.',
      urgency: 'medium',
      repairable: false,
    };
  }

  if (check.name === 'Score Trend' && check.status === 'warn') {
    return {
      checkName: check.name,
      action: 'seed-score-snapshots',
      command: 'danteforge score --full',
      rationale: 'Trend detection needs at least two parseable score snapshots.',
      urgency: 'low',
      repairable: false,
    };
  }

  if (check.name === 'STATE.yaml Integrity' && check.status === 'fail') {
    return {
      checkName: check.name,
      action: 'repair-state',
      command: 'danteforge doctor',
      rationale: 'A missing or corrupt STATE.yaml prevents reliable convergence bookkeeping.',
      urgency: 'high',
      repairable: false,
    };
  }

  return null;
}

function buildRecommendations(checks: HealthCheck[]): HealthRecommendation[] {
  return checks
    .map(recommendationForCheck)
    .filter((r): r is HealthRecommendation => r !== null);
}

async function autoRepair(
  lockPath: string,
  stateFilePath: string,
  checks: HealthCheck[],
  opts: ConvergenceHealthOptions,
): Promise<RepairAction[]> {
  const unlinkFn = opts._unlink ?? ((p: string) => fs.unlink(p));
  const readFile = opts._readFile ?? ((p: string, enc: string) => fs.readFile(p, enc as BufferEncoding));
  const writeFn = opts._writeFile ?? ((p: string, data: string) => fs.writeFile(p, data, 'utf8'));
  const repairs: RepairAction[] = [];

  const lockCheck = checks.find(c => c.name === 'Lock File' && c.status === 'fail' && c.repairable !== false);
  if (lockCheck) {
    try {
      await unlinkFn(lockPath);
      repairs.push({ type: 'clear-stale-lock', description: 'Removed stale lock file', success: true });
    } catch (err) {
      repairs.push({ type: 'clear-stale-lock', description: 'Failed to remove stale lock file', success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const verifyCheck = checks.find(c => c.name === 'Verify Status' && c.status === 'fail');
  if (verifyCheck) {
    try {
      const raw = await readFile(stateFilePath, 'utf8').catch(() => '');
      if (raw) {
        const yaml = await import('yaml');
        const doc = yaml.default.parseDocument(raw);
        doc.set('lastVerifyStatus', 'unknown');
        doc.set('lastVerifyMessage', 'auto-repaired by convergence-health');
        const updated = doc.toString();
        await writeFn(stateFilePath, updated);
        repairs.push({ type: 'reset-verify-status', description: 'Reset lastVerifyStatus to unknown (was fail)', success: true });
      }
    } catch (err) {
      repairs.push({ type: 'reset-verify-status', description: 'Failed to reset verify status', success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return repairs;
}

export async function convergenceHealthCheck(
  opts: ConvergenceHealthOptions = {},
): Promise<ConvergenceHealthResult> {
  const cwd = opts.cwd ?? process.cwd();
  const danteDir = path.join(cwd, STATE_DIR);
  const snapshotsPath = path.join(danteDir, SNAPSHOTS_DIR);
  const lockPath = path.join(danteDir, LOCK_FILE);
  const stateFilePath = path.join(danteDir, STATE_FILE);

  const checks = await Promise.all([
    checkScoreTrend(snapshotsPath, opts),
    checkStateYaml(stateFilePath, opts),
    checkStaleLock(lockPath, opts),
    checkVerifyConsistency(stateFilePath, opts),
  ]);

  const overallStatus: CheckStatus =
    checks.some(c => c.status === 'fail') ? 'fail'
    : checks.some(c => c.status === 'warn') ? 'warn'
    : 'ok';

  const recommendations = buildRecommendations(checks);

  const repairs = opts.autoRepair && overallStatus !== 'ok'
    ? await autoRepair(lockPath, stateFilePath, checks, opts)
    : undefined;

  return {
    checks,
    overallStatus,
    timestamp: new Date().toISOString(),
    recommendations,
    repairs,
  };
}

function printHealthTable(result: ConvergenceHealthResult): void {
  process.stdout.write('\n' + chalk.bold('  ╔══ Convergence Health ══╗') + '\n\n');
  for (const check of result.checks) {
    const padded = check.name.padEnd(26);
    if (check.status === 'fail') {
      process.stdout.write(`  ${chalk.red('✗')}  ${chalk.red(padded)} ${chalk.dim(check.detail)}\n`);
    } else if (check.status === 'warn') {
      process.stdout.write(`  ${chalk.yellow('⚠')}  ${chalk.yellow(padded)} ${chalk.dim(check.detail)}\n`);
    } else {
      process.stdout.write(`  ${chalk.green('✔')}  ${chalk.green(padded)} ${chalk.dim(check.detail)}\n`);
    }
  }

  process.stdout.write('\n');
  if (result.repairs && result.repairs.length > 0) {
    process.stdout.write(chalk.bold('  ── Auto-Repair ──') + '\n');
    for (const r of result.repairs) {
      if (r.success) {
        process.stdout.write(`  ${chalk.green('↺')}  ${chalk.green(r.description)}\n`);
      } else {
        process.stdout.write(`  ${chalk.red('✗')}  ${chalk.red(r.description)}: ${r.error ?? 'unknown error'}\n`);
      }
    }
    process.stdout.write('\n');
  }

  if (result.recommendations.length > 0) {
    process.stdout.write(chalk.bold('  Recommended Next Steps') + '\n');
    for (const rec of result.recommendations) {
      const urgency = rec.urgency === 'high'
        ? chalk.red(rec.urgency)
        : rec.urgency === 'medium'
          ? chalk.yellow(rec.urgency)
          : chalk.dim(rec.urgency);
      process.stdout.write(`  ${urgency}  ${chalk.bold(rec.command)}\n`);
      process.stdout.write(`        ${chalk.dim(rec.rationale)}\n`);
    }
    process.stdout.write('\n');
  }

  if (result.overallStatus === 'ok') {
    process.stdout.write('  ' + chalk.bold.green('● HEALTHY') + '\n\n');
  } else if (result.overallStatus === 'warn') {
    process.stdout.write('  ' + chalk.bold.yellow('● DEGRADED') + chalk.dim(' — review warnings above') + '\n\n');
  } else if (result.repairs && result.repairs.some(r => r.success)) {
    process.stdout.write('  ' + chalk.bold.yellow('● REPAIRED') + chalk.dim(' — re-run to confirm health') + '\n\n');
  } else {
    process.stdout.write('  ' + chalk.bold.red('● UNHEALTHY') + chalk.dim(' — fix failures above') + '\n\n');
    process.exitCode = 1;
  }
}

export async function convergenceHealth(opts: ConvergenceHealthOptions = {}): Promise<void> {
  try {
    const result = await convergenceHealthCheck(opts);

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.overallStatus === 'fail') process.exitCode = 1;
      return;
    }

    printHealthTable(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`convergence-health error: ${msg}`);
    process.exitCode = 1;
  }
}
