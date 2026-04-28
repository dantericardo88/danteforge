// Phase H — read .danteforge/token-roi.jsonl (and any context-economy ledger)
// to compute the build's cumulative LLM cost. Closes PRD-MASTER §15 #8 by
// providing a measurement surface; the actual figure depends on what runs
// have happened.

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const cwd = process.cwd();

let totalUsd = 0;
let totalTokensIn = 0;
let totalTokensOut = 0;
let totalSavedTokens = 0;
const sources = [];

const tokenRoiPath = resolve(cwd, '.danteforge/token-roi.jsonl');
if (existsSync(tokenRoiPath)) {
  const lines = readFileSync(tokenRoiPath, 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
  let waveCost = 0;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (typeof e.costEstimatedUsd === 'number') waveCost += e.costEstimatedUsd;
      if (typeof e.tokensIn === 'number') totalTokensIn += e.tokensIn;
      if (typeof e.tokensOut === 'number') totalTokensOut += e.tokensOut;
    } catch { /* skip malformed */ }
  }
  totalUsd += waveCost;
  sources.push({ name: 'token-roi.jsonl', records: lines.length, costUsd: waveCost });
}

const ledgerDir = resolve(cwd, '.danteforge/evidence/context-economy');
if (existsSync(ledgerDir)) {
  let ledgerSaved = 0;
  let ledgerLines = 0;
  let ledgerInTokens = 0;
  let ledgerOutTokens = 0;
  for (const f of readdirSync(ledgerDir)) {
    if (!f.endsWith('.jsonl')) continue;
    const lines = readFileSync(resolve(ledgerDir, f), 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
    ledgerLines += lines.length;
    for (const l of lines) {
      try {
        const e = JSON.parse(l);
        if (typeof e.savedTokens === 'number') ledgerSaved += e.savedTokens;
        if (typeof e.inputTokens === 'number') ledgerInTokens += e.inputTokens;
        if (typeof e.outputTokens === 'number') ledgerOutTokens += e.outputTokens;
      } catch { /* skip */ }
    }
  }
  totalSavedTokens += ledgerSaved;
  sources.push({ name: 'context-economy ledger', records: ledgerLines, savedTokens: ledgerSaved, inputTokens: ledgerInTokens, outputTokens: ledgerOutTokens });
}

const summary = {
  computedAt: new Date().toISOString(),
  prdReference: 'PRD-MASTER §15 Success Metric #8',
  threshold: 200,
  totalUsd: Number(totalUsd.toFixed(4)),
  totalTokensIn,
  totalTokensOut,
  totalSavedTokens,
  meetsThreshold: totalUsd <= 200,
  sources,
  note: 'This build was largely deterministic (no LLM calls from Claude Code itself); the surface exists to measure future LLM-driven runs.'
};

const evidenceDir = resolve(cwd, '.danteforge/evidence');
mkdirSync(evidenceDir, { recursive: true });
const out = resolve(evidenceDir, 'build-cost.json');
writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf-8');

console.log(`Build cost summary:`);
console.log(`  total USD: $${summary.totalUsd.toFixed(4)}`);
console.log(`  total tokens in: ${summary.totalTokensIn.toLocaleString()}`);
console.log(`  total tokens out: ${summary.totalTokensOut.toLocaleString()}`);
console.log(`  context-economy saved tokens: ${summary.totalSavedTokens.toLocaleString()}`);
console.log(`  threshold ($200): ${summary.meetsThreshold ? 'PASS' : 'EXCEEDED'}`);
console.log(`  written to ${out}`);
