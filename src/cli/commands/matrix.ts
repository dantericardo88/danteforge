import { logger } from '../../core/logger.js';
import {
  claimDimension,
  getMatrixStatus,
  mergeScoreProposals,
  runDimensionAscentCycle,
  writeScoreProposal,
  type MatrixMergePolicy,
} from '../../core/matrix-development-engine.js';

export interface MatrixCommandOptions {
  cwd?: string;
  top?: number;
  dimension?: string | number;
  agent?: string;
  score?: number;
  rationale?: string;
  evidence?: string | string[];
  policy?: MatrixMergePolicy;
  target?: number;
  maxCycles?: number;
}

function requireValue<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === '') throw new Error(`${name} is required.`);
  return value;
}

export async function matrixStatus(options: MatrixCommandOptions = {}): Promise<void> {
  const status = await getMatrixStatus({ cwd: options.cwd, top: options.top });
  logger.info(`Matrix: ${status.matrixPath}`);
  logger.info(`Overall self score: ${status.overallSelfScore}`);
  logger.info(`Matrix hash: ${status.matrixHash.slice(0, 12)}`);
  logger.info(`Next ${status.topDimensions.length} dimension(s):`);
  for (const dim of status.topDimensions) {
    const ceiling = dim.ceiling === undefined ? '' : ` ceiling=${dim.ceiling}`;
    logger.info(`${dim.number}. ${dim.id} (${dim.label}) self=${dim.score} priority=${dim.priority.toFixed(2)}${ceiling}`);
  }
}

export async function matrixClaim(options: MatrixCommandOptions): Promise<void> {
  const claim = await claimDimension({
    cwd: options.cwd,
    dimension: requireValue(options.dimension, '--dimension'),
    agent: requireValue(options.agent, '--agent'),
  });
  logger.success(`Claimed ${claim.dimensionId} for ${claim.agent}: ${claim.claimPath}`);
}

export async function matrixPropose(options: MatrixCommandOptions): Promise<void> {
  const proposal = await writeScoreProposal({
    cwd: options.cwd,
    dimension: requireValue(options.dimension, '--dimension'),
    score: requireValue(options.score, '--score'),
    agent: requireValue(options.agent, '--agent'),
    rationale: requireValue(options.rationale, '--rationale'),
    evidence: options.evidence,
  });
  logger.success(`Queued score proposal ${proposal.id}: ${proposal.proposalPath}`);
}

export async function matrixMerge(options: MatrixCommandOptions = {}): Promise<void> {
  const receipt = await mergeScoreProposals({
    cwd: options.cwd,
    policy: options.policy ?? 'harsh-min',
    agent: options.agent ?? 'matrix-cli',
  });
  logger.success(`Merged ${receipt.merged.length} dimension update(s): ${receipt.receiptPath}`);
  for (const item of receipt.merged) {
    logger.info(`- ${item.dimensionId}: ${item.before} -> ${item.after}`);
  }
}

export async function matrixAscend(options: MatrixCommandOptions): Promise<void> {
  const receipt = await runDimensionAscentCycle({
    cwd: options.cwd,
    dimension: requireValue(options.dimension, '--dimension'),
    agent: options.agent ?? 'matrix-ascend',
    score: requireValue(options.score, '--score'),
    rationale: requireValue(options.rationale, '--rationale'),
    evidence: options.evidence,
    policy: options.policy ?? 'harsh-min',
  });
  logger.success(`Matrix ascent cycle merged: ${receipt.receiptPath}`);
}
