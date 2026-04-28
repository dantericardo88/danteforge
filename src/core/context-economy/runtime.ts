import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { compressArtifact, type ArtifactType } from './artifact-compressor.js';
import { appendLedgerRecord, buildLedgerRecord, loadAllLedgerRecords, summarizeLedger } from './economy-ledger.js';
import { filterOutput, type PreToolAdapterOptions } from './pretool-adapter.js';
import { estimateTokens } from '../token-estimator.js';
import type { FilterResult, FilterStatus, LedgerRecord, LedgerSummary } from './types.js';

const LEDGER_DIR = path.join('.danteforge', 'evidence', 'context-economy');
const REQUIRED_MODULES = [
  'sacred-content',
  'economy-ledger',
  'pretool-adapter',
  'command-filter-registry',
  'artifact-compressor',
  'runtime',
] as const;
const REQUIRED_FILTERS = ['git', 'npm', 'pnpm', 'eslint', 'jest', 'vitest', 'cargo', 'docker', 'find', 'pytest'] as const;

export interface FilterShellResultInput {
  command: string;
  stdout: string;
  stderr: string;
  cwd?: string;
  organ?: string;
  writeLedger?: boolean;
  _filterOutput?: typeof filterOutput;
  _ledgerWriter?: typeof appendLedgerRecord;
}

export interface FilterShellResultOutput {
  stdout: string;
  stderr: string;
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
  statuses: FilterStatus[];
  stdoutFilter?: FilterResult;
  stderrFilter?: FilterResult;
}

export interface EconomizedArtifactContext {
  path: string;
  type: ArtifactType;
  content: string;
  originalSize: number;
  compressedSize: number;
  savingsPercent: number;
  sacredSpanCount: number;
  rawHash: string;
}

export interface EconomizedArtifactInput {
  path: string;
  type: ArtifactType;
  cwd?: string;
}

export interface ContextEconomyScoreOptions {
  since?: string;
  organ?: string;
}

export interface ContextEconomySubscores {
  coverage: number;
  telemetry: number;
  savings: number;
  sacredSafety: number;
  artifactCompression: number;
}

export interface ContextEconomyScoreReport {
  score: number;
  subscores: ContextEconomySubscores;
  recordsInWindow: number;
  summary: LedgerSummary;
  since?: string;
  organ?: string;
}

interface StreamFilterResult {
  output: string;
  result?: FilterResult;
}

export async function filterShellResult(input: FilterShellResultInput): Promise<FilterShellResultOutput> {
  const cwd = input.cwd ?? process.cwd();
  const organ = input.organ ?? 'forge';
  const writeLedger = input.writeLedger !== false;
  const ledgerWriter = input._ledgerWriter ?? appendLedgerRecord;

  const stdout = await filterStream(input.command, input.stdout, {
    cwd,
    organ,
    writeLedger,
    ledgerWriter,
    filterFn: input._filterOutput ?? filterOutput,
  });
  const stderr = await filterStream(input.command, input.stderr, {
    cwd,
    organ,
    writeLedger,
    ledgerWriter,
    filterFn: input._filterOutput ?? filterOutput,
  });

  const filters = [stdout.result, stderr.result].filter((result): result is FilterResult => result !== undefined);
  return {
    stdout: stdout.output,
    stderr: stderr.output,
    inputTokens: filters.reduce((sum, result) => sum + result.inputTokens, 0),
    outputTokens: filters.reduce((sum, result) => sum + result.outputTokens, 0),
    savedTokens: filters.reduce((sum, result) => sum + result.savedTokens, 0),
    statuses: filters.map((result) => result.status),
    ...(stdout.result ? { stdoutFilter: stdout.result } : {}),
    ...(stderr.result ? { stderrFilter: stderr.result } : {}),
  };
}

async function filterStream(
  command: string,
  output: string,
  opts: {
    cwd: string;
    organ: string;
    writeLedger: boolean;
    ledgerWriter: typeof appendLedgerRecord;
    filterFn: typeof filterOutput;
  },
): Promise<StreamFilterResult> {
  if (output.length === 0) {
    return { output };
  }

  let result: FilterResult;
  try {
    result = await opts.filterFn(command, output, {
      cwd: opts.cwd,
      organ: opts.organ,
      writeLedger: false,
    } satisfies PreToolAdapterOptions);
  } catch {
    const tokens = estimateTokens(output);
    result = {
      output,
      status: 'filter-failed',
      inputTokens: tokens,
      outputTokens: tokens,
      savedTokens: 0,
      savingsPercent: 0,
      sacredSpanCount: 0,
      filterId: 'facade-error',
    };
  }

  result = normalizeSacredBypass(result, output);

  if (opts.writeLedger) {
    try {
      await opts.ledgerWriter(
        buildLedgerRecord(
          opts.organ,
          command,
          result.filterId,
          result.inputTokens,
          result.outputTokens,
          result.sacredSpanCount,
          result.status,
          output,
        ),
        opts.cwd,
      );
    } catch {
      // Ledger writes are evidence only; filtering remains fail-closed.
    }
  }

  return { output: result.output, result };
}

function normalizeSacredBypass(result: FilterResult, rawOutput: string): FilterResult {
  if (result.status !== 'sacred-bypass') {
    return result;
  }

  const inputTokens = estimateTokens(rawOutput);
  return {
    ...result,
    output: rawOutput,
    inputTokens,
    outputTokens: inputTokens,
    savedTokens: 0,
    savingsPercent: 0,
  };
}

