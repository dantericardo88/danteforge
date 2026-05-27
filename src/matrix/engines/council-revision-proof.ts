import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  createTimeMachineCommit,
  type CreateTimeMachineCommitOptions,
} from '../../core/time-machine.js';

const execFileAsync = promisify(execFile);

export type RevisionConsensus = 'PASS' | 'FAIL' | 'SPLIT';

export interface RevisionProofCommandResult {
  command: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CouncilRevisionReceiptInput {
  dimensionId: string;
  runId: string;
  cycle: number;
  builderId: string;
  judgeIds: string[];
  consensusBefore: RevisionConsensus;
  consensusAfter: RevisionConsensus;
  scoreBefore: number | null;
  scoreAfter: number | null;
  targetScore: number;
  proofCommands: RevisionProofCommandResult[];
  preservedApprovals: string[];
  blockingConcerns: string[];
  changedFiles: string[];
  originalDiff: string;
  revisedDiff: string;
}

export interface CouncilRevisionFrontierReceipt {
  schemaVersion: 'danteforge.council-revision.frontier.v1';
  dimensionId: string;
  runId: string;
  cycle: number;
  builderId: string;
  judgeIds: string[];
  consensusBefore: RevisionConsensus;
  consensusAfter: RevisionConsensus;
  frontierMovement: {
    targetScore: number;
    scoreBefore: number | null;
    scoreAfter: number | null;
    gapToFrontierBefore: number | null;
    gapToFrontierAfter: number | null;
    improved: boolean;
  };
  capabilityTest: {
    passed: boolean;
    commandCount: number;
    failedCommands: string[];
  };
  proofCommands: RevisionProofCommandResult[];
  preservedApprovals: string[];
  blockingConcerns: string[];
  changedFiles: string[];
  originalDiffHash: string;
  revisedDiffHash: string;
  createdAt: string;
  timeMachineCommitId?: string;
}

export interface RecordCouncilRevisionReceiptOptions {
  cwd: string;
  receipt: CouncilRevisionReceiptInput;
  now?: () => string;
  _createTimeMachineCommit?: (options: CreateTimeMachineCommitOptions) => Promise<{ commitId: string }>;
}

export interface RecordCouncilRevisionReceiptResult {
  receipt: CouncilRevisionFrontierReceipt;
  receiptPath: string;
  timeMachineCommitId: string;
}

export async function runRevisionProofCommands(
  cwd: string,
  commands: string[],
): Promise<RevisionProofCommandResult[]> {
  const results: RevisionProofCommandResult[] = [];
  for (const command of commands) {
    const started = Date.now();
    try {
      const { stdout, stderr } = await execShell(command, cwd);
      results.push({
        command,
        passed: true,
        exitCode: 0,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    } catch (err) {
      const failure = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
      results.push({
        command,
        passed: false,
        exitCode: typeof failure.code === 'number' ? failure.code : 1,
        stdout: typeof failure.stdout === 'string' ? failure.stdout : '',
        stderr: typeof failure.stderr === 'string' ? failure.stderr : String(failure.message ?? err),
        durationMs: Date.now() - started,
      });
    }
  }
  return results;
}

export async function recordCouncilRevisionFrontierReceipt(
  options: RecordCouncilRevisionReceiptOptions,
): Promise<RecordCouncilRevisionReceiptResult> {
  const cwd = path.resolve(options.cwd);
  const createdAt = options.now?.() ?? new Date().toISOString();
  const receipt = buildReceipt(options.receipt, createdAt);
  const relativeReceiptPath = path.join(
    '.danteforge',
    'matrix',
    'council-revision-receipts',
    `${sanitizeSegment(receipt.runId)}-cycle-${receipt.cycle}.json`,
  );
  const receiptPath = path.join(cwd, relativeReceiptPath);

  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');

  const createCommit = options._createTimeMachineCommit ?? createTimeMachineCommit;
  const tm = await createCommit({
    cwd,
    paths: [relativeReceiptPath],
    label: `council-revision ${receipt.dimensionId} cycle ${receipt.cycle}: ${receipt.consensusBefore}->${receipt.consensusAfter}`,
    runId: receipt.runId,
    causalLinks: {
      materials: receipt.changedFiles,
      products: [relativeReceiptPath],
      outputProducts: [{ verdictId: receipt.runId, paths: [relativeReceiptPath] }],
    },
    now: options.now,
  });

  receipt.timeMachineCommitId = tm.commitId;
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { receipt, receiptPath, timeMachineCommitId: tm.commitId };
}

function buildReceipt(
  input: CouncilRevisionReceiptInput,
  createdAt: string,
): CouncilRevisionFrontierReceipt {
  const failedCommands = input.proofCommands
    .filter((result) => !result.passed)
    .map((result) => result.command);
  return {
    schemaVersion: 'danteforge.council-revision.frontier.v1',
    dimensionId: input.dimensionId,
    runId: input.runId,
    cycle: input.cycle,
    builderId: input.builderId,
    judgeIds: input.judgeIds,
    consensusBefore: input.consensusBefore,
    consensusAfter: input.consensusAfter,
    frontierMovement: {
      targetScore: input.targetScore,
      scoreBefore: input.scoreBefore,
      scoreAfter: input.scoreAfter,
      gapToFrontierBefore: scoreGap(input.scoreBefore, input.targetScore),
      gapToFrontierAfter: scoreGap(input.scoreAfter, input.targetScore),
      improved: hasImproved(input.scoreBefore, input.scoreAfter, input.consensusBefore, input.consensusAfter),
    },
    capabilityTest: {
      passed: input.proofCommands.length > 0 && failedCommands.length === 0,
      commandCount: input.proofCommands.length,
      failedCommands,
    },
    proofCommands: input.proofCommands,
    preservedApprovals: input.preservedApprovals,
    blockingConcerns: input.blockingConcerns,
    changedFiles: input.changedFiles,
    originalDiffHash: sha256(input.originalDiff),
    revisedDiffHash: sha256(input.revisedDiff),
    createdAt,
  };
}

async function execShell(command: string, cwd: string): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === 'win32') {
    return execFileAsync('powershell', ['-NoProfile', '-Command', command], {
      cwd,
      timeout: 120_000,
      maxBuffer: 1024 * 1024 * 8,
    });
  }
  return execFileAsync('/bin/sh', ['-lc', command], {
    cwd,
    timeout: 120_000,
    maxBuffer: 1024 * 1024 * 8,
  });
}

function scoreGap(score: number | null, target: number): number | null {
  return score === null ? null : Math.max(0, roundScore(target - score));
}

function hasImproved(
  before: number | null,
  after: number | null,
  consensusBefore: RevisionConsensus,
  consensusAfter: RevisionConsensus,
): boolean {
  if (consensusBefore !== 'PASS' && consensusAfter === 'PASS') return true;
  return before !== null && after !== null && after > before;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'revision';
}
