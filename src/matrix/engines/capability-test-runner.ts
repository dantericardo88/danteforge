// Matrix Kernel — Capability Test Runner (Fix A)
//
// Runs capability_test shell commands for dimensions and enforces the 5.0 score
// cap: no dimension may score above CAPABILITY_TEST_SCORE_CAP without a
// successful capability_test exit-0 run in the same wave.
import { spawnSync } from 'node:child_process';
import { toolchainEnv } from '../../core/toolchain-path.js';
import type {
  CapabilityTestSpec,
  CapabilityTestResult,
  CapabilityTestEntry,
} from '../types/capability-test.js';
import {
  isNoCapabilityTest,
  isCapabilityTestSpec,
  CAPABILITY_TEST_SCORE_CAP,
} from '../types/capability-test.js';
import { looksLikeProductRun, hasGreenForcingWrapper } from './capability-test-integrity.js';

/** A passing test that is NOT a real product run (a --help/version/status probe, a structural file
 *  check, or a test suite) proves the code is REACHABLE/wired, not that the capability WORKS — so it
 *  may authorize up to the structural ceiling (T4), never the full 10. Grading-integrity #1. */
const STRUCTURAL_PROBE_CAP = 7.0;

// ── Public API ───────────────────────────────────────────────────────────────

export interface RunCapabilityTestOptions {
  dimensionId: string;
  capabilityTest: CapabilityTestEntry | undefined;
  /** Working directory for command execution. Defaults to process.cwd(). */
  cwd?: string;
  /** Injection seam: replaces spawnSync for tests. */
  _spawnSync?: SpawnFn;
}

export interface CapabilityTestVerdict {
  dimensionId: string;
  /** true = capability_test passed (exit 0) or no test needed for ≤5.0 scores */
  allowed: boolean;
  /** Score ceiling enforced by this verdict. */
  scoreCap: number;
  reason: string;
  result?: CapabilityTestResult;
}

type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { shell: boolean; cwd: string; timeout: number; encoding: 'utf8'; env?: NodeJS.ProcessEnv },
) => { status: number | null; stdout: string; stderr: string };

/** Run the capability_test for one dimension and return a scored verdict. */
export function runCapabilityTest(options: RunCapabilityTestOptions): CapabilityTestVerdict {
  const { dimensionId, capabilityTest, cwd = process.cwd() } = options;
  const spawn = options._spawnSync ?? defaultSpawn;

  if (!capabilityTest) {
    return {
      dimensionId,
      allowed: false,
      scoreCap: CAPABILITY_TEST_SCORE_CAP,
      reason: 'No capability_test defined. Scores above 5.0 require a passing test.',
    };
  }

  if (isNoCapabilityTest(capabilityTest)) {
    return {
      dimensionId,
      allowed: false,
      scoreCap: CAPABILITY_TEST_SCORE_CAP,
      reason: `Marked no_capability_test: ${capabilityTest.reason}. Permanently capped at 5.0.`,
    };
  }

  if (!isCapabilityTestSpec(capabilityTest)) {
    return {
      dimensionId,
      allowed: false,
      scoreCap: CAPABILITY_TEST_SCORE_CAP,
      reason: 'capability_test is malformed (not a spec or no_capability_test marker).',
    };
  }

  const result = executeCapabilityTest(capabilityTest, dimensionId, cwd, spawn);

  if (result.passed) {
    // Grading-integrity #1: exit-0 alone no longer authorizes a 10. INSPECT what the command exercises
    // (reusing the existing static classifier, previously wired into nothing on the scoring path):
    //  - a green-forcing wrapper (|| true / ; exit 0 / || echo) discards the real exit → it measures
    //    nothing → cap at 5.0 (treat as not-allowed-above-cap);
    //  - a NON-product-run pass (--help/version/status probe, structural file check, or a test suite)
    //    proves reachability/wiring only → cap at the structural ceiling (7.0);
    //  - only a real product run (a non-trivial CLI subcommand / built binary) earns the full 10.
    if (hasGreenForcingWrapper(capabilityTest.command)) {
      return {
        dimensionId, allowed: false, scoreCap: CAPABILITY_TEST_SCORE_CAP, result,
        reason: `capability_test exits 0 but DISCARDS its real exit code (green-forcing wrapper) — it passes regardless of the product, so it measures nothing. Capped at 5.0.`,
      };
    }
    if (!looksLikeProductRun(capabilityTest.command)) {
      return {
        dimensionId, allowed: true, scoreCap: STRUCTURAL_PROBE_CAP, result,
        reason: `capability_test passed (exit 0) but is a REACHABILITY probe (--help/version/status, a structural file check, or a test suite), not a real product run — it proves the capability is wired, not that it works. Capped at ${STRUCTURAL_PROBE_CAP}; author a real product-run test to exceed it.`,
      };
    }
    return {
      dimensionId,
      allowed: true,
      scoreCap: 10,
      reason: `capability_test passed (exit 0) via a real product run in ${result.durationMs}ms.`,
      result,
    };
  }

  return {
    dimensionId,
    allowed: false,
    scoreCap: CAPABILITY_TEST_SCORE_CAP,
    reason: `capability_test failed (exit ${result.exitCode}). Capped at 5.0 until capability is present.`,
    result,
  };
}

/**
 * Apply the capability verdict to a proposed score.
 * If capability_test is absent or fails, score is clamped to scoreCap.
 */
export function applyScoreCap(proposedScore: number, verdict: CapabilityTestVerdict): number {
  if (proposedScore <= verdict.scoreCap) return proposedScore;
  return verdict.scoreCap;
}

/**
 * Run capability tests for multiple dimensions in parallel (synchronous
 * under the hood — each test is fast by design).
 */
export function runCapabilityTests(
  entries: Array<{ dimensionId: string; capabilityTest: CapabilityTestEntry | undefined }>,
  cwd?: string,
  _spawnSync?: SpawnFn,
): CapabilityTestVerdict[] {
  return entries.map(e =>
    runCapabilityTest({ dimensionId: e.dimensionId, capabilityTest: e.capabilityTest, cwd, _spawnSync }),
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function executeCapabilityTest(
  spec: CapabilityTestSpec,
  dimensionId: string,
  cwd: string,
  spawn: SpawnFn,
): CapabilityTestResult {
  const timeoutMs = spec.timeoutMs ?? 30000;
  const start = Date.now();
  let result: { status: number | null; stdout: string; stderr: string };
  try {
    // toolchainEnv: per-user toolchain dirs (cargo/go) appended to PATH so a portable declared
    // command like `cargo test -p member --lib mod` resolves in the gate's subprocess too.
    result = spawn(spec.command, [], { shell: true, cwd, timeout: timeoutMs, encoding: 'utf8', env: toolchainEnv() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      dimensionId,
      passed: false,
      exitCode: -1,
      stdout: '',
      stderr: `spawn error: ${msg}`,
      durationMs: Date.now() - start,
      ranAt: new Date().toISOString(),
    };
  }

  return {
    dimensionId,
    passed: (result.status ?? 1) === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - start,
    ranAt: new Date().toISOString(),
  };
}

function defaultSpawn(
  cmd: string,
  _args: string[],
  opts: { shell: boolean; cwd: string; timeout: number; encoding: 'utf8' },
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(cmd, [], opts);
  const toStr = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'toString' in v) return String(v);
    return '';
  };
  return {
    status: r.status,
    stdout: toStr(r.stdout),
    stderr: toStr(r.stderr),
  };
}
