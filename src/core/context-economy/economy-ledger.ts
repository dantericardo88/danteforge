// Economy Ledger — JSONL telemetry writer for Context Economy Layer (PRD-26).
// Records per-command filter outcomes. No raw prompts, secrets, or private paths.

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { LedgerRecord, LedgerSummary, FilterStatus } from './types.js';

export type { LedgerRecord } from './types.js';

const LEDGER_DIR = '.danteforge/evidence/context-economy';

function ledgerPath(cwd: string, date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return path.join(cwd, LEDGER_DIR, `${d}.jsonl`);
}

export async function appendLedgerRecord(record: LedgerRecord, cwd: string): Promise<void> {
  const file = ledgerPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(record) + '\n', 'utf8');
}

export async function loadLedgerRecords(cwd: string, date?: string): Promise<LedgerRecord[]> {
  const file = ledgerPath(cwd, date);
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerRecord);
  } catch {
    return [];
  }
}

export async function loadAllLedgerRecords(cwd: string): Promise<LedgerRecord[]> {
  const dir = path.join(cwd, LEDGER_DIR);
  try {
    const files = await fs.readdir(dir);
    const jsonlFiles = files.filter((f) => f.endsWith('.jsonl')).sort();
    const all: LedgerRecord[] = [];
    for (const f of jsonlFiles) {
      const date = f.replace('.jsonl', '');
      const records = await loadLedgerRecords(cwd, date);
      all.push(...records);
    }
    return all;
  } catch {
    return [];
  }
}

export function buildLedgerRecord(
  organ: string,
  command: string,
  filterId: string,
  inputTokens: number,
  outputTokens: number,
  sacredSpanCount: number,
  status: FilterStatus,
  rawContent?: string,
): LedgerRecord {
  const savedTokens = Math.max(0, inputTokens - outputTokens);
  const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
  const rawEvidenceHash = rawContent
    ? crypto.createHash('sha256').update(rawContent).digest('hex').slice(0, 16)
    : undefined;
  return {
    timestamp: new Date().toISOString(),
    organ,
    command,
    filterId,
    inputTokens,
    outputTokens,
    savedTokens,
    savingsPercent,
    sacredSpanCount,
    status,
    ruleSource: 'built-in',
    ...(rawEvidenceHash !== undefined ? { rawEvidenceHash } : {}),
  };
}

export function summarizeLedger(records: LedgerRecord[]): LedgerSummary {
  const filterMap = new Map<string, { count: number; savedTokens: number }>();
  const passthroughMap = new Map<string, number>();

  let totalInput = 0;
  let totalOutput = 0;
  let totalSaved = 0;
  let filtered = 0;
  let passthrough = 0;
  let lowYield = 0;
  let sacredBypass = 0;
  let filterFailed = 0;

  for (const r of records) {
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
    totalSaved += r.savedTokens;

    switch (r.status) {
      case 'filtered': filtered++; break;
      case 'passthrough': passthrough++; break;
      case 'low-yield': lowYield++; break;
      case 'sacred-bypass': sacredBypass++; break;
      case 'filter-failed': filterFailed++; break;
    }

    if (r.status === 'filtered' || r.status === 'low-yield') {
      const prev = filterMap.get(r.filterId) ?? { count: 0, savedTokens: 0 };
      filterMap.set(r.filterId, { count: prev.count + 1, savedTokens: prev.savedTokens + r.savedTokens });
    }
    if (r.status === 'passthrough') {
      passthroughMap.set(r.command, (passthroughMap.get(r.command) ?? 0) + 1);
    }
  }

  const avgSavings = totalInput > 0 ? Math.round((totalSaved / totalInput) * 100) : 0;

  const topFilters = [...filterMap.entries()]
    .sort((a, b) => b[1].savedTokens - a[1].savedTokens)
    .slice(0, 5)
    .map(([filterId, v]) => ({ filterId, count: v.count, savedTokens: v.savedTokens }));

  const topPassthroughs = [...passthroughMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([command, count]) => ({ command, count }));

  return {
    totalRecords: records.length,
    filtered,
    passthrough,
    lowYield,
    sacredBypass,
    filterFailed,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalSavedTokens: totalSaved,
    averageSavingsPercent: avgSavings,
    topFilters,
    topPassthroughs,
  };
}

export function formatLedgerReport(summary: LedgerSummary, json?: boolean): string {
  if (json) return JSON.stringify(summary, null, 2);

  const pct = summary.averageSavingsPercent;
  const lines = [
    `Context Economy Report`,
    `─────────────────────`,
    `Total commands:   ${summary.totalRecords}`,
    `Filtered:         ${summary.filtered}`,
    `Passthrough:      ${summary.passthrough}`,
    `Low-yield:        ${summary.lowYield}`,
    `Sacred bypass:    ${summary.sacredBypass}`,
    `Filter failures:  ${summary.filterFailed}`,
    ``,
    `Tokens in:        ${summary.totalInputTokens.toLocaleString()}`,
    `Tokens out:       ${summary.totalOutputTokens.toLocaleString()}`,
    `Tokens saved:     ${summary.totalSavedTokens.toLocaleString()} (${pct}% avg)`,
    ``,
  ];

  if (summary.topFilters.length > 0) {
    lines.push('Top filters by savings:');
    for (const f of summary.topFilters) {
      lines.push(`  ${f.filterId.padEnd(20)} ${f.savedTokens.toLocaleString()} tokens saved (${f.count} calls)`);
    }
    lines.push('');
  }

  if (summary.topPassthroughs.length > 0) {
    lines.push('Top passthrough commands (no filter):');
    for (const p of summary.topPassthroughs) {
      lines.push(`  ${p.command.padEnd(20)} ${p.count} calls`);
    }
  }

  return lines.join('\n');
}
