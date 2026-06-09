// capability-test-audit.ts — `danteforge capability-test audit` — classify every dim's yardstick so
// the autonomous loop knows which metrics are REAL vs self-fulfilling stubs it must re-author.

import fs from 'node:fs';
import path from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import {
  auditAllCapabilityTests, summarizeYardsticks, type YardstickAudit, type YardstickVerdict,
} from '../../matrix/engines/capability-test-integrity.js';

export interface CapabilityTestAuditOptions {
  project?: string;
  json?: boolean;
  /** Only print dims whose yardstick needs authoring (the autonomous loop's setup worklist). */
  needsAuthoringOnly?: boolean;
}

export interface CapabilityTestAuditResult {
  audits: YardstickAudit[];
  summary: Record<YardstickVerdict, number>;
  needsAuthoring: number;
}

const ICON: Record<YardstickVerdict, string> = {
  REAL_PRODUCT_PROBE: '✓', REAL_TEST: '✓', STRUCTURAL_ONLY: '▴', SELF_FULFILLING_STUB: '✗', SCAFFOLD: '·', NONE: '·',
};

export async function runCapabilityTestAudit(options: CapabilityTestAuditOptions = {}): Promise<CapabilityTestAuditResult> {
  const cwd = path.resolve(options.project ?? process.cwd());
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  const universeDir = path.join(cwd, '.danteforge', 'compete', 'universe');
  const hasLadder = (dimId: string): boolean => {
    try { return fs.readFileSync(path.join(universeDir, `${dimId}.md`), 'utf8').search(/##\s*Score Ladder/i) >= 0; }
    catch { return false; }
  };

  const audits = await auditAllCapabilityTests(matrix as unknown as Parameters<typeof auditAllCapabilityTests>[0], cwd, hasLadder);
  const summary = summarizeYardsticks(audits);
  const needsAuthoring = audits.filter(a => a.needsAuthoring).length;
  const result: CapabilityTestAuditResult = { audits, summary, needsAuthoring };

  if (options.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result; }

  logger.info('');
  logger.success(`Capability-test (yardstick) audit — ${audits.length} dimension(s)`);
  logger.info(`  REAL_PRODUCT_PROBE ${summary.REAL_PRODUCT_PROBE}  ·  REAL_TEST ${summary.REAL_TEST}  ·  STRUCTURAL_ONLY ${summary.STRUCTURAL_ONLY}  ·  SELF_FULFILLING_STUB ${summary.SELF_FULFILLING_STUB}  ·  SCAFFOLD ${summary.SCAFFOLD}  ·  NONE ${summary.NONE}`);
  logger.info('');
  const shown = options.needsAuthoringOnly ? audits.filter(a => a.needsAuthoring) : audits;
  for (const a of shown) {
    const ladder = a.hasLadder ? '' : ' [no Score Ladder]';
    logger.info(`  ${ICON[a.verdict]} ${a.dimId.padEnd(40)} ${a.verdict}${ladder}`);
  }
  if (needsAuthoring > 0) {
    logger.info('');
    logger.warn(`  ${needsAuthoring} dim(s) have a fake/missing yardstick the autonomous loop must RE-AUTHOR before it can build them honestly.`);
    logger.info('  A SELF_FULFILLING_STUB always passes, so the loop would no-op against it — it is SETUP WORK, not a passing metric.');
  }
  return result;
}
