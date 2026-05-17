import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import {
  runCapabilityTest,
  type RunCapabilityTestOptions,
} from '../../matrix/engines/capability-test-runner.js';
import type { CapabilityTestEntry } from '../../matrix/types/capability-test.js';
import { CAPABILITY_TEST_SCORE_CAP } from '../../matrix/types/capability-test.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EvidenceAuditOptions {
  cwd?: string;
  runTests?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _runCapabilityTest?: (opts: RunCapabilityTestOptions) => ReturnType<typeof runCapabilityTest>;
}

export interface DimAuditEntry {
  dimensionId: string;
  label: string;
  selfScore: number;
  hasCapabilityTest: boolean;
  /** Only set when runTests=true */
  testPassed?: boolean;
  testExitCode?: number;
  wouldBeCapped: boolean;
}

export interface EvidenceAuditResult {
  dimensions: DimAuditEntry[];
  totalDims: number;
  missingCapTest: number;
  wouldBeCapped: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runEvidenceAudit(options: EvidenceAuditOptions = {}): Promise<EvidenceAuditResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loadFn = options._loadMatrix ?? loadMatrix;
  const capRunFn = options._runCapabilityTest ?? runCapabilityTest;

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('[evidence-audit] No compete matrix found. Run `danteforge compete --init` first.');
    throw new Error('No compete matrix found.');
  }

  const entries: DimAuditEntry[] = [];

  for (const dim of matrix.dimensions) {
    const selfScore = dim.scores['self'] ?? 0;
    const capTest = (dim as unknown as Record<string, unknown>).capability_test as CapabilityTestEntry | undefined;
    const hasCapabilityTest = capTest !== undefined && capTest !== null;

    let testPassed: boolean | undefined;
    let testExitCode: number | undefined;

    if (options.runTests && hasCapabilityTest) {
      const verdict = capRunFn({ dimensionId: dim.id, capabilityTest: capTest, cwd });
      testPassed = verdict.allowed;
      testExitCode = verdict.result?.exitCode;
    }

    const wouldBeCapped = selfScore > CAPABILITY_TEST_SCORE_CAP && (
      !hasCapabilityTest || (testPassed === false)
    );

    entries.push({
      dimensionId: dim.id,
      label: dim.label,
      selfScore,
      hasCapabilityTest,
      testPassed,
      testExitCode,
      wouldBeCapped,
    });
  }

  // Sort: capped first (worst), then no test, then passing
  entries.sort((a, b) => {
    const rank = (e: DimAuditEntry) => e.wouldBeCapped ? 0 : !e.hasCapabilityTest ? 1 : 2;
    return rank(a) - rank(b) || b.selfScore - a.selfScore;
  });

  logger.info('');
  logger.info('── Evidence Audit ──────────────────────────────────────────────────────');

  for (const e of entries) {
    const score = `[${e.selfScore.toFixed(1)}/10]`.padEnd(10);
    const capStatus = e.hasCapabilityTest
      ? (e.testPassed === true ? '✓ pass' : e.testPassed === false ? '✗ fail' : '○ never run')
      : '✗ MISSING';

    const cappedNote = e.wouldBeCapped ? ' ← WILL BE CAPPED AT 5.0' : '';

    if (e.wouldBeCapped) {
      logger.error(`  ✗ ${e.dimensionId.padEnd(28)} ${score} cap_test: ${capStatus}${cappedNote}`);
    } else if (!e.hasCapabilityTest) {
      logger.warn(`  ⚠ ${e.dimensionId.padEnd(28)} ${score} cap_test: ${capStatus}`);
    } else {
      logger.success(`  ✓ ${e.dimensionId.padEnd(28)} ${score} cap_test: ${capStatus}`);
    }
  }

  logger.info('');

  const missingCapTest = entries.filter(e => !e.hasCapabilityTest).length;
  const wouldBeCapped = entries.filter(e => e.wouldBeCapped).length;

  logger.info(`Total: ${entries.length} dimensions`);
  if (missingCapTest > 0) logger.warn(`  ⚠ Missing capability_test: ${missingCapTest} (run: danteforge evidence-scaffold)`);
  if (wouldBeCapped > 0)  logger.error(`  ✗ Would be capped at 5.0: ${wouldBeCapped}`);
  if (wouldBeCapped === 0 && missingCapTest === 0) logger.success('  All dimensions have capability_test configured ✓');

  if (!options.runTests && entries.some(e => e.hasCapabilityTest)) {
    logger.info('');
    logger.info('  Tip: run `danteforge evidence-audit --run-tests` to execute all tests now');
  }

  return { dimensions: entries, totalDims: entries.length, missingCapTest, wouldBeCapped };
}
