// autoresearch — Karpathy-style autonomous metric-driven optimization loop
// Fully autonomous once started. Plan, rewrite, execute, evaluate, keep winners, repeat.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import {
  runBaseline,
  runExperiment,
  shouldKeep,
  formatReport,
  formatResultsTsv,
  type AutoResearchConfig,
  type ExperimentResult,
  type AutoResearchReport,
} from '../../core/autoresearch-engine.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  git, gitIsDirty, gitCurrentHash, gitCreateBranch, gitUntracked, rollbackExperiment,
  snapshotUntracked, restoreDeletedUntracked, gitCommitPaths, gitChangedFiles, type GitFn,
} from './autoresearch-git.js';
import { collectForbiddenTargets, forbiddenTargetReason, checkEditParses } from './autoresearch-integrity.js';
import { generateHypothesis, applyHypothesis, type CallLLMFn } from './autoresearch-hypothesis.js';
import { isAgentEditAvailable, dispatchAgentEdit } from './autoresearch-agent-edit.js';
import { setupWorktree, teardownWorktree, defaultWorktreeDeps, type IsolatedSession } from './autoresearch-worktree.js';

// ── Noise margins per spec ────────────────────────────────────────────────────

const TIMING_KEYWORDS = ['ms', 'millisecond', 'second', 'latency', 'time', 'duration', 'startup'];
const TIMING_NOISE_MARGIN = 0.01;   // 1%
const OTHER_NOISE_MARGIN  = 0.005;  // 0.5%

export function resolveNoiseMargin(metric: string): number {
  const lower = metric.toLowerCase();
  return TIMING_KEYWORDS.some(kw => lower.includes(kw))
    ? TIMING_NOISE_MARGIN
    : OTHER_NOISE_MARGIN;
}

// ── Slug helper ───────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ── Insight generation ───────────────────────────────────────────────────────

async function generateInsights(
  config: AutoResearchConfig,
  experiments: ExperimentResult[],
  baseline: number,
  final: number,
  callLLMFn: CallLLMFn = callLLM,
  isLLMAvailableFn: () => Promise<boolean> = isLLMAvailable,
): Promise<string[]> {
  const llmAvailable = await isLLMAvailableFn();
  if (!llmAvailable || experiments.length === 0) {
    return buildFallbackInsights(experiments, baseline, final);
  }

  const prompt = `You completed an autoresearch optimization run.

Goal: ${config.goal}
Metric: ${config.metric}
Baseline: ${baseline}
Final: ${final}
Improvement: ${((baseline - final) / Math.abs(baseline) * 100).toFixed(2)}%

Full experiment log:
${formatResultsTsv(experiments)}

Summarize the key insights in 3-5 bullet points:
- What patterns worked?
- What patterns failed?
- What should future runs try?
- Any surprising results?

Respond with a plain list, one insight per line, starting each line with "- ".`;

  try {
    const response = await callLLMFn(prompt, undefined, {
      enrichContext: false,
      cwd: config.cwd,
    });
    const insights = response
      .split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 0);
    return insights.length > 0 ? insights : buildFallbackInsights(experiments, baseline, final);
  } catch {
    return buildFallbackInsights(experiments, baseline, final);
  }
}

export function buildFallbackInsights(
  experiments: ExperimentResult[],
  baseline: number,
  final: number,
): string[] {
  const kept = experiments.filter(e => e.status === 'keep');
  const crashed = experiments.filter(e => e.status === 'crash');
  const insights: string[] = [];

  if (experiments.length === 0) {
    insights.push('No experiments were run.');
    return insights;
  }

  const improvementPct = baseline !== 0
    ? ((baseline - final) / Math.abs(baseline) * 100).toFixed(2)
    : '0.00';
  insights.push(`Metric moved from ${baseline} to ${final} (${improvementPct}% change).`);

  if (kept.length > 0) {
    insights.push(`${kept.length} of ${experiments.length} experiments improved the metric and were kept.`);
  } else {
    insights.push('No experiments improved the metric — consider a broader search or a different measurement strategy.');
  }

  if (crashed.length > 0) {
    insights.push(`${crashed.length} experiment(s) crashed — review error logs for systemic issues.`);
  }

  insights.push('Review the winning experiments in the git log and the full results log above.');

  return insights;
}

