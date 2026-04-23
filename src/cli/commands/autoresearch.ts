// autoresearch — Karpathy-style autonomous metric-driven optimization loop
// Fully autonomous once started. Plan, rewrite, execute, evaluate, keep winners, repeat.

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import type { LLMProvider } from '../../core/config.js';
import type { CallLLMOptions } from '../../core/llm-pipeline.js';
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

const execFileAsync = promisify(execFile);

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

// ── Git helpers ───────────────────────────────────────────────────────────────

type GitFn = (args: string[], cwd: string) => Promise<string>;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000, env: process.env });
  return stdout.trim();
}

async function gitIsDirty(cwd: string, gitFn: GitFn = git): Promise<boolean> {
  try {
    const status = await gitFn(['status', '--porcelain'], cwd);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

async function gitBranchExists(branch: string, cwd: string, gitFn: GitFn = git): Promise<boolean> {
  try {
    await gitFn(['rev-parse', '--verify', branch], cwd);
    return true;
  } catch {
    return false;
  }
}

async function gitCurrentHash(cwd: string, gitFn: GitFn = git): Promise<string> {
  return gitFn(['rev-parse', 'HEAD'], cwd);
}

async function gitCreateBranch(branch: string, cwd: string, gitFn: GitFn = git): Promise<void> {
  if (await gitBranchExists(branch, cwd, gitFn)) {
    logger.warn(`Branch ${branch} already exists — checking it out.`);
    await gitFn(['checkout', branch], cwd);
  } else {
    await gitFn(['checkout', '-b', branch], cwd);
  }
}

async function gitResetHard(hash: string, cwd: string, gitFn: GitFn = git): Promise<void> {
  await gitFn(['reset', '--hard', hash], cwd);
}

async function gitCommitAll(message: string, cwd: string, gitFn: GitFn = git): Promise<string> {
  await gitFn(['add', '-A'], cwd);
  await gitFn(['commit', '--allow-empty', '-m', message], cwd);
  return gitCurrentHash(cwd, gitFn);
}

// ── LLM-based hypothesis generation ──────────────────────────────────────────

interface Hypothesis {
  description: string;
  fileToChange: string;
  change: string;
}

type CallLLMFn = (prompt: string, provider?: LLMProvider | undefined, opts?: CallLLMOptions) => Promise<string>;

async function generateHypothesis(
  config: AutoResearchConfig,
  experimentId: number,
  previousResults: ExperimentResult[],
  callLLMFn: CallLLMFn = callLLM,
  readFileFn: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<Hypothesis> {
  const resultsContext = previousResults.length > 0
    ? `Previous experiments:\n${formatResultsTsv(previousResults)}\n`
    : 'No previous experiments yet.\n';

  // Read optional program.md research strategy (Karpathy pattern: human-authored guidance per iteration)
  let programContext = '';
  try {
    const programMd = await readFileFn(path.join(config.cwd, 'autoresearch.program.md'));
    if (programMd.trim()) {
      programContext = `Research strategy (from autoresearch.program.md):\n${programMd.trim()}\n\n`;
    }
  } catch { /* optional file — no-op */ }

  const prompt = `You are an autonomous code optimizer implementing Karpathy's autoresearch pattern.

Goal: ${config.goal}
Metric: ${config.metric} (lower is better for performance metrics)
Measurement command: ${config.measurementCommand}
Working directory: ${config.cwd}
Experiment number: ${experimentId}

${programContext}${resultsContext}

Generate a single, focused hypothesis for the next experiment. Make ONE small, surgical change.
Prefer high-impact, low-effort changes. Build on what worked; avoid what failed.

Respond with EXACTLY this JSON format (no other text, no markdown fences):
{
  "description": "<one sentence: what you are changing and why>",
  "fileToChange": "<relative path to the file to change>",
  "change": "<complete new content for that file, or a precise diff/patch>"
}`;

  const response = await callLLMFn(prompt, undefined, {
    enrichContext: true,
    cwd: config.cwd,
  });

  try {
    // Strip any accidental markdown fences
    const cleaned = response.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as Hypothesis;
    if (!parsed.description || !parsed.fileToChange || !parsed.change) {
      throw new Error('Missing required fields in hypothesis JSON');
    }
    return parsed;
  } catch (err) {
    logger.warn(`Failed to parse LLM hypothesis JSON: ${err instanceof Error ? err.message : String(err)}`);
    // Provide a safe fallback hypothesis that won't break anything
    return {
      description: `Experiment ${experimentId}: exploratory no-op to establish loop integrity`,
      fileToChange: '',
      change: '',
    };
  }
}

async function applyHypothesis(hypothesis: Hypothesis, cwd: string): Promise<boolean> {
  if (!hypothesis.fileToChange || !hypothesis.change) {
    logger.info('No file change in hypothesis — running as-is.');
    return true;
  }

  const targetPath = path.resolve(cwd, hypothesis.fileToChange);
  try {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, hypothesis.change, 'utf8');
    return true;
  } catch (err) {
    logger.error(`Failed to apply hypothesis to ${targetPath}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

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
): Promise<{ branchName: string; baseline: number; allExperiments: ExperimentResult[]; bestValue: number; bestHash: string; tsvPath: string } | null> {
  const branchName = `autoresearch/${slugify(goal)}`;
  logger.info(`Creating branch: ${branchName}`);
  try { await gitCreateBranch(branchName, cwd, gitFn); } catch (err) {
    logger.error(`Failed to create branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`);
    logger.info('Continuing on current branch.');
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
  const tsvPath = path.join(cwd, 'results.tsv');
  await writeTsv(tsvPath, [baselineResult], writeFileFn);
  logger.info(`Beginning experiment loop. Time budget: ${config.timeBudgetMinutes} minutes.`);
  logger.info('');
  const llmOk = await isLLMAvailableFn();
  if (!llmOk) {
    logger.error('No LLM available — cannot generate hypotheses.');
    logger.error('Fix: set ANTHROPIC_API_KEY, or start Ollama, or run with --prompt for copy-paste mode.');
    process.exitCode = 1;
    return null;
  }
  return { branchName, baseline, allExperiments, bestValue: baseline, bestHash, tsvPath };
}

async function runExperimentLoop(
  config: AutoResearchConfig, allExperiments: ExperimentResult[], initialBestValue: number, initialBestHash: string,
  tsvPath: string, noiseMargin: number, startTime: number, budgetMs: number,
  callLLMFn: CallLLMFn, readFileFn: (p: string) => Promise<string>,
  runExperimentFn: (c: AutoResearchConfig, id: number, desc: string) => Promise<ExperimentResult>,
  gitFn: GitFn, isLLMAvailableFn: () => Promise<boolean>,
  appendFileFn: (p: string, c: string) => Promise<void>,
  nowFn: () => number, sleepFn: (ms: number) => Promise<void>,
  cwd: string,
): Promise<{ bestValue: number; bestHash: string }> {
  let bestValue = initialBestValue;
  let bestHash = initialBestHash;
  let experimentId = 1;
  let consecutiveLLMFailures = 0;
  const MAX_LLM_FAILURES = 5;

  while (nowFn() - startTime < budgetMs) {
    if (budgetMs - (nowFn() - startTime) < 90_000) { logger.info('Time budget nearly exhausted — stopping experiment loop.'); break; }
    const llmOk = await isLLMAvailableFn();
    if (!llmOk) {
      consecutiveLLMFailures++;
      if (consecutiveLLMFailures >= MAX_LLM_FAILURES) { logger.error(`LLM unavailable for ${MAX_LLM_FAILURES} consecutive checks — stopping experiment loop.`); break; }
      logger.warn(`LLM temporarily unavailable (${consecutiveLLMFailures}/${MAX_LLM_FAILURES}). Retrying in 30s...`);
      await sleepFn(30_000); continue;
    }
    consecutiveLLMFailures = 0;
    logger.info(`--- Experiment ${experimentId} ---`);
    let hypothesis;
    try {
      hypothesis = await generateHypothesis(config, experimentId, allExperiments, callLLMFn, readFileFn);
      logger.info(`Hypothesis: ${hypothesis.description}`);
    } catch (err) { logger.warn(`Hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}`); experimentId++; continue; }
    const preExperimentHash = await gitCurrentHash(cwd, gitFn).catch(() => '');
    const applied = await applyHypothesis(hypothesis, cwd);
    if (!applied) {
      logger.warn('Could not apply hypothesis — skipping.');
      const crashResult: ExperimentResult = { id: experimentId, description: hypothesis.description, metricValue: null, status: 'crash' };
      allExperiments.push(crashResult); await appendTsv(tsvPath, crashResult, appendFileFn); experimentId++; continue;
    }
    let result = await runExperimentFn(config, experimentId, hypothesis.description);
    if (result.status !== 'crash' && result.metricValue !== null) {
      result = { ...result, status: shouldKeep(result.metricValue, bestValue, noiseMargin) ? 'keep' : 'discard' };
    }
    if (result.status === 'keep' && result.metricValue !== null) {
      try {
        const hash = await gitCommitAll(`experiment: ${hypothesis.description}`, cwd, gitFn);
        result = { ...result, commitHash: hash };
        bestValue = result.metricValue!; bestHash = hash;
        logger.success(`Kept! New best: ${bestValue} (was ${bestValue}). Commit: ${hash.slice(0, 8)}`);
      } catch (err) { logger.warn(`Commit failed: ${err instanceof Error ? err.message : String(err)}`); }
    } else {
      const reason = result.status === 'crash' ? 'crashed' : 'did not improve metric';
      logger.info(`Discarding (${reason}). Rolling back to ${preExperimentHash.slice(0, 8)}.`);
      try { await gitResetHard(preExperimentHash, cwd, gitFn); } catch (err) { logger.warn(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`); }
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
  const reportPath = path.join(cwd, 'AUTORESEARCH_REPORT.md');
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
  } = {},
  _opts: AutoResearchOpts = {},
): Promise<void> {
  return withErrorBoundary('autoresearch', async () => {
  const metric = options.metric ?? 'metric value';
  const timeBudgetMinutes = parseTimeBudget(options.time ?? '4h');
  const cwd = process.cwd();
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
  if (!options.allowDirty && await gitIsDirty(cwd, gitFn)) {
    logger.error('AutoResearch refuses to run on a dirty working tree.');
    logger.error('Commit or stash your changes first, or rerun with --allow-dirty if you intentionally want that risk.');
    process.exitCode = 1; return;
  }

  const config: AutoResearchConfig = { goal, metric, timeBudgetMinutes, measurementCommand, cwd };
  const noiseMargin = resolveNoiseMargin(metric);
  const startTime = nowFn();
  const budgetMs = timeBudgetMinutes * 60 * 1000;

  const setup = await initExperimentSetup(goal, config, cwd, gitFn, runBaselineFn, isLLMAvailableFn, writeFileFn);
  if (!setup) return;
  const { branchName, baseline, allExperiments, bestValue: initBest, bestHash: initHash, tsvPath } = setup;

  const { bestValue, bestHash: _finalHash } = await runExperimentLoop(
    config, allExperiments, initBest, initHash, tsvPath, noiseMargin, startTime, budgetMs,
    callLLMFn, readFileFn, runExperimentFn, gitFn, isLLMAvailableFn, appendFileFn, nowFn, sleepFn, cwd,
  );

  await generateAndWriteReport(goal, metric, config, allExperiments, baseline, bestValue, branchName, tsvPath, startTime, nowFn, callLLMFn, isLLMAvailableFn, writeFileFn, loadStateFn, saveStateFn, cwd);
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
