// matrix verify-capability <dimensionId> — runs a dimension's capability_test
// and reports full stdout/stderr for diagnosis.
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import {
  runCapabilityTest,
  type RunCapabilityTestOptions,
} from '../../matrix/engines/capability-test-runner.js';
import { isCapabilityTestSpec, isNoCapabilityTest, CAPABILITY_TEST_SCORE_CAP } from '../../matrix/types/capability-test.js';

export interface VerifyCapabilityOptions {
  cwd?: string;
  /** Injection seam for tests. */
  _spawnSync?: RunCapabilityTestOptions['_spawnSync'];
  _loadMatrix?: (matrixPath: string) => Promise<MatrixJson>;
}

interface MatrixDimension {
  id: string;
  label?: string;
  capability_test?: unknown;
}

interface MatrixJson {
  dimensions?: MatrixDimension[];
}

const MATRIX_PATH = '.danteforge/compete/matrix.json';

export async function matrixVerifyCapability(
  dimensionId: string,
  options: VerifyCapabilityOptions = {},
): Promise<{ passed: boolean; exitCode: number }> {
  const cwd = options.cwd ?? process.cwd();
  const matrixPath = path.join(cwd, MATRIX_PATH);

  let matrix: MatrixJson;
  try {
    const loadFn = options._loadMatrix ?? defaultLoadMatrix;
    matrix = await loadFn(matrixPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Cannot read matrix at ${MATRIX_PATH}: ${msg}`);
    return { passed: false, exitCode: 1 };
  }

  const dim = matrix.dimensions?.find(d => d.id === dimensionId);
  if (!dim) {
    logger.error(`Dimension "${dimensionId}" not found in matrix.`);
    return { passed: false, exitCode: 1 };
  }

  const ct = dim.capability_test;

  if (!ct) {
    logger.warn(`Dimension "${dimensionId}" has no capability_test defined.`);
    logger.warn(`Score is permanently capped at ${CAPABILITY_TEST_SCORE_CAP}.`);
    return { passed: false, exitCode: 1 };
  }

  if (isNoCapabilityTest(ct)) {
    logger.warn(`Dimension "${dimensionId}" is marked no_capability_test: ${ct.reason}`);
    logger.warn(`Score is permanently capped at ${CAPABILITY_TEST_SCORE_CAP}.`);
    return { passed: false, exitCode: 1 };
  }

  if (!isCapabilityTestSpec(ct)) {
    logger.error(`Dimension "${dimensionId}" has a malformed capability_test.`);
    return { passed: false, exitCode: 1 };
  }

  logger.info(`Running capability_test for "${dimensionId}": ${ct.command}`);

  const verdict = runCapabilityTest({
    dimensionId,
    capabilityTest: ct,
    cwd,
    _spawnSync: options._spawnSync,
  });

  if (verdict.result) {
    const r = verdict.result;
    process.stdout.write(`\n--- stdout ---\n${r.stdout || '(empty)'}\n`);
    process.stderr.write(`--- stderr ---\n${r.stderr || '(empty)'}\n`);
    logger.info(`Exit code: ${r.exitCode}  Duration: ${r.durationMs}ms`);
  }

  if (verdict.allowed) {
    logger.success(`PASS — capability_test exited 0. Scores above ${CAPABILITY_TEST_SCORE_CAP} are permitted.`);
    return { passed: true, exitCode: 0 };
  }

  logger.error(`FAIL — ${verdict.reason}`);
  logger.error(`Score for "${dimensionId}" is capped at ${CAPABILITY_TEST_SCORE_CAP} until this test passes.`);
  return { passed: false, exitCode: 1 };
}

async function defaultLoadMatrix(matrixPath: string): Promise<MatrixJson> {
  const raw = await fs.readFile(matrixPath, 'utf8');
  return JSON.parse(raw) as MatrixJson;
}
