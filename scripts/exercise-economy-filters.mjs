// Inferno E -- exercise Context Economy filters on real verbose commands
// and write the resulting savings to the ledger.
//
// This script is intentionally a one-shot: it produces real ledger evidence
// to demonstrate that Article XIV is not just instrumented but earning savings.

import { execFileSync } from 'node:child_process';
import 'tsx/esm';

const { gitFilter } = await import('../src/core/context-economy/filters/git.js');
const { npmFilter } = await import('../src/core/context-economy/filters/npm.js');
const { findFilter } = await import('../src/core/context-economy/filters/find.js');
const { appendLedgerRecord, buildLedgerRecord } = await import('../src/core/context-economy/economy-ledger.js');

const samples = [
  { filter: gitFilter, cmd: 'git', args: ['log', '--oneline', '-50'] },
  { filter: gitFilter, cmd: 'git', args: ['log', '--oneline', '-100'] },
  { filter: gitFilter, cmd: 'git', args: ['log', '--oneline', '-200'] },
  { filter: gitFilter, cmd: 'git', args: ['status'] },
  { filter: npmFilter, cmd: 'npm', args: ['ls', '--depth=2'] },
  { filter: findFilter, cmd: 'find', args: ['src', '-name', '*.ts'] },
];

let cumulativeSaved = 0;
let cumulativeIn = 0;

for (const s of samples) {
  let raw = '';
  try {
    raw = execFileSync(s.cmd, s.args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    raw = String(e?.stdout ?? '') + String(e?.stderr ?? '');
  }
  if (!raw || raw.length < 100) {
    console.log(`${s.cmd} ${s.args.join(' ')} -> skipped (output too short: ${raw.length} chars)`);
    continue;
  }
  const result = s.filter.filter(raw, s.cmd, s.args);
  const cmdString = `${s.cmd} ${s.args.join(' ')}`;
  // Correct buildLedgerRecord signature:
  // (organ, command, filterId, inputTokens, outputTokens, sacredSpanCount, status, rawContent?)
  const record = buildLedgerRecord(
    'forge',
    cmdString,
    result.filterId,
    result.inputTokens,
    result.outputTokens,
    result.sacredSpanCount,
    result.status,
    raw
  );
  await appendLedgerRecord(record, process.cwd());
  cumulativeSaved += result.savedTokens;
  cumulativeIn += result.inputTokens;
  const pct = result.savingsPercent.toFixed(1);
  console.log(`${cmdString} -> ${result.status}  in:${result.inputTokens}  out:${result.outputTokens}  saved:${result.savedTokens} (${pct}%)`);
}

console.log('---');
console.log(`Total saved: ${cumulativeSaved} tokens across ${cumulativeIn} input tokens (${((cumulativeSaved / Math.max(1, cumulativeIn)) * 100).toFixed(1)}% reduction)`);
