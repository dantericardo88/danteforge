// Matrix Kernel — Embedded mode CLI handlers (`embedded-complete <leaseId>`)
//
// Invoked by the host AI after it executes a Work Instruction Packet inline.
// Captures the diff (via `git diff --name-only` on the lease's worktree),
// updates the corresponding AgentRunResult in `matrix.agent-runs.json` so
// verify-court runs against real changes, and publishes a `merge_ready`
// mailbox message to broadcast completion.

import path from 'node:path';
import { spawn } from 'node:child_process';
import { logger } from '../../core/logger.js';

export interface EmbeddedCompleteOptions {
  cwd?: string;
  /** Override which paths count as "changed" — used by tests. */
  _filesChanged?: string[];
  /** Injection seam for the worktree diff command (tests). */
  _gitDiff?: (worktreePath: string) => Promise<string[]>;
  /** Skip the mailbox publish (tests). */
  _skipMailbox?: boolean;
}

export async function embeddedComplete(
  leaseId: string,
  options: EmbeddedCompleteOptions = {},
): Promise<{ leaseId: string; filesChanged: string[]; mailboxId?: string }> {
  const cwd = options.cwd ?? process.cwd();
  const { loadGraph, saveGraph } = await import('../../matrix/engines/matrix-state.js');
  const { appendMessage, writeMailboxIndex } = await import('../../matrix/engines/mailbox.js');

  // 1. Locate the lease.
  const leaseGraph = await loadGraph<{ leases: Array<{ id: string; workPacketId: string; worktreePath: string; status: string }> }>(cwd, 'leaseGraph');
  if (!leaseGraph) {
    throw new Error(`No leaseGraph found at ${cwd}. Run \`matrix-kernel run-wave\` first.`);
  }
  const lease = leaseGraph.leases.find(l => l.id === leaseId);
  if (!lease) {
    throw new Error(`Lease ${leaseId} not found in leaseGraph (${leaseGraph.leases.length} leases recorded).`);
  }

  // 2. Capture the diff.
  let filesChanged: string[];
  if (options._filesChanged) {
    filesChanged = options._filesChanged;
  } else if (options._gitDiff) {
    filesChanged = await options._gitDiff(lease.worktreePath);
  } else {
    filesChanged = await captureGitDiff(lease.worktreePath);
  }

  // 3. Update or append the AgentRunResult.
  const now = new Date().toISOString();
  const existing = (await loadGraph<{ runs: Array<{ runId: string; leaseId: string; status: string; filesChanged: string[]; completedAt?: string }> }>(cwd, 'agentRuns'))?.runs ?? [];
  const runIdx = existing.findIndex(r => r.leaseId === leaseId);
  const baseRun = {
    runId: `embedded-complete.${leaseId}.${Date.now()}`,
    leaseId,
    status: 'completed' as const,
    filesChanged,
    commandsExecuted: [],
    startedAt: existing[runIdx]?.completedAt ?? now,
    completedAt: now,
    provider: 'embedded',
    finalMessage: `Host AI completed embedded execution. ${filesChanged.length} file(s) changed.`,
  };
  if (runIdx >= 0) {
    existing[runIdx] = { ...existing[runIdx], ...baseRun };
  } else {
    existing.push(baseRun);
  }
  await saveGraph(cwd, 'agentRuns', { generatedAt: now, runs: existing });

  // 4. Mark the lease as completed.
  const updatedLeases = leaseGraph.leases.map(l =>
    l.id === leaseId ? { ...l, status: 'completed' as const, completedAt: now } : l,
  );
  await saveGraph(cwd, 'leaseGraph', { generatedAt: now, leases: updatedLeases });

  // 5. Publish mailbox broadcast.
  let mailboxId: string | undefined;
  if (!options._skipMailbox) {
    const msg = await appendMessage({
      cwd,
      type: 'merge_ready',
      fromLease: leaseId,
      toLease: 'broadcast',
      summary: `Embedded host completed lease ${leaseId} with ${filesChanged.length} file change(s). Verify-court can review.`,
      impact: filesChanged.length > 0 ? 'consumer_update_required' : 'informational',
      requiresAck: false,
      metadata: { workPacketId: lease.workPacketId, filesChanged },
    });
    mailboxId = msg.messageId;
    await writeMailboxIndex(cwd);
  }

  logger.success(`[matrix-kernel] Embedded run for ${leaseId} captured: ${filesChanged.length} file(s) changed.`);
  return { leaseId, filesChanged, mailboxId };
}

/** Run `git diff --name-only HEAD` inside the worktree. Returns empty list on any error. */
async function captureGitDiff(worktreePath: string): Promise<string[]> {
  return new Promise(resolve => {
    const child = spawn('git', ['diff', '--name-only', 'HEAD'], {
      cwd: worktreePath,
      shell: false,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.on('error', () => resolve([]));
    child.on('close', (code: number | null) => {
      if (code !== 0) {
        // Worktree may not exist yet — fall back to listing all files under
        // the worktree path that look like they were touched recently.
        resolve([]);
        return;
      }
      const files = stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      resolve(files.map(f => path.normalize(f)));
    });
  });
}
