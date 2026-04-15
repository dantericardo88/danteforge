// Outcome Check — re-measures quality scores N days after pattern adoption
// to provide lagging indicator validation for causal attribution.

import { logger } from '../../core/logger.js';
import { loadAttributionLog, saveAttributionLog, type AttributionLog } from '../../core/causal-attribution.js';
import { loadConvergence } from '../../core/convergence.js';
import { addRefusedPattern, type RefusedPattern } from '../../core/refused-patterns.js';

/** AttributionRecord extended with optional outcome fields written by outcome-check. */
interface AttributionRecordWithOutcome {
  patternName: string;
  sourceRepo: string;
  adoptedAt: string;
  preAdoptionScore: number;
  postAdoptionScore: number;
  scoreDelta: number;
  verifyStatus: 'pass' | 'fail' | 'rejected';
  filesModified: string[];
  gitSha?: string;
  /** Short statement describing which dimension this pattern was expected to affect. */
  outcomeHypothesis?: string;
  outcomeCheckedAt?: string;
  laggingDelta?: number;
  /** Whether the outcomeHypothesis was validated (true), falsified (false), or absent (undefined). */
  hypothesisValidated?: boolean;
}

export interface OutcomeCheckOptions {
  cwd?: string;
  /** Days threshold for checking outcomes (default: 7) */
  daysThreshold?: number;
  _loadAttributionLog?: (cwd?: string) => Promise<AttributionLog>;
  _saveAttributionLog?: (log: AttributionLog, cwd?: string) => Promise<void>;
  _loadConvergence?: (cwd?: string) => Promise<any>;
  /** Inject for testing — skips writing to refused-patterns.json */
  _addRefusedPattern?: (entry: RefusedPattern, cwd?: string) => Promise<void>;
}

export interface OutcomeCheckResult {
  patternsChecked: number;
  improved: number;
  regressed: number;
  neutral: number;
  avgDelta7Day: number;
  hypothesesValidated: number;
  hypothesesFalsified: number;
}

export async function runOutcomeCheck(opts: OutcomeCheckOptions = {}): Promise<OutcomeCheckResult> {
  const cwd = opts.cwd;
  const daysThreshold = opts.daysThreshold ?? 7;

  const loadLog = opts._loadAttributionLog ?? loadAttributionLog;
  const saveLog = opts._saveAttributionLog ?? saveAttributionLog;
  const loadConv = opts._loadConvergence ?? loadConvergence;
  const refusePattern = opts._addRefusedPattern ?? addRefusedPattern;

  const log = await loadLog(cwd);
  const convergence = await loadConv(cwd).catch(() => null);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysThreshold);

  // Find patterns adopted more than daysThreshold days ago that don't yet have outcome data
  const eligibleRecords = (log.records as AttributionRecordWithOutcome[]).filter(r =>
    r.verifyStatus === 'pass' &&
    new Date(r.adoptedAt) < cutoffDate &&
    !r.outcomeCheckedAt,
  );

  if (eligibleRecords.length === 0) {
    logger.info('[outcome-check] No patterns ready for outcome check');
    return { patternsChecked: 0, improved: 0, regressed: 0, neutral: 0, avgDelta7Day: 0, hypothesesValidated: 0, hypothesesFalsified: 0 };
  }

  // Get current dimension scores
  const currentScores: Record<string, number> = {};
  for (const dim of convergence?.dimensions ?? []) {
    currentScores[dim.dimension] = dim.score;
  }

  let improved = 0, regressed = 0, neutral = 0;
  let hypothesesValidated = 0, hypothesesFalsified = 0;
  let totalDelta = 0;

  for (const record of eligibleRecords) {
    const currentAvg = Object.values(currentScores).reduce((a: number, b: number) => a + b, 0) / Math.max(1, Object.keys(currentScores).length);
    const laggingDelta = currentAvg - record.postAdoptionScore;

    if (laggingDelta > 0.1) improved++;
    else if (laggingDelta < -0.1) regressed++;
    else neutral++;

    totalDelta += laggingDelta;

    // Mark as checked (using the extended type — these fields are persisted to attribution-log.json)
    record.outcomeCheckedAt = new Date().toISOString();
    record.laggingDelta = laggingDelta;

    // Validate hypothesis if one was recorded at adoption time
    if (record.outcomeHypothesis) {
      record.hypothesisValidated = laggingDelta > 0;
      if (record.hypothesisValidated) {
        hypothesesValidated++;
      } else {
        hypothesesFalsified++;
        // Falsified pattern → add to refused list so it is never re-adopted
        await refusePattern({
          patternName: record.patternName,
          sourceRepo: record.sourceRepo,
          refusedAt: new Date().toISOString(),
          reason: 'hypothesis-falsified',
          hypothesis: record.outcomeHypothesis,
          laggingDelta,
        }, cwd).catch(() => { /* best-effort */ });
        logger.info(`[outcome-check] Pattern "${record.patternName}" added to refused list (hypothesis falsified)`);
      }
      const verdict = record.hypothesisValidated ? 'VALIDATED' : 'FALSIFIED';
      logger.info(`[outcome-check] Hypothesis ${verdict}: "${record.outcomeHypothesis}"`);
    }

    logger.info(`[outcome-check] ${record.patternName}: ${record.scoreDelta > 0 ? '+' : ''}${record.scoreDelta.toFixed(2)} immediate, ${laggingDelta > 0 ? '+' : ''}${laggingDelta.toFixed(2)} lagging (${daysThreshold}-day)`);
  }

  // Save updated log
  await saveLog(log, cwd);

  const result: OutcomeCheckResult = {
    patternsChecked: eligibleRecords.length,
    improved,
    regressed,
    neutral,
    avgDelta7Day: eligibleRecords.length > 0 ? totalDelta / eligibleRecords.length : 0,
    hypothesesValidated,
    hypothesesFalsified,
  };

  logger.info(`[outcome-check] Results: ${improved} improved, ${neutral} neutral, ${regressed} regressed`);
  logger.info(`[outcome-check] Average ${daysThreshold}-day delta: ${result.avgDelta7Day.toFixed(2)}`);

  return result;
}
