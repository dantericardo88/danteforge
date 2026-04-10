// PDSE Snapshot — writes .danteforge/latest-pdse.json for VS Code status bar polling
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ScoreResult } from './pdse.js';
import type { ScoredArtifact, AutoforgeDecision } from './pdse-config.js';
import type { ToolchainMetrics } from './pdse-toolchain.js';

export interface PdseSnapshot {
  timestamp: string;
  avgScore: number;
  scores: Record<ScoredArtifact, { score: number; decision: AutoforgeDecision }>;
  toolchainMetrics?: ToolchainMetrics;
}

export const PDSE_SNAPSHOT_FILE = '.danteforge/latest-pdse.json';

export type WriteFileFn = (p: string, c: string) => Promise<void>;
export type MkdirFn = (p: string, opts?: { recursive?: boolean }) => Promise<void>;

export type RegisterProjectFn = (
  projectPath: string,
  snapshot: { avgScore: number; scores: Record<string, { score: number }> },
) => Promise<void>;

/**
 * Write a PDSE snapshot to .danteforge/latest-pdse.json.
 * Used by the VS Code extension status bar to display the current score.
 * Also auto-registers the project in ~/.danteforge/projects.json (best-effort).
 * Never throws.
 */
export async function writePdseSnapshot(
  scores: Record<ScoredArtifact, ScoreResult>,
  cwd: string,
  opts?: {
    _writeFile?: WriteFileFn;
    _mkdir?: MkdirFn;
    toolchainMetrics?: ToolchainMetrics;
    _registerProject?: RegisterProjectFn;
    skipRegistration?: boolean;
  },
): Promise<void> {
  const writeFile = opts?._writeFile ?? ((p, c) => fs.writeFile(p, c, 'utf8'));
  const mkdir = opts?._mkdir ?? ((p, o) => fs.mkdir(p, o).then(() => {}).catch(() => {}));

  try {
    const snapshotScores = {} as Record<ScoredArtifact, { score: number; decision: AutoforgeDecision }>;
    let total = 0;
    let count = 0;
    for (const [artifact, result] of Object.entries(scores)) {
      snapshotScores[artifact as ScoredArtifact] = {
        score: result.score,
        decision: result.autoforgeDecision,
      };
      total += result.score;
      count++;
    }

    const avgScore = count > 0 ? Math.round(total / count) : 0;
    const snapshot: PdseSnapshot = {
      timestamp: new Date().toISOString(),
      avgScore,
      scores: snapshotScores,
      ...(opts?.toolchainMetrics ? { toolchainMetrics: opts.toolchainMetrics } : {}),
    };

    const filePath = path.join(cwd, PDSE_SNAPSHOT_FILE);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(snapshot, null, 2));

    // Auto-register in global project registry (best-effort)
    if (!opts?.skipRegistration) {
      try {
        const registerFn = opts?._registerProject ?? (async (p, s) => {
          const { registerProject } = await import('./project-registry.js');
          await registerProject(p, s);
        });
        await registerFn(cwd, { avgScore, scores: snapshotScores });
      } catch { /* registration failure is non-fatal */ }
    }
  } catch {
    // Non-fatal — status bar will just not update
  }
}
