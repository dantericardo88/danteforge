// migrate-outcomes.ts — backfill structured `input_source` provenance onto legacy
// outcomes so existing matrices comply with the frontier-evidence contract.
//
// HONESTY INVARIANT: this migration can only LOWER or HOLD a score, never raise one.
// It assigns the defensible classifications (synthetic-fixture for file checks / test
// suites, external-benchmark for registered suites) and DELIBERATELY refuses to assign
// `real-user-path` — that is a human judgement, and auto-assigning it would re-open the
// inflation hole the input_source contract was built to close. Genuine CLI/runtime
// outcomes are reported as candidates for an operator to confirm by hand.

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { isStructuralFileCheck } from '../../matrix/engines/outcome-quality.js';
import { isRegisteredExternalSuite } from '../../matrix/engines/external-suite-registry.js';
import type { OutcomeInputSource } from '../../matrix/types/outcome.js';

const TEST_SUITE_RE = /npx\s+tsx\s+--test|npm\s+(?:run\s+)?test|jest|vitest|mocha/;
const CLI_INVOCATION_RE = /node\s+dist\/|node\s+\S*index\.(?:js|ts)/;

export interface MigrateOutcomesOptions {
  cwd?: string;
  write?: boolean;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeMatrix?: (m: CompeteMatrix, p: string) => Promise<void>;
}

export interface MigrateOutcomesResult {
  /** Outcome ids assigned input_source: synthetic-fixture (capped at 7.0). */
  synthetic: string[];
  /** Outcome ids assigned input_source: external-benchmark (registered suite). */
  externalBenchmark: string[];
  /** Outcome ids left undeclared — a human must decide if they are real-user-path. */
  realUserPathCandidates: string[];
  /** Outcome ids that already declared input_source (untouched). */
  alreadyDeclared: string[];
  totalOutcomes: number;
  matrixPath: string;
  wrote: boolean;
}

type Classification =
  | { bucket: 'already' }
  | { bucket: 'synthetic'; source: OutcomeInputSource }
  | { bucket: 'external'; source: OutcomeInputSource }
  | { bucket: 'candidate' };

/**
 * Classify a single outcome for migration. Pure + exported for testing.
 * Returns the input_source to assign (or none, for already-declared / candidate).
 */
export function classifyForMigration(outcome: Record<string, unknown>): Classification {
  if (outcome.input_source) return { bucket: 'already' };

  const cmd = typeof outcome.command === 'string' ? outcome.command : '';
  const kind = (outcome.kind as string | undefined) ?? 'shell';
  const bench = outcome.benchmark;

  // Registered external benchmark → external-benchmark (the one path that can stay 9.5).
  if (kind === 'external-benchmark' && isRegisteredExternalSuite(bench)) {
    return { bucket: 'external', source: { type: 'external-benchmark', suite: (bench as string).toLowerCase() as never } };
  }

  // Structural file checks → synthetic-fixture (these only prove existence).
  if (isStructuralFileCheck(cmd)) {
    return { bucket: 'synthetic', source: { type: 'synthetic-fixture', fixture_id: 'legacy-structural-check' } };
  }

  // Test suites → synthetic-fixture (prove isolation, not production behavior).
  if (TEST_SUITE_RE.test(cmd)) {
    return { bucket: 'synthetic', source: { type: 'synthetic-fixture', fixture_id: 'legacy-test-suite' } };
  }

  // Genuine CLI/runtime/e2e invocation → CANDIDATE for real-user-path. We do NOT auto-
  // assign it: that is the human's call, and auto-assigning would silently raise scores.
  if (kind === 'runtime-exec' || kind === 'e2e-workflow' || kind === 'cli-smoke' || CLI_INVOCATION_RE.test(cmd)) {
    return { bucket: 'candidate' };
  }

  // Anything else → conservatively synthetic (can only lower/hold the score).
  return { bucket: 'synthetic', source: { type: 'synthetic-fixture', fixture_id: 'legacy-unclassified' } };
}

export async function runMigrateOutcomes(options: MigrateOutcomesOptions = {}): Promise<MigrateOutcomesResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const write = options.write ?? false;
  const loadFn = options._loadMatrix ?? loadMatrix;
  const writeMatrix = options._writeMatrix ?? ((m, p) => fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8'));
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');

  const matrix = await loadFn(cwd);
  if (!matrix) {
    logger.error('[migrate-outcomes] No compete matrix found. Run `danteforge compete --init` first.');
    throw new Error('No compete matrix found.');
  }

  const result: MigrateOutcomesResult = {
    synthetic: [], externalBenchmark: [], realUserPathCandidates: [], alreadyDeclared: [],
    totalOutcomes: 0, matrixPath, wrote: false,
  };

  let dirty = false;
  for (const dim of matrix.dimensions) {
    const outcomes = (dim as unknown as { outcomes?: Array<Record<string, unknown>> }).outcomes;
    if (!Array.isArray(outcomes)) continue;
    for (const outcome of outcomes) {
      result.totalOutcomes++;
      const id = `${dim.id}/${String(outcome.id ?? '?')}`;
      const c = classifyForMigration(outcome);
      switch (c.bucket) {
        case 'already':
          result.alreadyDeclared.push(id);
          break;
        case 'candidate':
          result.realUserPathCandidates.push(id);
          break;
        case 'synthetic':
        case 'external':
          if (write) { outcome.input_source = c.source; dirty = true; }
          (c.bucket === 'synthetic' ? result.synthetic : result.externalBenchmark).push(id);
          break;
      }
    }
  }

  if (write && dirty) {
    await writeMatrix(matrix, matrixPath);
    result.wrote = true;
  }

  printResult(result, write);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

function printResult(r: MigrateOutcomesResult, write: boolean): void {
  logger.info('');
  logger.success(`[migrate-outcomes] ${write ? '' : 'DRY RUN — '}${r.totalOutcomes} outcome(s) scanned`);
  logger.info(`  ✓ Already declared:            ${r.alreadyDeclared.length}`);
  logger.info(`  → synthetic-fixture (cap 7.0): ${r.synthetic.length}`);
  logger.info(`  → external-benchmark (9.5):    ${r.externalBenchmark.length}`);
  logger.warn(`  ⚠ real-user-path CANDIDATES:   ${r.realUserPathCandidates.length} (NOT auto-assigned — review each)`);
  if (r.realUserPathCandidates.length > 0) {
    logger.info('');
    logger.info('  These look like genuine CLI/runtime outcomes but cannot be auto-certified as');
    logger.info('  real-user-path (that would silently raise scores). To EARN 9.0 on one of these,');
    logger.info('  record a real product run that produces an observable artifact:');
    logger.info('    danteforge session-record <dim> --run "<real product cmd>" --callsite <file> --artifact <path> --write');
    logger.info('  then: danteforge validate <dim> (twice, across sessions). Candidates:');
    for (const id of r.realUserPathCandidates.slice(0, 25)) logger.info(`    • ${id}`);
    if (r.realUserPathCandidates.length > 25) logger.info(`    … and ${r.realUserPathCandidates.length - 25} more`);
  }
  if (!write) {
    logger.info('');
    logger.info('  Re-run with --write to apply the synthetic-fixture / external-benchmark annotations.');
    logger.info('  This migration can only lower or hold scores, never raise them.');
  }
}
