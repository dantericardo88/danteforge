// autoresearch — Karpathy-style autonomous metric-driven optimization loop
// Fully autonomous once started. Plan, rewrite, execute, evaluate, keep winners, repeat.

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

const execFileAsync = promisify(execFile);

// ── Noise margins per spec ────────────────────────────────────────────────────

const TIMING_KEYWORDS = ['ms', 'millisecond', 'second', 'latency', 'time', 'duration', 'startup'];
const TIMING_NOISE_MARGIN = 0.01;   // 1%
const OTHER_NOISE_MARGIN  = 0.005;  // 0.5%

function resolveNoiseMargin(metric: string): number {
  const lower = metric.toLowerCase();
  return TIMING_KEYWORDS.some(kw => lower.includes(kw))
    ? TIMING_NOISE_MARGIN
    : OTHER_NOISE_MARGIN;
}

// ── Slug helper ───────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

// ── Git helpers ───────────────────────────────────────────────────────────────

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000, env: process.env });
  return stdout.trim();
}

async function gitBranchExists(branch: string, cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--verify', branch], cwd);
    return true;
  } catch {
    return false;
  }
}

async function gitCurrentHash(cwd: string): Promise<string> {
  return git(['rev-parse', 'HEAD'], cwd);
}

async function gitCreateBranch(branch: string, cwd: string): Promise<void> {
  if (await gitBranchExists(branch, cwd)) {
    logger.warn(`Branch ${branch} already exists — checking it out.`);
    await git(['checkout', branch], cwd);
  } else {
    await git(['checkout', '-b', branch], cwd);
  }
}

async function gitResetHard(hash: string, cwd: string): Promise<void> {
  await git(['reset', '--hard', hash], cwd);
}

async function gitCommitAll(message: string, cwd: string): Promise<string> {
  await git(['add', '-A'], cwd);
  await git(['commit', '--allow-empty', '-m', message], cwd);
  return gitCurrentHash(cwd);
}

// ── LLM-based hypothesis generation ──────────────────────────────────────────

interface Hypothesis {
  description: string;
  fileToChange: string;
  change: string;
}