// ── Prompt mode output ─────────────────────────────────────────────────────────

export function buildPromptModeOutput(
  goal: string,
  metric: string,
  timeBudgetMinutes: number,
  measurementCommand: string,
): string {
  const lines: string[] = [
    '# AutoResearch — Copy-Paste Prompt',
    '',
    'Paste this into your LLM interface to run autoresearch manually.',
    '',
    '---',
    '',
    `**Goal**: ${goal}`,
    `**Metric**: ${metric}`,
    `**Time budget**: ${timeBudgetMinutes} minutes`,
    `**Measurement command**: \`${measurementCommand}\``,
    '',
    '## Instructions for the Agent',
    '',
    '1. Run the measurement command to establish a baseline.',
    '2. Analyze the codebase and generate a hypothesis for improving the metric.',
    '3. Apply a small, surgical code change.',
    '4. Run the measurement command again.',
    '5. If the metric improved beyond noise (>1% for timing, >0.5% otherwise), commit it and continue.',
    '6. If not, revert the change with `git reset --hard` and try a different hypothesis.',
    '7. Repeat until time runs out.',
    '8. Produce AUTORESEARCH_REPORT.md at the project root.',
    '',
    'Do NOT stop to ask the human for input. You are fully autonomous.',
  ];
  return lines.join('\n');
}

// ── Main command ───────────────────────────────────────────────────────────────

export interface AutoResearchOpts {
  _loadState?: (opts?: { cwd?: string }) => Promise<import('../../core/state.js').DanteState>;
  _saveState?: (state: import('../../core/state.js').DanteState, opts?: { cwd?: string }) => Promise<void>;
  _isLLMAvailable?: () => Promise<boolean>;
  _callLLM?: CallLLMFn;
  _runBaseline?: (config: AutoResearchConfig) => Promise<number>;
  _runExperiment?: (config: AutoResearchConfig, id: number, desc: string) => Promise<ExperimentResult>;
  _git?: GitFn;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _appendFile?: (p: string, content: string) => Promise<void>;
  _readFile?: (p: string) => Promise<string>;
  _sleep?: (ms: number) => Promise<void>;
  _now?: () => number;
  /** Force/skip the coding-agent edit path (defaults to auto-detecting an installed claude/codex CLI). */
  _isAgentEditAvailable?: () => Promise<boolean>;
  _dispatchAgentEdit?: typeof dispatchAgentEdit;
  _setupWorktree?: typeof setupWorktree;
  _teardownWorktree?: typeof teardownWorktree;
}

async function handlePromptModeExit(
  goal: string, metric: string, timeBudgetMinutes: number, displayMeasurementCommand: string, cwd: string,
  loadStateFn: (opts?: { cwd?: string }) => Promise<import('../../core/state.js').DanteState>,
  saveStateFn: (state: import('../../core/state.js').DanteState, opts?: { cwd?: string }) => Promise<void>,
): Promise<void> {
  const promptText = buildPromptModeOutput(goal, metric, timeBudgetMinutes, displayMeasurementCommand);
  logger.success('=== COPY-PASTE PROMPT (start) ===');
  process.stdout.write('\n' + promptText + '\n\n');
  logger.success('=== COPY-PASTE PROMPT (end) ===');
  logger.info('');
  logger.info('Paste this into your LLM interface to run autoresearch manually.');
  const state = await loadStateFn({ cwd });
  state.auditLog.push(`${new Date().toISOString()} | autoresearch: prompt mode — goal: ${goal}`);
  await saveStateFn(state, { cwd });
}

async function handleDryRunExit(
  goal: string, timeBudgetMinutes: number, displayMeasurementCommand: string, cwd: string,
  loadStateFn: (opts?: { cwd?: string }) => Promise<import('../../core/state.js').DanteState>,
  saveStateFn: (state: import('../../core/state.js').DanteState, opts?: { cwd?: string }) => Promise<void>,
): Promise<void> {
  logger.info('--- Dry Run Plan ---');
  logger.info(`1. Create branch: autoresearch/${slugify(goal)}`);
  logger.info(`2. Run baseline: ${displayMeasurementCommand}`);
  logger.info(`3. Enter experiment loop for ${timeBudgetMinutes} minutes`);
  logger.info('4. On each iteration: generate hypothesis -> apply change -> measure -> keep/discard');
  logger.info('5. Write AUTORESEARCH_REPORT.md when time expires');
  logger.info('--- Dry Run Complete (no commands executed) ---');
  const state = await loadStateFn({ cwd });
  state.auditLog.push(`${new Date().toISOString()} | autoresearch: dry-run — goal: ${goal}`);
  await saveStateFn(state, { cwd });
}

