// PreToolUse Adapter — inspects pending shell commands and decides filter/passthrough (PRD-26).
// Fail-closed: if parsing or trust rules fail, the original output enters context unchanged.

import { defaultRegistry } from './command-filter-registry.js';
import { buildLedgerRecord, appendLedgerRecord } from './economy-ledger.js';
import type { FilterResult } from './types.js';

export interface PreToolDecision {
  action: 'filter' | 'passthrough';
  filterId: string;
  reason?: string;
}

export interface PreToolAdapterOptions {
  organ?: string;
  cwd?: string;
  writeLedger?: boolean;
  _registry?: typeof defaultRegistry;
  _ledgerWriter?: typeof appendLedgerRecord;
}

function parseCommandLine(raw: string): { command: string; args: string[] } {
  const parts = raw.trim().split(/\s+/);
  const command = parts[0] ?? '';
  const args = parts.slice(1);
  return { command, args };
}

function isUnsafeShellForm(raw: string): boolean {
  // Heredocs, pipes-with-complex-substitution, and process substitution are not safe to rewrite.
  return /<<|>[>&]|\$\(|\`/.test(raw);
}

export function decidePendingCommand(
  rawCommand: string,
  _opts: PreToolAdapterOptions = {},
): PreToolDecision {
  if (isUnsafeShellForm(rawCommand)) {
    return { action: 'passthrough', filterId: 'passthrough', reason: 'unsafe shell form' };
  }

  const registry = _opts._registry ?? defaultRegistry;
  const { command, args } = parseCommandLine(rawCommand);
  const { filterStatus, filter } = registry.lookup(command, args);

  if (filterStatus === 'passthrough' || filter === null) {
    return { action: 'passthrough', filterId: 'passthrough', reason: 'no filter registered' };
  }

  return { action: 'filter', filterId: filter.filterId };
}

export async function filterOutput(
  rawCommand: string,
  output: string,
  opts: PreToolAdapterOptions = {},
): Promise<FilterResult> {
  const registry = opts._registry ?? defaultRegistry;
  const ledgerWriter = opts._ledgerWriter ?? appendLedgerRecord;
  const organ = opts.organ ?? 'forge';
  const cwd = opts.cwd ?? process.cwd();

  let result: FilterResult & { command: string };

  try {
    if (isUnsafeShellForm(rawCommand)) {
      const { command } = parseCommandLine(rawCommand);
      result = registry.apply(output, 'passthrough', [command]);
      result.status = 'passthrough';
    } else {
      const { command, args } = parseCommandLine(rawCommand);
      result = registry.apply(output, command, args);
    }
  } catch {
    // Fail-closed: return raw output, record failure.
    const { estimateTokens } = await import('../token-estimator.js');
    const tokens = estimateTokens(output);
    result = {
      command: rawCommand,
      output,
      status: 'filter-failed',
      inputTokens: tokens,
      outputTokens: tokens,
      savedTokens: 0,
      savingsPercent: 0,
      sacredSpanCount: 0,
      filterId: 'adapter-error',
    };
  }

  if (opts.writeLedger !== false) {
    try {
      const record = buildLedgerRecord(
        organ,
        result.command,
        result.filterId,
        result.inputTokens,
        result.outputTokens,
        result.sacredSpanCount,
        result.status,
      );
      await ledgerWriter(record, cwd);
    } catch {
      // Ledger write failure never blocks the filter result.
    }
  }

  return result;
}
