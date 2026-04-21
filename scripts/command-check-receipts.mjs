import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const COMMAND_CHECK_DIR = path.join('.danteforge', 'evidence', 'command-checks');

async function computeCommandCheckFingerprint(cwd = process.cwd()) {
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

function getCommandCheckReceiptPath(id, cwd = process.cwd()) {
  return path.join(cwd, COMMAND_CHECK_DIR, `${id}.json`);
}

export async function writeCommandCheckReceipt(
  {
    id,
    command,
    status,
    durationMs = null,
    timestamp = new Date().toISOString(),
  },
  cwd = process.cwd(),
) {
  const { gitSha, worktreeFingerprint } = await computeCommandCheckFingerprint(cwd);
  const receipt = {
    id,
    command,
    cwd,
    timestamp,
    status,
    gitSha,
    worktreeFingerprint,
    durationMs,
  };

  const receiptPath = getCommandCheckReceiptPath(id, cwd);
  await fs.mkdir(path.dirname(receiptPath), { recursive: true });
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  return receipt;
}