async function initExperimentSetup(
  goal: string, config: AutoResearchConfig, cwd: string,
  gitFn: GitFn, runBaselineFn: (c: AutoResearchConfig) => Promise<number>,
  isLLMAvailableFn: () => Promise<boolean>,
  writeFileFn: (p: string, c: string) => Promise<void>,
  useAgent: boolean,
  branchOverride?: string,
): Promise<{ branchName: string; baseline: number; allExperiments: ExperimentResult[]; bestValue: number; bestHash: string; tsvPath: string } | null> {
  // In isolated mode the worktree is already checked out on its own branch — don't create another.
  const branchName = branchOverride ?? `autoresearch/${slugify(goal)}`;
  if (branchOverride) {
    logger.info(`Isolated worktree branch: ${branchName}`);
  } else {
    logger.info(`Creating branch: ${branchName}`);
    try { await gitCreateBranch(branchName, cwd, gitFn); } catch (err) {
      logger.error(`Failed to create branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Continuing on current branch.');
    }
  }
  logger.info('Running baseline measurement...');
  let baseline: number;
  try {
    baseline = await runBaselineFn(config);
    logger.success(`Baseline established at ${baseline}`);
  } catch (err) {
    logger.error(`Baseline measurement failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error('Cannot start autoresearch without a working measurement command.');
    process.exitCode = 1;
    return null;
  }
  const baselineResult: ExperimentResult = { id: 0, description: 'unmodified baseline', metricValue: baseline, status: 'keep' };
  const allExperiments: ExperimentResult[] = [baselineResult];
  const bestHash = await gitCurrentHash(cwd, gitFn).catch(() => '');
  // Write artifacts UNDER .danteforge/ (untracked) — never the tracked repo root. A tracked
  // results.tsv at the root dirties the working tree, and the per-dim `git checkout` (or a switch to
  // an existing autoresearch branch) then fails "local changes to results.tsv would be overwritten"
  // and --loop retries forever (DanteAgents). An untracked artifact never blocks a checkout.
  const artifactDir = path.join(cwd, '.danteforge', 'autoresearch');
  await fs.mkdir(artifactDir, { recursive: true }).catch(() => { /* best-effort */ });
  const tsvPath = path.join(artifactDir, 'results.tsv');
  await writeTsv(tsvPath, [baselineResult], writeFileFn);
  logger.info(`Beginning experiment loop. Time budget: ${config.timeBudgetMinutes} minutes.`);
  logger.info('');
  // The JSON-hypothesis path needs a configured LLM provider (Ollama/API). The coding-agent path does
  // NOT — it drives the claude/codex CLI's own auth — so don't abort agent runs for a missing provider
  // (DanteSecurity: agent path aborted "No LLM available" despite both CLIs installed and no Ollama).
  if (!useAgent) {
    const llmOk = await isLLMAvailableFn();
    if (!llmOk) {
      logger.error('No LLM available — cannot generate hypotheses.');
      logger.error('Fix: set ANTHROPIC_API_KEY, or start Ollama, run with --prompt, or install a claude/codex CLI for the agent path.');
      process.exitCode = 1;
      return null;
    }
  }
  return { branchName, baseline, allExperiments, bestValue: baseline, bestHash, tsvPath };
}

interface LoopDeps {
  callLLMFn: CallLLMFn;
  readFileFn: (p: string) => Promise<string>;
  runExperimentFn: (c: AutoResearchConfig, id: number, desc: string) => Promise<ExperimentResult>;
  gitFn: GitFn;
  isLLMAvailableFn: () => Promise<boolean>;
  appendFileFn: (p: string, c: string) => Promise<void>;
  nowFn: () => number;
  sleepFn: (ms: number) => Promise<void>;
  /** When true, drive the high-quality coding-agent edit path instead of the JSON-hypothesis path. */
  useAgent: boolean;
  dispatchAgentEditFn: typeof dispatchAgentEdit;
}

/** Produce the edit for one experiment — agent path or JSON path. Returns the changed files + reason. */
async function performEdit(
  config: AutoResearchConfig, experimentId: number, allExperiments: ExperimentResult[],
  rejectionNotes: string[], forbiddenTargets: string[], forbiddenRel: string[], cwd: string, deps: LoopDeps,
): Promise<{ description: string; rejectReason?: string } | null> {
  if (deps.useAgent) {
    const ae = await deps.dispatchAgentEditFn(config, experimentId, forbiddenRel, allExperiments);
    return { description: ae.description, rejectReason: ae.ranOk ? undefined : (ae.rejectReason ?? 'agent did not run') };
  }
  let hypothesis;
  try {
    hypothesis = await generateHypothesis(config, experimentId, allExperiments, rejectionNotes, deps.callLLMFn, deps.readFileFn);
    logger.info(`Hypothesis: ${hypothesis.description}`);
  } catch (err) { logger.warn(`Hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}`); return null; }
  // Fast reject before writing: never even attempt to edit the yardstick.
  if (hypothesis.fileToChange) {
    const forbidden = forbiddenTargetReason(hypothesis.fileToChange, cwd, forbiddenTargets);
    if (forbidden) return { description: hypothesis.description, rejectReason: `${hypothesis.fileToChange} is ${forbidden}` };
  }
  const apply = await applyHypothesis(hypothesis, cwd);
  return { description: hypothesis.description, rejectReason: apply.applied ? undefined : (apply.rejectReason ?? 'could not apply hypothesis') };
}

async function runExperimentLoop(
  config: AutoResearchConfig, allExperiments: ExperimentResult[], initialBestValue: number, initialBestHash: string,
  tsvPath: string, noiseMargin: number, startTime: number, budgetMs: number, cwd: string, deps: LoopDeps,
): Promise<{ bestValue: number; bestHash: string }> {
  const { runExperimentFn, gitFn, isLLMAvailableFn, appendFileFn, nowFn, sleepFn } = deps;
  let bestValue = initialBestValue;
  let bestHash = initialBestHash;
  let experimentId = 1;
  let consecutiveLLMFailures = 0;
  const MAX_LLM_FAILURES = 5;
  // The scripts the measurement command runs are the yardstick — an experiment may never edit them.
  const forbiddenTargets = collectForbiddenTargets(config.measurementCommand, cwd);
  const forbiddenRel = forbiddenTargets.map(f => path.relative(cwd, f).split(path.sep).join('/'));
  const rejectionNotes: string[] = []; // fed back to the model so it stops repeating a bad move
  // Back up the user's pre-existing untracked files ONCE — the agent may delete them and reset can't
  // restore them. This set is stable across the run (kept files get committed, discarded ones cleaned).
  const baselineBackup = await snapshotUntracked(cwd, await gitUntracked(cwd, gitFn));

  // Full rollback = revert tracked + clean only what the experiment created + restore any pre-existing
  // untracked file the agent deleted.
  const doRollback = async (preHash: string, preUntracked: Set<string>): Promise<void> => {
    await rollbackExperiment(preHash, preUntracked, cwd, gitFn);
    await restoreDeletedUntracked(cwd, baselineBackup);
  };

  const reject = async (id: number, description: string, preHash: string, preUntracked: Set<string>, why: string): Promise<void> => {
    logger.warn(`Rejecting experiment ${id}: ${why}. Rolling back.`);
    rejectionNotes.push(why);
    await doRollback(preHash, preUntracked);
    const r: ExperimentResult = { id, description, metricValue: null, status: 'discard' };
    allExperiments.push(r); await appendTsv(tsvPath, r, appendFileFn);
  };
  const crash = async (id: number, description: string, preHash: string, preUntracked: Set<string>): Promise<void> => {
    await doRollback(preHash, preUntracked);
    const r: ExperimentResult = { id, description, metricValue: null, status: 'crash' };
    allExperiments.push(r); await appendTsv(tsvPath, r, appendFileFn);
  };

  while (nowFn() - startTime < budgetMs) {
    if (budgetMs - (nowFn() - startTime) < 90_000) { logger.info('Time budget nearly exhausted — stopping experiment loop.'); break; }
    // Only the JSON path needs the configured LLM provider; the agent path uses the CLI's own auth.
    if (!deps.useAgent) {
      const llmOk = await isLLMAvailableFn();
      if (!llmOk) {
        consecutiveLLMFailures++;
        if (consecutiveLLMFailures >= MAX_LLM_FAILURES) { logger.error(`LLM unavailable for ${MAX_LLM_FAILURES} consecutive checks — stopping experiment loop.`); break; }
        logger.warn(`LLM temporarily unavailable (${consecutiveLLMFailures}/${MAX_LLM_FAILURES}). Retrying in 30s...`);
        await sleepFn(30_000); continue;
      }
      consecutiveLLMFailures = 0;
    }
    logger.info(`--- Experiment ${experimentId} (${deps.useAgent ? 'agent' : 'json'}) ---`);
    const preExperimentHash = await gitCurrentHash(cwd, gitFn).catch(() => '');
    // Snapshot untracked files NOW so rollback only removes what this experiment creates (never the
    // user's pre-existing untracked files — the --allow-dirty collateral DanteCode hit).
    const preUntracked = await gitUntracked(cwd, gitFn);

    // Wrap edit→guard→measure so ANY throw rolls the tree fully back instead of leaving a half-edit.
    let result: ExperimentResult;
    let changedFiles: string[] = [];
    try {
      const edit = await performEdit(config, experimentId, allExperiments, rejectionNotes, forbiddenTargets, forbiddenRel, cwd, deps);
      if (!edit) { experimentId++; continue; } // hypothesis generation failed — skip cleanly
      if (edit.rejectReason) { await reject(experimentId, edit.description, preExperimentHash, preUntracked, edit.rejectReason); experimentId++; continue; }

      // Guard what ACTUALLY changed (mode-agnostic). Forbidden yardstick edits and syntactically broken
      // files are refused before the metric is ever trusted — a broken test can score "better".
      changedFiles = await gitChangedFiles(cwd, gitFn);
      let guardReject: string | undefined;
      for (const f of changedFiles) {
        const forb = forbiddenTargetReason(f, cwd, forbiddenTargets);
        if (forb) { guardReject = `changed file ${f} is ${forb}`; break; }
        const pe = await checkEditParses(f, cwd);
        if (pe) { guardReject = `edit left ${f} broken (${pe})`; break; }
      }
      if (guardReject) { await reject(experimentId, edit.description, preExperimentHash, preUntracked, guardReject); experimentId++; continue; }

      result = await runExperimentFn(config, experimentId, edit.description);
      result = { ...result, description: edit.description };
    } catch (err) {
      logger.warn(`Experiment ${experimentId} threw — rolling back: ${err instanceof Error ? err.message : String(err)}`);
      await crash(experimentId, `experiment ${experimentId}`, preExperimentHash, preUntracked); experimentId++; continue;
    }

    if (result.status !== 'crash' && result.metricValue !== null) {
      result = { ...result, status: shouldKeep(result.metricValue, bestValue, noiseMargin) ? 'keep' : 'discard' };
    }
    if (result.status === 'keep' && result.metricValue !== null) {
      try {
        const prevBest = bestValue;
        // Commit ONLY the experiment's own paths — never the user's pre-existing untracked files.
        const toStage = changedFiles.filter(f => !preUntracked.has(f));
        const hash = await gitCommitPaths(`experiment: ${result.description}`, toStage, cwd, gitFn);
        result = { ...result, commitHash: hash };
        bestValue = result.metricValue!; bestHash = hash;
        logger.success(`Kept! New best: ${bestValue} (was ${prevBest}). Commit: ${hash.slice(0, 8)}`);
        // The agent may have deleted a pre-existing untracked file even on a kept experiment — undo that.
        await restoreDeletedUntracked(cwd, baselineBackup);
      } catch (err) { logger.warn(`Commit failed: ${err instanceof Error ? err.message : String(err)}`); }
    } else {
      const reasonText = result.status === 'crash' ? 'crashed' : 'did not improve metric';
      logger.info(`Discarding (${reasonText}). Rolling back to ${preExperimentHash.slice(0, 8)}.`);
      await doRollback(preExperimentHash, preUntracked);
    }
    allExperiments.push(result); await appendTsv(tsvPath, result, appendFileFn);
    experimentId++;
  }
  return { bestValue, bestHash };
}

async function generateAndWriteReport(
  goal: string, metric: string, config: AutoResearchConfig, allExperiments: ExperimentResult[],
  baseline: number, bestValue: number, branchName: string, tsvPath: string,
  startTime: number, nowFn: () => number,
  callLLMFn: CallLLMFn, isLLMAvailableFn: () => Promise<boolean>,
  writeFileFn: (p: string, c: string) => Promise<void>,
  loadStateFn: (opts?: { cwd?: string }) => Promise<import('../../core/state.js').DanteState>,
  saveStateFn: (state: import('../../core/state.js').DanteState, opts?: { cwd?: string }) => Promise<void>,
  cwd: string,
): Promise<void> {
  const durationMs = nowFn() - startTime;
  const durationStr = formatDuration(durationMs);
  const kept = allExperiments.filter(e => e.status === 'keep' && e.id > 0).length;
  const discarded = allExperiments.filter(e => e.status === 'discard').length;
  const crashed = allExperiments.filter(e => e.status === 'crash').length;
  const improvement = baseline - bestValue;
  const improvementPercent = baseline !== 0 ? (improvement / Math.abs(baseline)) * 100 : 0;
  const nonBaselineExperiments = allExperiments.filter(e => e.id > 0);
  const insights = await generateInsights(config, nonBaselineExperiments, baseline, bestValue, callLLMFn, isLLMAvailableFn);
  const report: AutoResearchReport = { goal, metric, duration: durationStr, baseline, final: bestValue, improvement, improvementPercent, experiments: nonBaselineExperiments, kept, discarded, crashed, insights };
  // Under .danteforge/ (untracked) — same reason as results.tsv: never dirty the tracked tree.
  const reportDir = path.join(cwd, '.danteforge', 'autoresearch');
  await fs.mkdir(reportDir, { recursive: true }).catch(() => { /* best-effort */ });
  const reportPath = path.join(reportDir, 'AUTORESEARCH_REPORT.md');
  await writeFileFn(reportPath, formatReport(report));
  const state = await loadStateFn({ cwd });
  state.auditLog.push(`${new Date().toISOString()} | autoresearch: complete — goal: ${goal}, metric: ${metric}, experiments: ${nonBaselineExperiments.length}, kept: ${kept}, improvement: ${improvementPercent.toFixed(2)}%`);
  await saveStateFn(state, { cwd });
  logger.info('');
  logger.success('='.repeat(60));
  logger.success('  AUTORESEARCH COMPLETE');
  logger.success('='.repeat(60));
  logger.info('');
  logger.info(`Duration:    ${durationStr}`);
  logger.info(`Experiments: ${nonBaselineExperiments.length}`);
  logger.info(`Kept:        ${kept}  |  Discarded: ${discarded}  |  Crashed: ${crashed}`);
  logger.info(`Baseline:    ${baseline}`);
  logger.info(`Final:       ${bestValue}`);
  logger.info(`Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)} (${improvementPercent >= 0 ? '+' : ''}${improvementPercent.toFixed(2)}%)`);
  logger.info('');
  logger.success(`Report written to: ${reportPath}`);
  logger.info(`Results log:       ${tsvPath}`);
  logger.info(`Branch:            ${branchName}`);
  logger.info('');
  logger.info('Run `danteforge verify` to validate the final state.');
}

export async function autoResearch(
  goal: string,
  options: {
    metric?: string;
    time?: string;
    measurementCommand?: string;
    prompt?: boolean;
    dryRun?: boolean;
    allowDirty?: boolean;
    /** Skip the coding-agent edit path and use the lightweight JSON-hypothesis path even if a CLI exists. */
    noAgent?: boolean;
    /** REQUIRE the capable coding-agent builder. If no claude/codex CLI is available, fail FAST with an
     *  honest operational signal instead of silently degrading to the JSON-hypothesis/Ollama path (which
     *  stalls on a missing provider). Set by the autonomous build loop — real capability building must
     *  never fall back to a blind text-only path. */
    requireAgent?: boolean;
    /** Run every experiment in an isolated git worktree so the user's tree is never touched. */
    isolate?: boolean;
    /** The measurement is a pass/fail capability_test — use its exit code as the metric and ignore
     *  any number it prints (set by dim-dispatch when wiring a dim's capability_test). */
    exitCodeMetric?: boolean;
  } = {},
  _opts: AutoResearchOpts = {},
): Promise<void> {
  return withErrorBoundary('autoresearch', async () => {
  const metric = options.metric ?? 'metric value';
  const timeBudgetMinutes = parseTimeBudget(options.time ?? '4h');
  const cwd = process.cwd();

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'autoresearch: autonomous research', context: { cwd }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }
  const loadStateFn = _opts._loadState ?? loadState;
  const saveStateFn = _opts._saveState ?? saveState;
  const isLLMAvailableFn = _opts._isLLMAvailable ?? isLLMAvailable;
  const callLLMFn: CallLLMFn = _opts._callLLM ?? callLLM;
  const runBaselineFn = _opts._runBaseline ?? runBaseline;
  const runExperimentFn = _opts._runExperiment ?? runExperiment;
  const gitFn: GitFn = _opts._git ?? git;
  const writeFileFn = _opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const appendFileFn = _opts._appendFile ?? ((p: string, c: string) => fs.appendFile(p, c, 'utf8'));
  const readFileFn = _opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const sleepFn = _opts._sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const nowFn = _opts._now ?? (() => Date.now());
  const isAgentEditAvailableFn = _opts._isAgentEditAvailable ?? isAgentEditAvailable;
  const dispatchAgentEditFn = _opts._dispatchAgentEdit ?? dispatchAgentEdit;

  const measurementCommand = options.measurementCommand ?? deriveMeasurementCommand(metric);
  const displayMeasurementCommand = measurementCommand ?? '<provide --measurement-command>';

  logger.success('DanteForge AutoResearch — Autonomous Optimization Loop');
  logger.info('');
  logger.info(`Goal:    ${goal}`);
  logger.info(`Metric:  ${metric}`);
  logger.info(`Budget:  ${timeBudgetMinutes} minutes`);
  logger.info(`Command: ${displayMeasurementCommand}`);
  logger.info('');

  if (options.prompt) { await handlePromptModeExit(goal, metric, timeBudgetMinutes, displayMeasurementCommand, cwd, loadStateFn, saveStateFn); return; }
  if (options.dryRun) { await handleDryRunExit(goal, timeBudgetMinutes, displayMeasurementCommand, cwd, loadStateFn, saveStateFn); return; }

  if (!measurementCommand) {
    logger.error('AutoResearch needs an explicit measurement command for unknown metrics.');
    logger.error('Provide --measurement-command "<command>" or choose a supported metric like "bundle size KB".');
    process.exitCode = 1; return;
  }
  // Isolated mode never touches the user's tree (experiments run in a worktree off HEAD), so the
  // dirty-tree refusal — and the --allow-dirty escape hatch — are irrelevant there.
  if (!options.isolate && !options.allowDirty && await gitIsDirty(cwd, gitFn)) {
    logger.error('AutoResearch refuses to run on a dirty working tree.');
    logger.error('Commit or stash first, rerun with --allow-dirty, or use --isolate to run in a clean worktree.');
    process.exitCode = 1; return;
  }

  // Decide the edit strategy BEFORE setup so the LLM-provider gate can be skipped in agent mode.
  const useAgent = !options.noAgent && await isAgentEditAvailableFn();
  // --require-agent: real capability building must use the CAPABLE coding agent (claude/codex), which
  // drives the CLI's own auth and needs no configured LLM provider. It must NEVER silently degrade to the
  // JSON-hypothesis path, which depends on callLLM -> Ollama and stalls (exit 127) when none is configured
  // — the "set-and-forget loop hangs forever" failure. When no agent is available, fail FAST and HONESTLY
  // (exit 2 = a fixable environment ceiling: install/auth claude or codex), not a silent blind fallback.
  if (options.requireAgent && !useAgent) {
    logger.error('AutoResearch --require-agent: no capable coding-agent CLI (claude/codex) is available.');
    logger.error('The autonomous build loop will NOT fall back to the JSON-hypothesis/Ollama path for real');
    logger.error('capability work. Fix the environment: install + authenticate `claude` or `codex`.');
    process.exitCode = 2;
    return;
  }
  logger.info(`Edit strategy: ${useAgent ? 'coding agent (claude/codex)' : 'JSON hypothesis (lightweight)'}`);

  // Isolation: run every experiment in a fresh worktree off HEAD so the agent's shell can never touch
  // the user's checkout (the durable fix for the whole collateral class). execCwd is where git/measure/
  // agent run; artifacts are copied back to the user's tree on teardown.
  let session: IsolatedSession | null = null;
  let execCwd = cwd;
  let branchOverride: string | undefined;
  if (options.isolate) {
    const stamp = nowFn();
    const slug = slugify(goal);
    session = await (_opts._setupWorktree ?? setupWorktree)(cwd, `autoresearch-${slug}-${stamp}`, `autoresearch/${slug}-${stamp}`, defaultWorktreeDeps());
    if (!session) { process.exitCode = 1; return; }
    execCwd = session.worktreePath;
    branchOverride = session.branch;
    logger.info(`Isolated: experiments run in ${execCwd} (branch ${session.branch}); your tree is untouched.`);
  }

  try {
    const config: AutoResearchConfig = { goal, metric, timeBudgetMinutes, measurementCommand, cwd: execCwd, exitCodeMetric: options.exitCodeMetric ?? false };
    const noiseMargin = resolveNoiseMargin(metric);
    const startTime = nowFn();
    const budgetMs = timeBudgetMinutes * 60 * 1000;

    const setup = await initExperimentSetup(goal, config, execCwd, gitFn, runBaselineFn, isLLMAvailableFn, writeFileFn, useAgent, branchOverride);
    if (!setup) return;
    const { branchName, baseline, allExperiments, bestValue: initBest, bestHash: initHash, tsvPath } = setup;

    const { bestValue } = await runExperimentLoop(
      config, allExperiments, initBest, initHash, tsvPath, noiseMargin, startTime, budgetMs, execCwd,
      { callLLMFn, readFileFn, runExperimentFn, gitFn, isLLMAvailableFn, appendFileFn, nowFn, sleepFn, useAgent, dispatchAgentEditFn },
    );

    await generateAndWriteReport(goal, metric, config, allExperiments, baseline, bestValue, branchName, tsvPath, startTime, nowFn, callLLMFn, isLLMAvailableFn, writeFileFn, loadStateFn, saveStateFn, execCwd);
  } finally {
    if (session) await (_opts._teardownWorktree ?? teardownWorktree)(session, cwd, defaultWorktreeDeps());
  }

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'autoresearch: autonomous research [complete]', result: 'research report written', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseTimeBudget(time: string): number {
  const lower = time.trim().toLowerCase();
  const value = parseFloat(lower);

  if (lower.endsWith('h')) return value * 60;
  if (lower.endsWith('m')) return value;
  if (lower.endsWith('min')) return value;
  // Assume minutes if no unit
  return Number.isFinite(value) ? value : 240;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

export function deriveMeasurementCommand(metric: string): string | null {
  const lower = metric.toLowerCase();
  if (lower.includes('test') && lower.includes('pass')) {
    return 'npm test 2>&1 | tail -1';
  }
  if (lower.includes('bundle') || lower.includes('size')) {
    return 'npm run build && du -sk dist/ | cut -f1';
  }
  if (lower.includes('lint')) {
    return 'npm run lint 2>&1 | grep -c "error"';
  }
  // Generic fallback — caller should provide an explicit command
  return null;
}

async function writeTsv(
  tsvPath: string,
  experiments: ExperimentResult[],
  writeFileFn: (p: string, content: string) => Promise<void> = (p, c) => fs.writeFile(p, c, 'utf8'),
): Promise<void> {
  const header = 'experiment\tmetric_value\tstatus\tdescription\n';
  const rows = experiments
    .map(e => `${e.id}\t${e.metricValue ?? 'crash'}\t${e.status}\t${e.description}\n`)
    .join('');
  await writeFileFn(tsvPath, header + rows);
}

async function appendTsv(
  tsvPath: string,
  experiment: ExperimentResult,
  appendFileFn: (p: string, content: string) => Promise<void> = (p, c) => fs.appendFile(p, c, 'utf8'),
): Promise<void> {
  const row = `${experiment.id}\t${experiment.metricValue ?? 'crash'}\t${experiment.status}\t${experiment.description}\n`;
  try {
    await appendFileFn(tsvPath, row);
  } catch {
    // Non-fatal — TSV is informational
  }
}