export async function getEconomizedArtifactForContext(input: EconomizedArtifactInput): Promise<EconomizedArtifactContext> {
  const cwd = input.cwd ?? process.cwd();
  const resolvedPath = path.isAbsolute(input.path) ? input.path : path.join(cwd, input.path);
  const raw = await fsp.readFile(resolvedPath, 'utf8');
  const rawHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

  try {
    const result = compressArtifact(raw, input.type);
    return {
      path: resolvedPath,
      type: input.type,
      content: result.compressed,
      originalSize: result.originalSize,
      compressedSize: result.compressedSize,
      savingsPercent: result.savingsPercent,
      sacredSpanCount: result.sacredSpans.length,
      rawHash,
    };
  } catch {
    const size = Buffer.byteLength(raw, 'utf8');
    return {
      path: resolvedPath,
      type: input.type,
      content: raw,
      originalSize: size,
      compressedSize: size,
      savingsPercent: 0,
      sacredSpanCount: 0,
      rawHash,
    };
  }
}

export async function scoreContextEconomy(
  cwd: string,
  opts: ContextEconomyScoreOptions = {},
): Promise<ContextEconomyScoreReport> {
  const records = filterLedgerRecords(await loadAllLedgerRecords(cwd), opts);
  return buildScoreReport(cwd, records, opts);
}

export function scoreContextEconomySync(
  cwd: string,
  opts: ContextEconomyScoreOptions = {},
): ContextEconomyScoreReport {
  const records = filterLedgerRecords(loadAllLedgerRecordsSync(cwd), opts);
  return buildScoreReport(cwd, records, opts);
}

export function filterLedgerRecords(records: LedgerRecord[], opts: ContextEconomyScoreOptions = {}): LedgerRecord[] {
  const sinceMs = opts.since ? parseSince(opts.since) : undefined;
  return records.filter((record) => {
    if (opts.organ && record.organ !== opts.organ) return false;
    if (sinceMs !== undefined) {
      const recordMs = Date.parse(record.timestamp);
      if (Number.isNaN(recordMs) || recordMs < sinceMs) return false;
    }
    return true;
  });
}

function parseSince(since: string): number | undefined {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(since) ? `${since}T00:00:00.000Z` : since;
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function buildScoreReport(
  cwd: string,
  records: LedgerRecord[],
  opts: ContextEconomyScoreOptions,
): ContextEconomyScoreReport {
  const summary = summarizeLedger(records);
  const coverage = scoreCoverage(cwd);
  const telemetry = summary.totalRecords === 0
    ? 0
    : Math.min(25, 10 + (summary.totalRecords * 3) + (new Set(records.map((record) => record.organ)).size * 2));
  const savings = Math.min(20, Math.round((summary.averageSavingsPercent / 60) * 20));
  const sacredSafety = scoreSacredSafety(summary);
  const artifactCompression = scoreArtifactCompression(cwd);
  const subscores = {
    coverage,
    telemetry,
    savings,
    sacredSafety,
    artifactCompression,
  };
  const score = Math.min(100, Object.values(subscores).reduce((sum, value) => sum + value, 0));

  return {
    score,
    subscores,
    recordsInWindow: records.length,
    summary,
    ...(opts.since ? { since: opts.since } : {}),
    ...(opts.organ ? { organ: opts.organ } : {}),
  };
}

function scoreCoverage(cwd: string): number {
  const base = path.join(cwd, 'src', 'core', 'context-economy');
  const presentModules = REQUIRED_MODULES.filter((moduleName) => fs.existsSync(path.join(base, `${moduleName}.ts`))).length;
  const moduleScore = Math.round((presentModules / REQUIRED_MODULES.length) * 20);

  const filtersDir = path.join(base, 'filters');
  const presentFilters = REQUIRED_FILTERS.filter((filterName) => fs.existsSync(path.join(filtersDir, `${filterName}.ts`))).length;
  const filterScore = Math.round((presentFilters / REQUIRED_FILTERS.length) * 10);

  return moduleScore + filterScore;
}

function scoreSacredSafety(summary: LedgerSummary): number {
  if (summary.totalRecords === 0) return 0;
  if (summary.filterFailed > 0) {
    return summary.sacredBypass > 0 ? 6 : 3;
  }
  return 8 + (summary.sacredBypass > 0 ? 7 : 0);
}

function scoreArtifactCompression(cwd: string): number {
  const base = path.join(cwd, 'src', 'core', 'context-economy');
  const hasCompressor = fs.existsSync(path.join(base, 'artifact-compressor.ts'));
  const hasRuntime = fs.existsSync(path.join(base, 'runtime.ts'));
  if (hasCompressor && hasRuntime) return 10;
  if (hasCompressor || hasRuntime) return 5;
  return 0;
}

function loadAllLedgerRecordsSync(cwd: string): LedgerRecord[] {
  const dir = path.join(cwd, LEDGER_DIR);
  try {
    return fs.readdirSync(dir)
      .filter((file) => file.endsWith('.jsonl'))
      .sort()
      .flatMap((file) => loadLedgerFileSync(path.join(dir, file)));
  } catch {
    return [];
  }
}

function loadLedgerFileSync(filePath: string): LedgerRecord[] {
  try {
    return fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerRecord);
  } catch {
    return [];
  }
}
