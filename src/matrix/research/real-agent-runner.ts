// real-agent-runner.ts — Phase O production agent dispatch.
//
// Wires the wave-coordinator's `_runAgent` injection seam to the substrate's
// existing `spawnHeadlessAgent` infrastructure (subprocess invocation of the
// `claude` CLI). When the operator passes `--real-agents` to
// `danteforge research start`, real LLM-driven agent runs replace the
// mocked-by-default fixture path.
//
// SAFETY: real agent runs consume operator LLM quota. The wave-coordinator
// logs a loud warning before each wave when real agents are enabled. Default
// remains mocked.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { spawnHeadlessAgent, isClaudeCliAvailable } from '../../core/headless-spawner.js';
import type { HeadlessAgentConfig } from '../../core/headless-spawner.js';
import type { AgentRole } from '../../core/subagent-isolator.js';
import type { RunAgentFn, RunAgentInput, RunAgentResult } from './wave-coordinator.js';

export interface CreateRealAgentRunnerOptions {
  /** Model identifier passed to the claude CLI. Default: omitted (CLI default). */
  model?: string;
  /** Per-agent dollar budget. Default: 0.50 USD. */
  maxBudgetUsd?: number;
  /** Allowed MCP tools per agent. Default includes DanteForge search MCP tools. */
  allowedTools?: string[];
  /** Injection seam for tests — replaces spawnHeadlessAgent. */
  _spawnAgent?: typeof spawnHeadlessAgent;
}

/**
 * Build a `RunAgentFn` that dispatches each role as a real Claude Code subprocess.
 *
 * Per role: loads the prompt template, invokes the CLI, writes the response
 * text to `<workdir>/agent-output.md`. The role's required outputs
 * (findings.md, hypothesis.md, etc) are produced BY the agent during its run,
 * provided the prompt template instructs the agent to write them.
 */
export function createRealAgentRunner(options: CreateRealAgentRunnerOptions = {}): RunAgentFn {
  const allowedTools = options.allowedTools ?? [
    'Read',
    'Glob',
    'Grep',
    'mcp__danteforge__search_find_pattern',
    'mcp__danteforge__search_find_symbol',
    'mcp__danteforge__search_find_imports',
    'mcp__danteforge__research_get_history',
  ];
  const spawnFn = options._spawnAgent ?? spawnHeadlessAgent;
  const maxBudgetUsd = options.maxBudgetUsd ?? 0.50;

  return async function runRealAgent(input: RunAgentInput): Promise<RunAgentResult> {
    const start = Date.now();

    // Verify claude CLI is on PATH before attempting to spawn — fail fast
    // with a clear message instead of a confusing subprocess error.
    if (!(await isClaudeCliAvailable())) {
      await fs.mkdir(input.workdir, { recursive: true });
      await fs.writeFile(
        path.join(input.workdir, 'agent-error.md'),
        `# Real-agent run failed\n\nThe \`claude\` CLI is not on PATH. Install Claude Code or remove --real-agents.\n`,
        'utf8',
      );
      return {
        roleId: input.roleId,
        exitCode: 127,
        durationMs: Date.now() - start,
        producedRequiredOutputs: false,
        outputDir: input.workdir,
      };
    }

    await fs.mkdir(input.workdir, { recursive: true });

    // Compose the full prompt: role template + workdir context.
    const fullPrompt = `${input.prompt}\n\n` +
      `# Wave context\n\n` +
      `- Wave id: ${input.waveId}\n` +
      `- Dimension: ${input.dimensionId}\n` +
      `- Your workdir (write all outputs here): ${input.workdir}\n` +
      `- Wall-clock budget: ${input.timeBudgetMs / 60_000} minutes\n` +
      `- Shared wave context: ${path.dirname(input.workdir)}/shared/\n\n` +
      `Write your required outputs to your workdir per the prompt schema above. Do not modify files outside the workdir.\n`;

    const config: HeadlessAgentConfig = {
      // The headless spawner's AgentRole enum is fixed. We cast our research
      // role id to satisfy the type; it's only used for logging.
      role: (input.roleId as unknown) as AgentRole,
      prompt: fullPrompt,
      timeoutMs: input.timeBudgetMs,
      maxBudgetUsd,
      allowedTools,
      cwd: input.workdir,
      ...(options.model ? { model: options.model } : {}),
    };

    try {
      const result = await spawnFn(config, { fallbackToApi: false });
      // Write the agent's final text response for forensic access.
      try {
        await fs.writeFile(
          path.join(input.workdir, 'agent-output.md'),
          `# Agent output — ${input.roleId}\n\n` +
          `Exit code: ${result.exitCode}\n` +
          `Duration: ${result.durationMs}ms\n` +
          (result.tokenUsage
            ? `Tokens: in=${result.tokenUsage.input} out=${result.tokenUsage.output} cost=$${result.tokenUsage.cost.toFixed(4)}\n`
            : '') +
          `\n## Response\n\n${result.stdout || '(no stdout)'}\n` +
          (result.stderr ? `\n## Stderr\n\n${result.stderr}\n` : ''),
          'utf8',
        );
      } catch { /* best-effort */ }

      // The role's required outputs (findings.md etc) should have been
      // written by the agent itself. We don't verify content here; the
      // synthesis runner reads the role's output directory and consumes
      // whatever exists.
      return {
        roleId: input.roleId,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        producedRequiredOutputs: result.exitCode === 0,
        outputDir: input.workdir,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[real-agent-runner] ${input.roleId} failed: ${msg}`);
      try {
        await fs.writeFile(
          path.join(input.workdir, 'agent-error.md'),
          `# Real-agent spawn failed\n\n${msg}\n`,
          'utf8',
        );
      } catch { /* best-effort */ }
      return {
        roleId: input.roleId,
        exitCode: 1,
        durationMs: Date.now() - start,
        producedRequiredOutputs: false,
        outputDir: input.workdir,
      };
    }
  };
}