async function generateHypothesis(
  config: AutoResearchConfig,
  experimentId: number,
  previousResults: ExperimentResult[],
): Promise<Hypothesis> {
  const resultsContext = previousResults.length > 0
    ? `Previous experiments:\n${formatResultsTsv(previousResults)}\n`
    : 'No previous experiments yet.\n';

  const prompt = `You are an autonomous code optimizer implementing Karpathy's autoresearch pattern.

Goal: ${config.goal}
Metric: ${config.metric} (lower is better for performance metrics)
Measurement command: ${config.measurementCommand}
Working directory: ${config.cwd}
Experiment number: ${experimentId}

${resultsContext}

Generate a single, focused hypothesis for the next experiment. Make ONE small, surgical change.
Prefer high-impact, low-effort changes. Build on what worked; avoid what failed.

Respond with EXACTLY this JSON format (no other text, no markdown fences):
{
  "description": "<one sentence: what you are changing and why>",
  "fileToChange": "<relative path to the file to change>",
  "change": "<complete new content for that file, or a precise diff/patch>"
}`;

  const response = await callLLM(prompt, undefined, {
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
): Promise<string[]> {
  const llmAvailable = await isLLMAvailable();
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
    const response = await callLLM(prompt, undefined, {
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

function buildFallbackInsights(
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

function buildPromptModeOutput(
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

export async function autoResearch(
  goal: string,
  options: {
    metric?: string;
    time?: string;
    measurementCommand?: string;
    prompt?: boolean;
    dryRun?: boolean;
  } = {},
): Promise<void> {
  const metric = options.metric ?? 'metric value';
  const timeBudgetMinutes = parseTimeBudget(options.time ?? '4h');
  const cwd = process.cwd();

  // Derive measurement command from metric if not provided
  const measurementCommand = options.measurementCommand ?? deriveMeasurementCommand(metric);

  logger.success('DanteForge AutoResearch — Autonomous Optimization Loop');
  logger.info('');
  logger.info(`Goal:    ${goal}`);
  logger.info(`Metric:  ${metric}`);
  logger.info(`Budget:  ${timeBudgetMinutes} minutes`);
  logger.info(`Command: ${measurementCommand}`);
  logger.info('');

  // --prompt mode: generate copy-paste prompt and exit
  if (options.prompt) {
    const promptText = buildPromptModeOutput(goal, metric, timeBudgetMinutes, measurementCommand);
    logger.success('=== COPY-PASTE PROMPT (start) ===');
    process.stdout.write('\n' + promptText + '\n\n');
    logger.success('=== COPY-PASTE PROMPT (end) ===');
    logger.info('');
    logger.info('Paste this into your LLM interface to run autoresearch manually.');

    const state = await loadState({ cwd });
    state.auditLog.push(`${new Date().toISOString()} | autoresearch: prompt mode — goal: ${goal}`);
    await saveState(state, { cwd });
    return;
  }

  // --dry-run mode: display plan without executing
  if (options.dryRun) {
    logger.info('--- Dry Run Plan ---');
    logger.info(`1. Create branch: autoresearch/${slugify(goal)}`);
    logger.info(`2. Run baseline: ${measurementCommand}`);
    logger.info(`3. Enter experiment loop for ${timeBudgetMinutes} minutes`);
    logger.info('4. On each iteration: generate hypothesis -> apply change -> measure -> keep/discard');
    logger.info('5. Write AUTORESEARCH_REPORT.md when time expires');
    logger.info('--- Dry Run Complete (no commands executed) ---');

    const state = await loadState({ cwd });
    state.auditLog.push(`${new Date().toISOString()} | autoresearch: dry-run — goal: ${goal}`);
    await saveState(state, { cwd });
    return;
  }

  // ── Execute mode ─────────────────────────────────────────────────────────────

  const config: AutoResearchConfig = {
    goal,
    metric,
    timeBudgetMinutes,
    measurementCommand,
    cwd,
  };

  const noiseMargin = resolveNoiseMargin(metric);
  const startTime = Date.now();
  const budgetMs = timeBudgetMinutes * 60 * 1000;

  // Create the experiment branch
  const branchName = `autoresearch/${slugify(goal)}`;
  logger.info(`Creating branch: ${branchName}`);
  try {
    await gitCreateBranch(branchName, cwd);
  } catch (err) {
    logger.error(`Failed to create branch ${branchName}: ${err instanceof Error ? err.message : String(err)}`);
    logger.info('Continuing on current branch.');
  }

  // Phase 0: Baseline
  logger.info('Running baseline measurement...');
  let baseline: number;
  try {
    baseline = await runBaseline(config);
    logger.success(`Baseline established at ${baseline}`);
  } catch (err) {
    logger.error(`Baseline measurement failed: ${err instanceof Error ? err.message : String(err)}`);
    logger.error('Cannot start autoresearch without a working measurement command.');
    process.exitCode = 1;
    return;
  }

  const baselineResult: ExperimentResult = {
    id: 0,
    description: 'unmodified baseline',
    metricValue: baseline,
    status: 'keep',
  };

  const allExperiments: ExperimentResult[] = [baselineResult];
  let bestValue = baseline;
  let bestHash = await gitCurrentHash(cwd).catch(() => '');

  // Write initial results.tsv (untracked — do not commit)
  const tsvPath = path.join(cwd, 'results.tsv');
  await writeTsv(tsvPath, [baselineResult]);

  logger.info(`Beginning experiment loop. Time budget: ${timeBudgetMinutes} minutes.`);
  logger.info('');

  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    logger.warn('No LLM available — cannot generate hypotheses. Exiting experiment loop.');
  }

  // Phase 1: Experiment loop
  let experimentId = 1;

  while (llmAvailable && Date.now() - startTime < budgetMs) {
    const remainingMs = budgetMs - (Date.now() - startTime);
    // Don't start a new experiment if there are fewer than 90 seconds left
    if (remainingMs < 90_000) {
      logger.info('Time budget nearly exhausted — stopping experiment loop.');
      break;
    }

    logger.info(`--- Experiment ${experimentId} ---`);

    // 1. PLAN: generate hypothesis
    let hypothesis;
    try {
      hypothesis = await generateHypothesis(config, experimentId, allExperiments);
      logger.info(`Hypothesis: ${hypothesis.description}`);
    } catch (err) {
      logger.warn(`Hypothesis generation failed: ${err instanceof Error ? err.message : String(err)}`);
      experimentId++;
      continue;
    }

    const preExperimentHash = await gitCurrentHash(cwd).catch(() => '');

    // 2. REWRITE: apply the hypothesis
    const applied = await applyHypothesis(hypothesis, cwd);
    if (!applied) {
      logger.warn('Could not apply hypothesis — skipping.');
      const crashResult: ExperimentResult = {
        id: experimentId,
        description: hypothesis.description,
        metricValue: null,
        status: 'crash',
      };
      allExperiments.push(crashResult);
      await appendTsv(tsvPath, crashResult);
      experimentId++;
      continue;
    }

    // 3. EXECUTE: measure
    let result = await runExperiment(config, experimentId, hypothesis.description);

    // 4. EVALUATE + DECIDE
    if (result.status !== 'crash' && result.metricValue !== null) {
      const keep = shouldKeep(result.metricValue, bestValue, noiseMargin);
      result = { ...result, status: keep ? 'keep' : 'discard' };
    }

    if (result.status === 'keep' && result.metricValue !== null) {
      // Commit the winning change
      try {
        const hash = await gitCommitAll(`experiment: ${hypothesis.description}`, cwd);
        result = { ...result, commitHash: hash };
        bestValue = result.metricValue!;
        bestHash = hash;
        logger.success(`Kept! New best: ${bestValue} (was ${bestValue}). Commit: ${hash.slice(0, 8)}`);
      } catch (err) {
        logger.warn(`Commit failed: ${err instanceof Error ? err.message : String(err)}`);
        // Still record as kept since metric improved; just no commit hash
      }
    } else {
      // Rollback
      const reason = result.status === 'crash' ? 'crashed' : 'did not improve metric';
      logger.info(`Discarding (${reason}). Rolling back to ${preExperimentHash.slice(0, 8)}.`);
      try {
        await gitResetHard(preExperimentHash, cwd);
      } catch (err) {
        logger.warn(`Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 6. RECORD
    allExperiments.push(result);
    await appendTsv(tsvPath, result);

    experimentId++;
  }

  // Phase 2: Report
  const durationMs = Date.now() - startTime;
  const durationStr = formatDuration(durationMs);

  const kept = allExperiments.filter(e => e.status === 'keep' && e.id > 0).length;
  const discarded = allExperiments.filter(e => e.status === 'discard').length;
  const crashed = allExperiments.filter(e => e.status === 'crash').length;
  const finalValue = bestValue;
  const improvement = baseline - finalValue;
  const improvementPercent = baseline !== 0
    ? (improvement / Math.abs(baseline)) * 100
    : 0;

  const nonBaselineExperiments = allExperiments.filter(e => e.id > 0);
  const insights = await generateInsights(config, nonBaselineExperiments, baseline, finalValue);

  const report: AutoResearchReport = {
    goal,
    metric,
    duration: durationStr,
    baseline,
    final: finalValue,
    improvement,
    improvementPercent,
    experiments: nonBaselineExperiments,
    kept,
    discarded,
    crashed,
    insights,
  };

  const reportMd = formatReport(report);
  const reportPath = path.join(cwd, 'AUTORESEARCH_REPORT.md');
  await fs.writeFile(reportPath, reportMd, 'utf8');

  // Audit log
  const state = await loadState({ cwd });
  state.auditLog.push(
    `${new Date().toISOString()} | autoresearch: complete — goal: ${goal}, metric: ${metric}, experiments: ${nonBaselineExperiments.length}, kept: ${kept}, improvement: ${improvementPercent.toFixed(2)}%`,
  );
  await saveState(state, { cwd });

  logger.info('');
  logger.success('='.repeat(60));
  logger.success('  AUTORESEARCH COMPLETE');
  logger.success('='.repeat(60));
  logger.info('');
  logger.info(`Duration:    ${durationStr}`);
  logger.info(`Experiments: ${nonBaselineExperiments.length}`);
  logger.info(`Kept:        ${kept}  |  Discarded: ${discarded}  |  Crashed: ${crashed}`);
  logger.info(`Baseline:    ${baseline}`);
  logger.info(`Final:       ${finalValue}`);
  logger.info(`Improvement: ${improvement >= 0 ? '+' : ''}${improvement.toFixed(4)} (${improvementPercent >= 0 ? '+' : ''}${improvementPercent.toFixed(2)}%)`);
  logger.info('');
  logger.success(`Report written to: ${reportPath}`);
  logger.info(`Results log:       ${tsvPath}`);
  logger.info(`Branch:            ${branchName}`);
  logger.info('');
  logger.info('Run `danteforge verify` to validate the final state.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseTimeBudget(time: string): number {
  const lower = time.trim().toLowerCase();
  const value = parseFloat(lower);

  if (lower.endsWith('h')) return value * 60;
  if (lower.endsWith('m')) return value;
  if (lower.endsWith('min')) return value;
  // Assume minutes if no unit
  return Number.isFinite(value) ? value : 240;
}

function formatDuration(ms: number): string {
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

function deriveMeasurementCommand(metric: string): string {
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
  return 'echo 0';
}

async function writeTsv(tsvPath: string, experiments: ExperimentResult[]): Promise<void> {
  const header = 'experiment\tmetric_value\tstatus\tdescription\n';
  const rows = experiments
    .map(e => `${e.id}\t${e.metricValue ?? 'crash'}\t${e.status}\t${e.description}\n`)
    .join('');
  await fs.writeFile(tsvPath, header + rows, 'utf8');
}

async function appendTsv(tsvPath: string, experiment: ExperimentResult): Promise<void> {
  const row = `${experiment.id}\t${experiment.metricValue ?? 'crash'}\t${experiment.status}\t${experiment.description}\n`;
  try {
    await fs.appendFile(tsvPath, row, 'utf8');
  } catch {
    // Non-fatal — TSV is informational
  }
}
