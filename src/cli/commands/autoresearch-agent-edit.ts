// autoresearch-agent-edit.ts — Tier 2 edit strategy: dispatch a REAL coding agent to make the change.
//
// The lightweight JSON-hypothesis path (autoresearch-hypothesis.ts) is blind — it edits without
// reading, so it hallucinates wrong-language / wrong-location files that can never pass the test. The
// high-quality path is to hand the job to a coding agent (Claude Code / Codex) that has native
// Read/Edit/Bash tools: it reads the real code, runs the measurement command itself, and edits with
// grounding. We reuse the Matrix adapter layer that harden-crusade / matrixdev already use — the
// ClaudeCodeAdapter spawns the `claude` CLI in the project, then validates every changed file against
// the lease's allowedWritePaths and reverts anything that violated it. That write-path lease is the
// inverse of the forbidden-target guard, so the yardstick scripts are protected at two layers.

import { logger } from '../../core/logger.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import { CodexAdapter } from '../../matrix/adapters/codex-adapter.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';
import type { AgentAdapter } from '../../matrix/adapters/adapter-interface.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';
import type { AutoResearchConfig, ExperimentResult } from '../../core/autoresearch-engine.js';
import { formatResultsTsv } from '../../core/autoresearch-engine.js';

export interface AgentEditResult {
  description: string;
  ranOk: boolean;
  rejectReason?: string;
}

/** Build the coding-agent adapter to use, or null if neither CLI is installed/authenticated. */
export async function resolveEditAdapter(workPacket: WorkPacket): Promise<AgentAdapter | null> {
  const claude = new ClaudeCodeAdapter({ workPacket, skipPermissions: true });
  if (await claude.isAvailable()) return claude;
  const codex = new CodexAdapter({ workPacket });
  if (await codex.isAvailable()) return codex;
  return null;
}

/** True when a coding-agent CLI is available to drive the high-quality edit path. */
export async function isAgentEditAvailable(): Promise<boolean> {
  return (await resolveEditAdapter(makeWorkPacket('probe', 'probe', 0, [], []))) !== null;
}

function makeWorkPacket(goal: string, objective: string, experimentId: number, forbidden: string[], required: string[]): WorkPacket {
  return {
    id: `autoresearch.${experimentId}`,
    dimensionId: `autoresearch:${goal}`.slice(0, 60),
    objective,
    acceptanceCriteria: ['The measurement command improves (lower is better) without editing the yardstick.'],
    proof: { proofRequired: required },
    globalForbidden: ['dist/**', 'node_modules/**', '.danteforge/**', ...forbidden],
    context: { mode: 'autoresearch-experiment' },
  } as unknown as WorkPacket;
}

// Field names MUST match what the adapter actually reads — `id` (runId / leaseId) and
// `allowedReadPaths` (prompt). The de-sloppify lease used `agentId`/`readOnlyPaths` and crashed the
// ClaudeCodeAdapter with "Cannot read properties of undefined (reading 'join')" (DanteCode). Mirror the
// canonical council makeLease shape instead.
function makeWriteLease(cwd: string, forbidden: string[]): AgentLease {
  return {
    id: `autoresearch-lease.${Date.now()}`,
    worktreePath: cwd,
    allowedWritePaths: ['src/**', 'tests/**', 'lib/**', 'scripts/**', 'packages/**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: ['.danteforge/**', 'dist/**', 'node_modules/**', ...forbidden],
  } as unknown as AgentLease;
}

/**
 * Dispatch a coding agent to make one experiment's edit. `forbiddenRel` are the project-relative
 * yardstick paths (the measurement command's own scripts) the agent must not touch — enforced both in
 * the prompt and as the lease's forbiddenPaths. Returns whether the agent ran; the caller measures the
 * result and discovers the actual changed files via git (so a misbehaving agent can't misreport them).
 */
export async function dispatchAgentEdit(
  config: AutoResearchConfig,
  experimentId: number,
  forbiddenRel: string[],
  previousResults: ExperimentResult[],
  runAdapterFn: typeof runAdapter = runAdapter,
  resolveAdapterFn: typeof resolveEditAdapter = resolveEditAdapter,
): Promise<AgentEditResult> {
  const description = `agent experiment ${experimentId}: improve "${config.metric}"`;
  const history = previousResults.length > 0 ? `\n\nPrior experiments (metric — lower is better):\n${formatResultsTsv(previousResults)}` : '';
  const forbiddenList = forbiddenRel.length > 0 ? `\n\nYou MUST NOT edit these files (they are the yardstick — editing them is cheating):\n${forbiddenRel.map(f => `- ${f}`).join('\n')}` : '';
  const objective = `Goal: ${config.goal}
Metric: ${config.metric} (lower is better; for a pass/fail capability_test, drive the exit code to 0).
Measurement command: ${config.measurementCommand}

Make ONE small, surgical, REAL improvement to the source code so the measurement command yields a better value. Read the relevant files first; do not guess. Run the measurement command yourself to confirm before finishing. Do not write stubs, mocks, or TODOs.${forbiddenList}${history}`;

  const workPacket = makeWorkPacket(config.goal, objective, experimentId, forbiddenRel, [config.measurementCommand]);
  const adapter = await resolveAdapterFn(workPacket);
  if (!adapter) return { description, ranOk: false, rejectReason: 'no coding-agent CLI available (claude/codex)' };

  const lease = makeWriteLease(config.cwd, forbiddenRel);
  try {
    const result = await runAdapterFn(adapter, { lease, cwd: config.cwd });
    void result;
    logger.info(`[autoresearch] agent (${adapter.id}) finished experiment ${experimentId}.`);
    return { description: `${description} via ${adapter.id}`, ranOk: true };
  } catch (err) {
    return { description, ranOk: false, rejectReason: `agent dispatch failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
