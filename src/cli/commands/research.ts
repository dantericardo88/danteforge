// research.ts — `danteforge research ...` command surface.
//
// Phase N-Q of docs/PRDs/autonomous-frontier-reaching.md. Three READ-ONLY
// subcommands (status, history, caps) plus two REFUSAL subcommands (resolve,
// replay) which surface a clear "Phase O orchestration not yet shipped" error
// to honor PRD invariant I7 (stop conditions are mandatory, not silently
// worked around).
//
// When Phase O parallel agent execution and Phase P synthesis ship in future
// sessions, the refusal subcommands become real handlers without changing
// the CLI shape.

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import {
  getPriorResearch,
  getResearchSummary,
  getStructuralCaps,
} from '../../matrix/research/research-history.js';

export interface ResearchCommandOptions {
  cwd?: string;
  json?: boolean;
}

// ── status ───────────────────────────────────────────────────────────────────

export async function runResearchStatus(opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const summary = await getResearchSummary(cwd);
  if (opts.json) {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold('Research status'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info(`  Total waves:       ${summary.totalWaves}`);
  logger.info(`  Promoted:          ${summary.byOutcome.promote}`);
  logger.info(`  Capped:            ${summary.byOutcome.cap} (${summary.capDims.length} dim(s))`);
  logger.info(`  Conflict pending:  ${summary.byOutcome.conflict}`);
  logger.info(`  In-progress:       ${summary.byOutcome['in-progress']}`);
  if (summary.totalWaves === 0) {
    logger.info('');
    logger.info(chalk.dim('No research waves have run yet. Phase O orchestration is not yet shipped — see docs/PRDs/autonomous-frontier-reaching.md section 6.'));
  }
}

// ── history <dimensionId> ────────────────────────────────────────────────────

export async function runResearchHistory(dimensionId: string, opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const waves = await getPriorResearch(cwd, dimensionId);
  if (opts.json) {
    process.stdout.write(JSON.stringify(waves, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold(`Research history — ${dimensionId}`));
  logger.info(chalk.dim('─'.repeat(60)));
  if (waves.length === 0) {
    logger.info(chalk.dim(`No prior research waves for "${dimensionId}".`));
    return;
  }
  for (const w of waves) {
    logger.info(`  ${chalk.cyan(w.waveId)}  ${chalk.bold(w.outcome ?? 'unknown')}  ${chalk.dim(w.startedAt)}`);
    if (w.reason) logger.info(`    ${chalk.dim(w.reason)}`);
  }
}

// ── caps ─────────────────────────────────────────────────────────────────────

export async function runResearchCaps(opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const caps = await getStructuralCaps(cwd);
  if (opts.json) {
    process.stdout.write(JSON.stringify(caps, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold('Structurally capped dimensions'));
  logger.info(chalk.dim('─'.repeat(60)));
  if (caps.length === 0) {
    logger.info(chalk.dim('No dims currently capped by research wave outcome.'));
    return;
  }
  for (const c of caps) {
    logger.info(`  ${chalk.yellow('▲')} ${chalk.bold(c.dimensionId)}`);
    logger.info(`    ${chalk.dim(c.reason)}`);
  }
}

// ── start <dim> — Phase O wave dispatch ─────────────────────────────────────

export interface ResearchStartOptions extends ResearchCommandOptions {
  /** Force activation even when criteria fail (audit-logged). */
  force?: boolean;
  /** Dispatch real Claude Code subprocesses instead of mocked agents. Consumes operator LLM quota. */
  realAgents?: boolean;
}

export async function runResearchStart(dimensionId: string, opts: ResearchStartOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const [{ runResearchWave }, { loadMatrix }, { computeDerivedScoreWithBreakdown }, { loadOutcomeEvidence }] = await Promise.all([
    import('../../matrix/research/wave-coordinator.js'),
    import('../../core/compete-matrix.js'),
    import('../../core/derived-score.js'),
    import('../../matrix/engines/outcome-runner.js'),
  ]);
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) throw new Error(`Dimension "${dimensionId}" not found in matrix.json`);

  const evidence = await loadOutcomeEvidence(cwd);
  const outcomes = ((dim as unknown as Record<string, unknown>)['outcomes'] as unknown[] | undefined) ?? [];
  const declaredCeiling = ((dim as unknown as Record<string, unknown>)['declared_ceiling'] as
    | 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6'
    | undefined) ?? 'T2';
  const derivedBreakdown = computeDerivedScoreWithBreakdown({
    id: dim.id,
    outcomes: outcomes as never,
    declared_ceiling: declaredCeiling,
    scores: dim.scores,
    legacy_score: dim.scores['self'],
  }, evidence);
  const projectComposite = matrix.overallSelfScore ?? 0;

  const result = await runResearchWave({
    dimensionId,
    cwd,
    activation: {
      projectComposite,
      dimDerivedScore: derivedBreakdown.score,
      achievedTier: derivedBreakdown.highestFullPassedTier,
      declaredCeiling,
      hasActiveDispensation: false,  // mode-selector caller computes this in production
      researchStatus: ((dim as unknown as Record<string, unknown>)['research_status'] as
        | import('../../matrix/research/types.js').ResearchStatus
        | undefined) ?? { research_waves_completed: 0, consecutive_stuck_waves: 0, last_wave_outcome: null },
    },
    ...(opts.force !== undefined ? { force: opts.force } : {}),
    ...(opts.realAgents !== undefined ? { useRealAgents: opts.realAgents } : {}),
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  logger.info('');
  logger.info(chalk.bold(`Research wave — ${dimensionId}`));
  logger.info(chalk.dim('─'.repeat(60)));
  if (result.refusalReason) {
    logger.warn(`  Refused: ${result.refusalReason}`);
    return;
  }
  logger.info(`  Wave id:     ${chalk.cyan(result.waveId)}`);
  logger.info(`  Wave dir:    ${chalk.dim(result.waveDir)}`);
  logger.info(`  Outcome:     ${chalk.bold(result.outcome ?? 'unknown')}`);
  if (result.reason) logger.info(`  Reason:      ${chalk.dim(result.reason)}`);
  logger.info(`  Agents:      ${result.agents.length}`);
  if (result.outcome === 'promote') {
    logger.info('');
    logger.info(chalk.green(`  Next: danteforge research resolve ${result.waveId}`));
  } else if (result.outcome === 'conflict') {
    logger.info('');
    logger.info(chalk.yellow(`  Next: write resolution to ${result.waveDir}/operator-resolution.md, then danteforge research resolve ${result.waveId}`));
  }
}

// ── resolve <wave-id> — operator commit ─────────────────────────────────────

export async function runResearchResolve(waveId: string, opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const waveDir = path.join(cwd, '.danteforge', 'research', waveId);

  // Read the synthesis recommendation
  let synthesis: string;
  try {
    synthesis = await fs.readFile(path.join(waveDir, 'synthesis-recommendation.md'), 'utf8');
  } catch {
    throw new Error(`research resolve: no synthesis-recommendation.md at ${waveDir}. Run \`danteforge research start <dim>\` first.`);
  }
  const verdictMatch = synthesis.match(/^##\s+Verdict:\s+(PROMOTE|CONFLICT|CAP)/im);
  const verdict = verdictMatch?.[1]?.toUpperCase();

  // If CONFLICT, require operator-resolution.md
  if (verdict === 'CONFLICT') {
    const resolutionPath = path.join(waveDir, 'operator-resolution.md');
    try {
      await fs.access(resolutionPath);
    } catch {
      throw new Error(
        `research resolve: wave ${waveId} ended in CONFLICT. ` +
        `Write your decision to ${resolutionPath} before running resolve.`,
      );
    }
  }

  // Read manifest to identify the target dim
  let manifest: { dimensionId?: string; council?: Array<{ id: string }> };
  try {
    manifest = JSON.parse(await fs.readFile(path.join(waveDir, 'manifest.json'), 'utf8'));
  } catch {
    manifest = {};
  }
  const dimensionId = manifest.dimensionId;

  // Phase P.4: when PROMOTE, append the promoted outcome to the dim's
  // outcomes[] in matrix.json. The promoted agent's capability_test.sh (if
  // present in their workdir) becomes the new outcome's command. When absent,
  // a fallback T3 production-usage-fresh outcome is added pointing at
  // the dim's existing required_callsite (if known).
  let promotedOutcomeAdded = false;
  let promotedOutcomeId: string | undefined;
  if (verdict === 'PROMOTE' && dimensionId) {
    const winnerMatch = synthesis.match(/Winning proposal[\s\S]*?Agent\*\*:\s*([\w-]+)/);
    const winnerAgentId = winnerMatch?.[1];
    if (winnerAgentId) {
      const result = await appendPromotedOutcomeToMatrix(cwd, dimensionId, waveDir, waveId, winnerAgentId);
      promotedOutcomeAdded = result.added;
      promotedOutcomeId = result.outcomeId;
    }
  }

  // Write resolution timestamp
  const resolvedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(waveDir, 'resolved-at.txt'),
    resolvedAt + '\n',
    'utf8',
  );

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      waveId, verdict, resolvedAt,
      ...(promotedOutcomeAdded ? { promotedOutcomeId } : {}),
    }, null, 2) + '\n');
    return;
  }
  logger.success(`Resolved wave ${waveId} (verdict: ${verdict ?? 'unknown'}) at ${resolvedAt}`);
  if (verdict === 'PROMOTE') {
    if (promotedOutcomeAdded) {
      logger.info(chalk.green(`  Promoted outcome ${promotedOutcomeId} appended to ${dimensionId}.outcomes`));
      logger.info(chalk.dim('  Substrate: re-run `danteforge outcomes --force-cold` to see the new outcome execute.'));
    } else {
      logger.info(chalk.dim('  Operator: land the proposal on a feature branch and run harden gate.'));
    }
  } else if (verdict === 'CAP') {
    logger.info(chalk.dim('  Substrate: dim is marked architecturally capped; excluded from future research.'));
  }
}

/**
 * Phase P.4: append a new outcome to the dim's outcomes[] array in matrix.json.
 * The new outcome is derived from the promoted agent's outputs:
 *   - If the agent wrote capability_test.sh, use it as a shell outcome
 *   - Otherwise, generate a production-usage-fresh outcome pointing at the
 *     dim's existing capability_callsite (if declared)
 * Returns {added, outcomeId} indicating what landed.
 */
async function appendPromotedOutcomeToMatrix(
  cwd: string,
  dimensionId: string,
  waveDir: string,
  waveId: string,
  winnerAgentId: string,
): Promise<{ added: boolean; outcomeId?: string }> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  let matrix: { dimensions: Array<Record<string, unknown>> };
  try {
    const raw = await fs.readFile(matrixPath, 'utf8');
    matrix = JSON.parse(raw);
  } catch {
    return { added: false };
  }
  const dim = matrix.dimensions.find(d => d['id'] === dimensionId);
  if (!dim) return { added: false };

  const outcomeId = `promoted_${waveId.replace(/^wave_/, '').slice(0, 12)}_${winnerAgentId.slice(0, 16)}`;
  const existing = (dim['outcomes'] as Array<{ id: string }> | undefined) ?? [];
  if (existing.some(o => o.id === outcomeId)) return { added: false, outcomeId };

  // Look for the agent's capability_test.sh
  let outcome: Record<string, unknown> | null = null;
  try {
    const testPath = path.join(waveDir, winnerAgentId, 'capability_test.sh');
    await fs.access(testPath);
    outcome = {
      id: outcomeId,
      tier: 'T3',
      kind: 'shell',
      description: `Promoted from wave ${waveId} (agent: ${winnerAgentId})`,
      command: `bash ${path.relative(cwd, testPath).replace(/\\/g, '/')} 2>&1`,
    };
  } catch {
    // No capability_test.sh — fall back to production-usage-fresh on existing callsite.
    const callsite = (dim['capability_callsite'] as { file?: string } | undefined)?.file;
    if (callsite) {
      outcome = {
        id: outcomeId,
        tier: 'T3',
        kind: 'production-usage-fresh',
        description: `Promoted from wave ${waveId} (production-usage-fresh on ${callsite})`,
        required_callsite: callsite,
        freshnessDays: 30,
      };
    }
  }

  if (!outcome) return { added: false };

  const updatedOutcomes = [...existing, outcome];
  dim['outcomes'] = updatedOutcomes;
  await fs.writeFile(matrixPath, JSON.stringify(matrix, null, 2));
  return { added: true, outcomeId };
}

// ── replay <wave-id> — re-run synthesis on existing artifacts ───────────────

export async function runResearchReplay(waveId: string, opts: ResearchCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const waveDir = path.join(cwd, '.danteforge', 'research', waveId);

  // Read manifest to get the council role ids
  let manifest: { council?: Array<{ id: string }>; dimensionId?: string };
  try {
    const raw = await fs.readFile(path.join(waveDir, 'manifest.json'), 'utf8');
    manifest = JSON.parse(raw);
  } catch {
    throw new Error(`research replay: no manifest at ${waveDir}/manifest.json`);
  }

  const { runDeterministicSynthesis } = await import('../../matrix/research/synthesis-runner.js');
  const roleIds = (manifest.council ?? []).map(r => r.id);
  const result = await runDeterministicSynthesis({ waveDir, roleIds });

  // Overwrite synthesis-recommendation.md with the fresh result
  await fs.writeFile(path.join(waveDir, 'synthesis-recommendation.md'), result.markdown, 'utf8');

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  logger.success(`Replayed synthesis for wave ${waveId} → ${result.outcome}`);
  logger.info(chalk.dim(`  ${result.reason}`));
}
