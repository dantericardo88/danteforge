// Token cost reporting CLI command — reads persisted TokenReport JSON and displays formatted summaries.
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import type { TokenReport } from '../../core/execution-telemetry.js';

const REPORTS_DIR = '.danteforge/reports';
const COST_PREFIX = 'cost-';
const JSON_EXT = '.json';

export interface CostOptions {
  byAgent?: boolean;
  byTier?: boolean;
  savings?: boolean;
  history?: boolean;
}

async function findCostReports(cwd: string): Promise<string[]> {
  const dir = path.join(cwd, REPORTS_DIR);
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter(e => e.startsWith(COST_PREFIX) && e.endsWith(JSON_EXT))
      .sort()
      .map(e => path.join(dir, e));
  } catch {
    return [];
  }
}

async function readReport(filePath: string): Promise<TokenReport | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as TokenReport;
  } catch {
    logger.warn(`Failed to parse report: ${filePath}`);
    return null;
  }
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(4)}`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function printOverallSummary(report: TokenReport): void {
  logger.info(`--- Token Cost Report (session: ${report.sessionId}) ---`);
  logger.info(`Timestamp:      ${report.timestamp}`);
  logger.info(`Input tokens:   ${formatTokens(report.totalInputTokens)}`);
  logger.info(`Output tokens:  ${formatTokens(report.totalOutputTokens)}`);
  logger.info(`Total cost:     ${formatUsd(report.totalCostUsd)}`);

  const modelNames = Object.keys(report.byModel);
  if (modelNames.length > 0) {
    logger.info(`Models used:    ${modelNames.join(', ')}`);
  }
}

function printByAgent(report: TokenReport): void {
  const agents = Object.entries(report.byAgent);
  if (agents.length === 0) {
    logger.info('No per-agent data recorded.');
    return;
  }
  logger.info('--- Per-Agent Breakdown ---');
  logger.info(`${padRight('Agent', 20)} ${padLeft('Calls', 7)} ${padLeft('Input', 10)} ${padLeft('Output', 10)} ${padLeft('Cost', 10)}`);
  for (const [name, data] of agents) {
    logger.info(
      `${padRight(name, 20)} ${padLeft(String(data.callCount), 7)} ${padLeft(formatTokens(data.inputTokens), 10)} ${padLeft(formatTokens(data.outputTokens), 10)} ${padLeft(formatUsd(data.costUsd), 10)}`,
    );
  }
}

function printByTier(report: TokenReport): void {
  const tiers = Object.entries(report.byTier);
  if (tiers.length === 0) {
    logger.info('No per-tier data recorded.');
    return;
  }
  logger.info('--- Per-Tier Breakdown ---');
  logger.info(`${padRight('Tier', 20)} ${padLeft('Calls', 7)} ${padLeft('Tokens', 12)} ${padLeft('Cost', 10)}`);
  for (const [tier, data] of tiers) {
    logger.info(
      `${padRight(tier, 20)} ${padLeft(String(data.callCount), 7)} ${padLeft(formatTokens(data.totalTokens), 12)} ${padLeft(formatUsd(data.costUsd), 10)}`,
    );
  }
}

function printSavings(report: TokenReport): void {
  logger.info('--- Savings Summary ---');
  const lt = report.savedByLocalTransforms;
  logger.info(`Local transforms: ${lt.callCount} calls avoided, ~${formatTokens(lt.estimatedSavedTokens)} tokens saved (${formatUsd(lt.estimatedSavedUsd)})`);

  const comp = report.savedByCompression;
  const savedPercent = comp.savedPercent.toFixed(1);
  logger.info(`Compression:      ${formatTokens(comp.originalTokens)} -> ${formatTokens(comp.compressedTokens)} (${savedPercent}% reduction)`);

  const gates = report.savedByGates;
  logger.info(`Gate blocks:      ${gates.blockedCallCount} calls blocked, ~${formatTokens(gates.estimatedSavedTokens)} tokens saved`);

  const totalSavedUsd = lt.estimatedSavedUsd;
  const totalSavedTokens = lt.estimatedSavedTokens + (comp.originalTokens - comp.compressedTokens) + gates.estimatedSavedTokens;
  logger.info(`Total saved:      ~${formatTokens(totalSavedTokens)} tokens, ${formatUsd(totalSavedUsd)} from local transforms`);
}

function printHistorySummary(reports: TokenReport[]): void {
  logger.info(`--- Cost History (${reports.length} reports) ---`);
  logger.info(`${padRight('Timestamp', 24)} ${padRight('Session', 12)} ${padLeft('Input', 10)} ${padLeft('Output', 10)} ${padLeft('Cost', 10)}`);
  let cumulativeCost = 0;
  for (const r of reports) {
    cumulativeCost += r.totalCostUsd;
    logger.info(
      `${padRight(r.timestamp, 24)} ${padRight(r.sessionId.slice(0, 10), 12)} ${padLeft(formatTokens(r.totalInputTokens), 10)} ${padLeft(formatTokens(r.totalOutputTokens), 10)} ${padLeft(formatUsd(r.totalCostUsd), 10)}`,
    );
  }
  logger.info(`Cumulative cost: ${formatUsd(cumulativeCost)}`);
}

export interface CostCommandOptions extends CostOptions {
  _findReports?: typeof findCostReports;
  _readReport?: typeof readReport;
}

export async function cost(options: CostCommandOptions = {}): Promise<void> {
  const findFn = options._findReports ?? findCostReports;
  const readFn = options._readReport ?? readReport;

  const cwd = process.cwd();
  const reportFiles = await findFn(cwd);

  if (reportFiles.length === 0) {
    logger.info('No cost reports found in .danteforge/reports/.');
    logger.info('Run a session with token tracking enabled to generate reports.');
    return;
  }

  if (options.history) {
    const reports: TokenReport[] = [];
    for (const file of reportFiles) {
      const r = await readFn(file);
      if (r) reports.push(r);
    }
    if (reports.length === 0) {
      logger.warn('All report files failed to parse.');
      return;
    }
    printHistorySummary(reports);
    return;
  }

  const latestFile = reportFiles[reportFiles.length - 1];
  const report = await readFn(latestFile);
  if (!report) {
    logger.error(`Failed to read latest report: ${latestFile}`);
    return;
  }

  if (options.byAgent) {
    printByAgent(report);
    return;
  }
  if (options.byTier) {
    printByTier(report);
    return;
  }
  if (options.savings) {
    printSavings(report);
    return;
  }

  printOverallSummary(report);
}
