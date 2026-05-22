// checkpointer.ts — Work-packet checkpoint/resume for Matrix Kernel.
// Closes the multi_agent_orchestration gap vs LangGraph (-1.0):
// LangGraph has durable graph execution with checkpointing; DanteForge now does too.
//
// When a work-packet is interrupted (timeout, crash, lease expiry), the last
// completed milestone is written here. On resume the agent skips already-done
// milestones instead of restarting from scratch.

import fs from 'node:fs/promises';
import path from 'node:path';
import { withFileLock } from '../../core/sanitize-locks.js';
import { MATRIX_DIR } from '../types/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkPacketMilestone {
  id: string;
  label: string;
  completedAt: string;
  artifacts: string[];
}

export interface WorkPacketCheckpoint {
  packetId: string;
  dimensionId: string;
  agentProvider: string;
  startedAt: string;
  updatedAt: string;
  /** Milestones completed so far. */
  completedMilestones: WorkPacketMilestone[];
  /** SHA of last commit produced by this packet, if any. */
  lastCommitSha?: string;
  /** Human-readable summary of where the agent got to. */
  progressSummary: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

function checkpointDir(cwd: string): string {
  return path.join(cwd, MATRIX_DIR, 'checkpoints');
}

function checkpointPath(cwd: string, packetId: string): string {
  return path.join(checkpointDir(cwd), `${packetId}.json`);
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Load an existing checkpoint, or undefined if none exists. */
export async function loadCheckpoint(
  packetId: string,
  cwd: string,
): Promise<WorkPacketCheckpoint | undefined> {
  try {
    const raw = await fs.readFile(checkpointPath(cwd, packetId), 'utf8');
    return JSON.parse(raw) as WorkPacketCheckpoint;
  } catch {
    return undefined;
  }
}

/** Write or update a checkpoint atomically. */
export async function saveCheckpoint(
  checkpoint: WorkPacketCheckpoint,
  cwd: string,
): Promise<void> {
  const dir = checkpointDir(cwd);
  await fs.mkdir(dir, { recursive: true });
  const filePath = checkpointPath(cwd, checkpoint.packetId);
  await withFileLock({ cwd, filePath: path.relative(cwd, filePath), lockDir: path.join(MATRIX_DIR, 'locks') }, async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({ ...checkpoint, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  });
}

/** Record one completed milestone, creating the checkpoint if it doesn't exist. */
export async function recordMilestone(
  packetId: string,
  dimensionId: string,
  milestone: Omit<WorkPacketMilestone, 'completedAt'>,
  opts: { cwd: string; agentProvider?: string; lastCommitSha?: string; progressSummary?: string },
): Promise<WorkPacketCheckpoint> {
  const existing = await loadCheckpoint(packetId, opts.cwd);
  const now = new Date().toISOString();
  const updated: WorkPacketCheckpoint = {
    packetId,
    dimensionId,
    agentProvider: opts.agentProvider ?? existing?.agentProvider ?? 'unknown',
    startedAt: existing?.startedAt ?? now,
    updatedAt: now,
    completedMilestones: [
      ...(existing?.completedMilestones ?? []),
      { ...milestone, completedAt: now },
    ],
    lastCommitSha: opts.lastCommitSha ?? existing?.lastCommitSha,
    progressSummary: opts.progressSummary ?? existing?.progressSummary ?? '',
  };
  await saveCheckpoint(updated, opts.cwd);
  return updated;
}

/** Delete a checkpoint once the work packet has fully completed or been abandoned. */
export async function clearCheckpoint(packetId: string, cwd: string): Promise<void> {
  try {
    await fs.unlink(checkpointPath(cwd, packetId));
  } catch {
    // Already gone — fine.
  }
}

/** List all in-progress packet checkpoints. */
export async function listCheckpoints(cwd: string): Promise<WorkPacketCheckpoint[]> {
  const dir = checkpointDir(cwd);
  try {
    const entries = await fs.readdir(dir);
    const results: WorkPacketCheckpoint[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), 'utf8');
        results.push(JSON.parse(raw) as WorkPacketCheckpoint);
      } catch {
        /* skip corrupt files */
      }
    }
    return results.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  } catch {
    return [];
  }
}

/** Returns milestone IDs already completed, so the agent can skip them. */
export function completedMilestoneIds(checkpoint: WorkPacketCheckpoint | undefined): Set<string> {
  return new Set((checkpoint?.completedMilestones ?? []).map(m => m.id));
}
