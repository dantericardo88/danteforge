import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMMAND_CHECK_DIR = path.join('.danteforge', 'evidence', 'command-checks');

export type CommandCheckId = 'test' | 'build';
export type CommandCheckStatus = 'pass' | 'fail';
export type CommandCheckFreshnessReason =
  | 'missing_receipt'
  | 'command_mismatch'
  | 'git_unavailable'
  | 'git_sha_mismatch'
  | 'worktree_mismatch';

export interface CommandCheckReceipt {
  id: CommandCheckId;
  command: string;
  cwd: string;
  timestamp: string;
  status: CommandCheckStatus;
  gitSha: string | null;
  worktreeFingerprint: string | null;
  durationMs: number | null;
}

export interface CommandCheckReceiptFreshness {
  receipt: CommandCheckReceipt | null;
  freshReceipt: CommandCheckReceipt | null;
  reason: CommandCheckFreshnessReason | null;
}

export function getCommandCheckReceiptPath(id: CommandCheckId, cwd = process.cwd()): string {
  return path.join(cwd, COMMAND_CHECK_DIR, `${id}.json`);
}

export async function computeCommandCheckFingerprint(
  cwd = process.cwd(),
): Promise<{ gitSha: string | null; worktreeFingerprint: string | null }> {
  try {
    const { stdout: headOut } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd,
      timeout: 5000,
    });
    const gitSha = headOut.trim() || null;
    if (!gitSha) {
      return { gitSha: null, worktreeFingerprint: null };
    }

    const { stdout: statusOut } = await execFileAsync(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd,
        timeout: 5000,
      },
    );

    const worktreeFingerprint = crypto
      .createHash('sha256')
      .update(gitSha)
      .update('\n')
      .update(statusOut.replace(/\r\n/g, '\n'))
      .digest('hex');

    return { gitSha, worktreeFingerprint };
  } catch {
    return { gitSha: null, worktreeFingerprint: null };
  }
}

export async function readCommandCheckReceipt(
  id: CommandCheckId,
  cwd = process.cwd(),
): Promise<CommandCheckReceipt | null> {
  try {
    const raw = await fs.readFile(getCommandCheckReceiptPath(id, cwd), 'utf8');
    return JSON.parse(raw) as CommandCheckReceipt;
  } catch {
    return null;
  }
}

export async function writeCommandCheckReceipt(
  receipt: Omit<CommandCheckReceipt, 'timestamp' | 'gitSha' | 'worktreeFingerprint'> & {
    timestamp?: string;
    gitSha?: string | null;
    worktreeFingerprint?: string | null;
  },
  cwd = process.cwd(),
): Promise<CommandCheckReceipt> {
  const resolvedFingerprint = receipt.gitSha === undefined || receipt.worktreeFingerprint === undefined
    ? await computeCommandCheckFingerprint(cwd)
    : {
        gitSha: receipt.gitSha,
        worktreeFingerprint: receipt.worktreeFingerprint,
      };

  const normalizedReceipt: CommandCheckReceipt = {
    id: receipt.id,
    command: receipt.command,
    cwd,
    timestamp: receipt.timestamp ?? new Date().toISOString(),
    status: receipt.status,
    gitSha: resolvedFingerprint.gitSha,
    worktreeFingerprint: resolvedFingerprint.worktreeFingerprint,
    durationMs: receipt.durationMs ?? null,
  };

  const receiptPath = getCommandCheckReceiptPath(receipt.id, cwd);
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(receiptPath, JSON.stringify(normalizedReceipt, null, 2), 'utf8');
  return normalizedReceipt;
}

export async function readFreshCommandCheckReceipt(
  id: CommandCheckId,
  command: string,
  cwd = process.cwd(),
): Promise<CommandCheckReceipt | null> {
  const freshness = await inspectCommandCheckReceiptFreshness(id, command, cwd);
  return freshness.freshReceipt;
}

export async function inspectCommandCheckReceiptFreshness(
  id: CommandCheckId,
  command: string,
  cwd = process.cwd(),
): Promise<CommandCheckReceiptFreshness> {
  const receipt = await readCommandCheckReceipt(id, cwd);
  if (!receipt) {
    return {
      receipt: null,
      freshReceipt: null,
      reason: 'missing_receipt',
    };
  }

  if (receipt.command !== command) {
    return {
      receipt,
      freshReceipt: null,
      reason: 'command_mismatch',
    };
  }

  const currentFingerprint = await computeCommandCheckFingerprint(cwd);
  if (!currentFingerprint.gitSha || !currentFingerprint.worktreeFingerprint) {
    return {
      receipt,
      freshReceipt: null,
      reason: 'git_unavailable',
    };
  }

  if (receipt.gitSha !== currentFingerprint.gitSha) {
    return {
      receipt,
      freshReceipt: null,
      reason: 'git_sha_mismatch',
    };
  }

  if (receipt.worktreeFingerprint !== currentFingerprint.worktreeFingerprint) {
    return {
      receipt,
      freshReceipt: null,
      reason: 'worktree_mismatch',
    };
  }

  return {
    receipt,
    freshReceipt: receipt,
    reason: null,
  };
}
