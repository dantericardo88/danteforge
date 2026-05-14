// convergence-health.ts — Convergence & self-healing health checker
// Reads score snapshots, detects stalls, checks STATE.yaml integrity,
// stale lock files, and verify-status consistency.
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';

const STATE_DIR = '.danteforge';
const SNAPSHOTS_DIR = 'snapshots';
const LOCK_FILE = 'STATE.lock';
const STATE_FILE = 'STATE.yaml';
const STALE_LOCK_MS = 5 * 60 * 1000; // 5 minutes

// ── Types ────────────────────────────────────────────────────────────────────

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface HealthCheck {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface ConvergenceHealthResult {
  checks: HealthCheck[];
  overallStatus: CheckStatus;
  timestamp: string;
}

export interface ConvergenceHealthOptions {
  cwd?: string;
  json?: boolean;
  /** Injection seam: override fs.stat for testing */
  _stat?: (p: string) => Promise<{ mtimeMs: number }>;
  /** Injection seam: override Date.now for testing */
  _now?: () => number;
  /** Injection seam: override readdir for snapshots */
  _readdir?: (p: string) => Promise<string[]>;
  /** Injection seam: override readFile for deterministic tests */
  _readFile?: (p: string, enc: string) => Promise<string>;
}

// ── Score snapshot shape (minimal) ──────────────────────────────────────────

interface ScoreSnapshot {
  score?: number;
  timestamp?: string;
}

// ── Individual checks ────────────────────────────────────────────────────────

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
  const now = opts._now ?? (() => Date.now());

  try {
    const stat = await statFn(lockPath);
    const ageMs = now() - stat.mtimeMs;
    if (ageMs > STALE_LOCK_MS) {
      const ageMin = Math.round(ageMs / 60_000);
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

// ── Orchestrator ─────────────────────────────────────────────────────────────

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

  return {
    checks,
    overallStatus,
    timestamp: new Date().toISOString(),
  };
}

// ── CLI command ──────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<CheckStatus, string> = {
  ok: '[ok]',
  warn: '[warn]',
  fail: '[FAIL]',
};

function printHealthTable(result: ConvergenceHealthResult): void {
  logger.info('\n=== Convergence Health Report ===\n');
  for (const check of result.checks) {
    const icon = STATUS_ICONS[check.status];
    const padded = check.name.padEnd(24);
    if (check.status === 'fail') {
      logger.error(`  ${icon}  ${padded} ${check.detail}`);
    } else if (check.status === 'warn') {
      logger.warn(`  ${icon} ${padded} ${check.detail}`);
    } else {
      logger.success(`  ${icon}   ${padded} ${check.detail}`);
    }
  }

  logger.info('');
  if (result.overallStatus === 'ok') {
    logger.success(`Overall: HEALTHY`);
  } else if (result.overallStatus === 'warn') {
    logger.warn(`Overall: DEGRADED — review warnings above`);
  } else {
    logger.error(`Overall: UNHEALTHY — fix failures above`);
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
