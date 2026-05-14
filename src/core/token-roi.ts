// Token ROI Visibility — tracks score-delta-per-1000-tokens efficiency per autoforge wave
// Append-only JSONL at .danteforge/token-roi.jsonl
import path from 'node:path';
import fs from 'node:fs/promises';
import { estimateCost } from './token-estimator.js';
import type { LLMProvider } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Aggregated ROI summary across all recorded sessions/waves.
 * Provides a high-level view of token spend efficiency.
 */
export interface RoiSummary {
  /** Total input tokens spent across all recorded waves. */
  totalInputTokens: number;
  /** Total tokens filtered/saved by the context economy layer. */
  filteredTokens: number;
  /** Percentage of tokens saved relative to totalInputTokens (0–100). */
  savingsPercent: number;
  /** Estimated USD saved by not sending filtered tokens to the LLM. */
  estimatedUsdSaved: number;
  /** Number of wave sessions (ROI entries) included in this summary. */
  sessionCount: number;
}

export interface WaveROIEntry {
  wave: number;
  tokensSpent: number;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  costEstimatedUsd: number;
  /** scoreDelta / (tokensSpent / 1000) — score points per 1k tokens */
  efficiency: number;
  timestamp: string;
}

export interface AppendROIOptions {
  _appendLine?: (filePath: string, line: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
}

export interface LoadROIOptions {
  _readFile?: (p: string) => Promise<string>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const TOKEN_ROI_FILE = '.danteforge/token-roi.jsonl';

// ── Default I/O ───────────────────────────────────────────────────────────────

async function defaultAppendLine(filePath: string, line: string): Promise<void> {
  await fs.appendFile(filePath, line + '\n', 'utf8');
}

// ── Build entry ───────────────────────────────────────────────────────────────

/**
 * Build a WaveROIEntry from raw values.
 * Exported so autoforge-loop can construct without importing the whole module.
 */
export function buildROIEntry(
  wave: number,
  tokensSpent: number,
  scoreBefore: number,
  scoreAfter: number,
  provider: LLMProvider = 'claude',
): WaveROIEntry {
  const scoreDelta = scoreAfter - scoreBefore;
  const { totalEstimate } = estimateCost(tokensSpent, provider);
  const efficiency = tokensSpent > 0 ? scoreDelta / (tokensSpent / 1000) : 0;
  return {
    wave,
    tokensSpent,
    scoreBefore,
    scoreAfter,
    scoreDelta,
    costEstimatedUsd: totalEstimate,
    efficiency,
    timestamp: new Date().toISOString(),
  };
}

// ── Append ────────────────────────────────────────────────────────────────────

export async function appendROIEntry(
  entry: WaveROIEntry,
  cwd: string,
  opts?: AppendROIOptions,
): Promise<void> {
  const filePath = path.join(cwd, TOKEN_ROI_FILE);
  const mkdir = opts?._mkdir ?? ((p, o) => fs.mkdir(p, o));
  const appendLine = opts?._appendLine ?? defaultAppendLine;

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendLine(filePath, JSON.stringify(entry));
}

// ── Load ──────────────────────────────────────────────────────────────────────

export async function loadROIHistory(
  cwd: string,
  opts?: LoadROIOptions,
): Promise<WaveROIEntry[]> {
  const filePath = path.join(cwd, TOKEN_ROI_FILE);
  const readFile = opts?._readFile ?? ((p) => fs.readFile(p, 'utf8'));

  let raw: string;
  try {
    raw = await readFile(filePath);
  } catch {
    return [];
  }

  const entries: WaveROIEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as WaveROIEntry);
    } catch {
      // Skip corrupt lines silently
    }
  }
  return entries;
}

// ── Format ────────────────────────────────────────────────────────────────────

// ── RoiSummary helpers ────────────────────────────────────────────────────────

/**
 * Aggregate ROI data from a list of WaveROIEntry records (e.g. loaded from the
 * JSONL file) together with optional pre-computed filter savings information.
 *
 * @param entries        Wave ROI entries from `loadROIHistory`.
 * @param filteredTokens Total tokens saved by context economy filters (optional).
 *                       When omitted, defaults to 0.
 * @param provider       Provider used for cost estimation of saved tokens.
 */
export function computeRoiSummary(
  entries: WaveROIEntry[],
  filteredTokens = 0,
  provider: LLMProvider = 'claude',
): RoiSummary {
  const sessionCount = entries.length;
  const totalInputTokens = entries.reduce((s, e) => s + e.tokensSpent, 0);

  const savingsPercent =
    totalInputTokens + filteredTokens > 0
      ? Math.round((filteredTokens / (totalInputTokens + filteredTokens)) * 100)
      : 0;

  const { totalEstimate: estimatedUsdSaved } = estimateCost(filteredTokens, provider);

  return {
    totalInputTokens,
    filteredTokens,
    savingsPercent,
    estimatedUsdSaved,
    sessionCount,
  };
}

/**
 * Render a human-readable text report from a `RoiSummary`.
 * Suitable for direct CLI output.
 */
export function formatRoiReport(summary: RoiSummary): string {
  const lines: string[] = [
    'Token Economy ROI Report',
    '────────────────────────',
    `Sessions tracked:   ${summary.sessionCount}`,
    `Total tokens spent: ${summary.totalInputTokens.toLocaleString()}`,
    `Tokens filtered:    ${summary.filteredTokens.toLocaleString()} (${summary.savingsPercent}% savings)`,
    `Est. USD saved:     $${summary.estimatedUsdSaved.toFixed(4)}`,
  ];
  if (summary.sessionCount === 0) {
    lines.push('', 'No ROI data recorded yet. Run autoforge waves to start tracking.');
  }
  return lines.join('\n');
}

/**
 * Compute quality-per-dollar: how much output quality was obtained per USD spent.
 * Returns 0 if inputCost is 0 to avoid division by zero.
 *
 * @param inputCost      Total USD cost for the LLM calls.
 * @param outputQuality  Quality score (0–10 scale) for the resulting output.
 */
export function computePaybackRatio(inputCost: number, outputQuality: number): number {
  if (inputCost <= 0) return 0;
  return outputQuality / inputCost;
}

// ── Format (legacy table) ─────────────────────────────────────────────────────

/** Render ROI history as a markdown table with totals footer. */
export function formatROISummary(entries: WaveROIEntry[]): string {
  if (entries.length === 0) return '_No ROI data recorded yet._';

  const lines: string[] = [
    '| Wave | Tokens | ΔScore | Efficiency | Cost USD |',
    '|------|-------:|-------:|-----------:|---------:|',
  ];

  let totalTokens = 0;
  let totalCost = 0;
  let totalDelta = 0;

  for (const e of entries) {
    const eff = e.efficiency.toFixed(2);
    const cost = e.costEstimatedUsd.toFixed(4);
    const delta = e.scoreDelta >= 0 ? `+${e.scoreDelta.toFixed(1)}` : e.scoreDelta.toFixed(1);
    lines.push(`| ${e.wave} | ${e.tokensSpent.toLocaleString()} | ${delta} | ${eff} | $${cost} |`);
    totalTokens += e.tokensSpent;
    totalCost += e.costEstimatedUsd;
    totalDelta += e.scoreDelta;
  }

  const avgEfficiency = totalTokens > 0 ? (totalDelta / (totalTokens / 1000)).toFixed(2) : '0.00';
  lines.push('');
  lines.push(
    `**Total:** ${totalTokens.toLocaleString()} tokens | ` +
    `$${totalCost.toFixed(4)} | ` +
    `avg efficiency: ${avgEfficiency} pts/1k tokens`,
  );

  return lines.join('\n');
}
