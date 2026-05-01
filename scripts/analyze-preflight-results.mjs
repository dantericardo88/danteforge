#!/usr/bin/env node
// Analyze preflight DELEGATE-52 results across one or more strategy runs.
// Strips CLI log noise, parses result JSON, and prints the metrics that matter:
// raw LLM drift, final user-visible corruption, retry spend, and D3 attribution.

import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('Usage: node scripts/analyze-preflight-results.mjs <result-file> [<result-file> ...]');
  process.exit(1);
}

function stripLogLines(content) {
  return content
    .split('\n')
    .filter(line => !line.startsWith('[INFO]') && !line.startsWith('[OK]') && !line.startsWith('[WARN]') && !line.startsWith('[ERROR]'))
    .join('\n');
}

function loadResult(path) {
  if (!existsSync(path)) {
    console.error(`SKIP ${path}: file not found`);
    return null;
  }
  const raw = readFileSync(path, 'utf-8');
  const cleaned = stripLogLines(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`SKIP ${path}: parse error: ${err.message}`);
    return null;
  }
}

function fmtPct(value) {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function fmtUsd(value) {
  return `$${(value ?? 0).toFixed(4)}`;
}

function normalizedMetrics(d) {
  const rows = d.domainRows ?? [];
  const rawDivergedDomains = rows.filter(row => (row.totalDivergences ?? 0) > 0).length;
  const finalCorruptedDomains = rows.filter(row => row.byteIdenticalAfterRoundTrips === false).length;
  return {
    rawCorruptionRate: rows.length > 0 ? rawDivergedDomains / rows.length : (d.rawCorruptionRate ?? 0),
    userObservedCorruptionRate: rows.length > 0 ? finalCorruptedDomains / rows.length : (d.userObservedCorruptionRate ?? 0),
  };
}

console.log('Preflight DELEGATE-52 results');
console.log('='.repeat(60));

for (const input of inputs) {
  const path = resolve(input);
  const j = loadResult(path);
  if (!j) continue;
  const d = j?.classes?.D;
  if (!d) {
    console.log(`\n${basename(path)}: no Class D result in this file`);
    continue;
  }
  const metrics = normalizedMetrics(d);
  console.log('');
  console.log(`File: ${basename(path)}`);
  console.log(`Strategy: ${d.mitigation?.strategy ?? 'unknown'}`);
  console.log(`Status: ${d.status}`);
  console.log(`Cost: ${fmtUsd(d.totalCostUsd)}`);
  console.log(`Domains: ${d.domainRows?.length ?? 0}`);
  console.log('');
  console.log('Aggregate:');
  console.log(`  raw LLM divergence rate (any failed attempt):      ${fmtPct(metrics.rawCorruptionRate)}`);
  console.log(`  user-visible final corruption (final bytes dirty): ${fmtPct(metrics.userObservedCorruptionRate)}`);
  console.log(`  total divergences observed (any retry attempt):    ${d.totalDivergencesObserved ?? 0}`);
  console.log(`  total retries used:                                ${d.totalRetries ?? 0}`);
  console.log(`  mitigated divergences (retry/substrate repaired):  ${d.totalMitigatedDivergences ?? 0}`);
  console.log(`  unrecovered LLM divergences (retry exhausted):     ${d.totalUnmitigatedDivergences ?? 0}`);
  console.log(`  oscillated divergences (cycle detected):           ${d.totalOscillatedDivergences ?? 0}`);
  console.log(`  gracefully degraded (workspace restored clean):    ${d.totalGracefullyDegradedDivergences ?? 0}`);
  console.log(`  causal-source identification rate (Pass 39):       ${fmtPct(d.causalSourceIdentificationRate)} (${d.totalCausalSourceIdentified ?? 0}/${d.totalDivergencesObserved ?? 0})`);
  console.log('');
  console.log('Per domain:');
  console.log('  domain                | byteId | divs | retries | mit | unrec | osc | clean | docSrc');
  for (const row of d.domainRows ?? []) {
    const byteId = row.byteIdenticalAfterRoundTrips ? 'YES' : 'no ';
    const divs = String(row.totalDivergences ?? 0).padStart(4);
    const ret = String(row.retryCount ?? 0).padStart(7);
    const mit = String(row.mitigatedDivergences ?? 0).padStart(3);
    const unmit = String(row.unmitigatedDivergences ?? 0).padStart(5);
    const osc = String(row.oscillatedDivergences ?? 0).padStart(3);
    const grace = String(row.gracefullyDegradedDivergences ?? 0).padStart(5);
    const src = row.documentSource ?? '?';
    const dom = (row.domain ?? '?').padEnd(20).slice(0, 20);
    console.log(`  ${dom}  | ${byteId}    | ${divs} | ${ret} | ${mit} | ${unmit} | ${osc} | ${grace} | ${src}`);
  }
}

console.log('');
console.log('='.repeat(60));
console.log('Comparison summary (if multiple files):');
const allResults = inputs.map(loadResult).filter(Boolean);
if (allResults.length >= 2) {
  console.log('');
  console.log('  strategy                   | cost   | userCorrupt | retries | mit | unrec | D3-rate');
  for (let i = 0; i < allResults.length; i += 1) {
    const d = allResults[i].classes?.D;
    if (!d) continue;
    const metrics = normalizedMetrics(d);
    const strat = (d.mitigation?.strategy ?? 'unknown').padEnd(26).slice(0, 26);
    const cost = fmtUsd(d.totalCostUsd).padStart(6);
    const uc = fmtPct(metrics.userObservedCorruptionRate).padStart(11);
    const ret = String(d.totalRetries ?? 0).padStart(7);
    const mit = String(d.totalMitigatedDivergences ?? 0).padStart(3);
    const unmit = String(d.totalUnmitigatedDivergences ?? 0).padStart(5);
    const d3 = fmtPct(d.causalSourceIdentificationRate).padStart(7);
    console.log(`  ${strat} | ${cost} | ${uc} | ${ret} | ${mit} | ${unmit} | ${d3}`);
  }
}
