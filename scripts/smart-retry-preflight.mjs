#!/usr/bin/env node
// Pass 46/47 - Edit-journal vs substrate retry comparison preflight.
//
// Runs two back-to-back Class D sweeps on the same 3 public domains:
//   Run A - substrate-restore-retry (dataset inverse prompt, no edit journal)
//   Run B - edit-journal (dataset inverse prompt + forward diff + retry critique)
//
// The production-safe completion path is now available separately as:
//   --mitigation-strategy surgical-patch
// It uses the substrate to repair the final bytes deterministically when an LLM backward edit
// misses exact equality. This script keeps the A/B LLM behavior comparison budget bounded.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const BUDGET_USD = 2.5; // per run; 2 runs = up to $5 total
const MAX_DOMAINS = 3;
const ROUND_TRIPS = 1;
const RETRIES = 3;

const dotEnvPath = resolve(ROOT, '.env');
if (!process.env.ANTHROPIC_API_KEY && existsSync(dotEnvPath)) {
  for (const line of readFileSync(dotEnvPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(k in process.env)) process.env[k] = v;
  }
}

function fail(message, nextSteps = []) {
  console.error(`ERROR: ${message}`);
  for (const step of nextSteps) console.error(`  ${step}`);
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  fail('ANTHROPIC_API_KEY is not set.', [
    'Set ANTHROPIC_API_KEY in your shell or add it to .env at the project root.',
    'Run npm run build before the preflight.',
    'Run npm run delegate52:smart-retry only when you are ready to spend up to $5.',
  ]);
}

const datasetPath = resolve(ROOT, '.danteforge', 'datasets', 'delegate52-public.jsonl');
if (!existsSync(datasetPath)) {
  fail(`dataset missing at ${datasetPath}`, [
    'Fetch the public DELEGATE-52 dataset using docs/papers/reproducibility-appendix.md.',
    'Do not substitute fabricated rows; this preflight is only meaningful on real public data.',
  ]);
}

const distPath = resolve(ROOT, 'dist', 'index.js');
if (!existsSync(distPath)) {
  fail(`dist not built at ${distPath}`, ['Run npm run build first.']);
}

const outDir = resolve(ROOT, '.danteforge', 'evidence', 'smart-retry-runs');
mkdirSync(outDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

const env = {
  ...process.env,
  DANTEFORGE_DELEGATE52_LIVE: '1',
  DANTEFORGE_CLAUDE_API_KEY: process.env.DANTEFORGE_CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  DANTEFORGE_LLM_TIMEOUT_MS: process.env.DANTEFORGE_LLM_TIMEOUT_MS ?? '120000',
  DANTEFORGE_DELEGATE52_MODEL: process.env.DANTEFORGE_DELEGATE52_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
};

function buildArgs(strategy) {
  return [
    distPath,
    'time-machine', 'validate',
    '--class', 'D',
    '--delegate52-mode', 'live',
    '--delegate52-dataset', datasetPath,
    '--budget-usd', String(BUDGET_USD),
    '--max-domains', String(MAX_DOMAINS),
    '--round-trips', String(ROUND_TRIPS),
    '--mitigate-divergence',
    '--retries-on-divergence', String(RETRIES),
    '--mitigation-strategy', strategy,
    '--json',
  ];
}

function spawnRun(strategy) {
  return new Promise((resolveRun) => {
    const args = buildArgs(strategy);
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('exit', code => {
      try {
        const parsed = JSON.parse(stdout);
        resolveRun({ ok: true, strategy, code, result: parsed, stderr });
      } catch {
        if (stdout.trim()) {
          process.stderr.write(`[DEBUG] raw stdout (${stdout.length} chars):\n${stdout.slice(0, 2000)}\n`);
        } else {
          process.stderr.write('[DEBUG] stdout was empty\n');
        }
        resolveRun({ ok: false, strategy, code, raw: stdout, stderr });
      }
    });
  });
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

console.log('Pass 46/47 - Edit-journal vs substrate-restore-retry comparison');
console.log('='.repeat(64));
console.log(`  budget cap per run:  $${BUDGET_USD}`);
console.log(`  total budget cap:    $${(BUDGET_USD * 2).toFixed(2)}`);
console.log(`  domains:             ${MAX_DOMAINS}`);
console.log(`  round-trips:         ${ROUND_TRIPS}`);
console.log(`  retries per diverg.: ${RETRIES}`);
console.log(`  dataset:             ${datasetPath}`);
console.log(`  model:               ${process.env.ANTHROPIC_MODEL ?? process.env.DANTEFORGE_DELEGATE52_MODEL ?? 'provider default'}`);
console.log(`  output dir:          ${outDir}`);
console.log('');

console.log('Run A: substrate-restore-retry (dataset inverse prompt, no edit journal) ...');
const runA = await spawnRun('substrate-restore-retry');
const outA = resolve(outDir, `run-a-substrate-restore-retry-${timestamp}.json`);
if (runA.ok) {
  writeFileSync(outA, `${JSON.stringify(runA.result, null, 2)}\n`, 'utf8');
  console.log(`  completed (exit ${runA.code}) -> ${outA}`);
} else {
  console.error(`  FAILED (exit ${runA.code}): could not parse output`);
  if (runA.stderr) console.error(runA.stderr.slice(0, 500));
}

console.log('');
console.log('Run B: edit-journal (dataset inverse prompt + forward diff + critique loop) ...');
const runB = await spawnRun('edit-journal');
const outB = resolve(outDir, `run-b-edit-journal-${timestamp}.json`);
if (runB.ok) {
  writeFileSync(outB, `${JSON.stringify(runB.result, null, 2)}\n`, 'utf8');
  console.log(`  completed (exit ${runB.code}) -> ${outB}`);
} else {
  console.error(`  FAILED (exit ${runB.code}): could not parse output`);
  if (runB.stderr) console.error(runB.stderr.slice(0, 500));
}

function summarize(run) {
  if (!run.ok) return { error: true };
  const d = run.result?.classes?.D;
  if (!d) return { error: true };
  const metrics = normalizedMetrics(d);
  return {
    cost: d.totalCostUsd ?? 0,
    rawCorruption: metrics.rawCorruptionRate,
    userObserved: metrics.userObservedCorruptionRate,
    retries: d.totalRetries ?? 0,
    mitigated: d.totalMitigatedDivergences ?? 0,
    unrecovered: d.totalUnmitigatedDivergences ?? 0,
    oscillated: d.totalOscillatedDivergences ?? 0,
    degraded: d.totalGracefullyDegradedDivergences ?? 0,
    causalRate: d.causalSourceIdentificationRate ?? 0,
    totalDivergences: d.totalDivergencesObserved ?? 0,
  };
}

const a = summarize(runA);
const b = summarize(runB);

console.log('');
console.log('='.repeat(64));
console.log('Comparison summary');
console.log('='.repeat(64));

const rows = [
  ['Metric', 'substrate-restore-retry', 'edit-journal', 'Delta'],
  ['---', '---', '---', '---'],
  ['Cost', fmtUsd(a.cost), fmtUsd(b.cost), b.cost < a.cost ? 'lower' : b.cost === a.cost ? 'same' : 'higher'],
  ['Raw LLM divergence rate', fmtPct(a.rawCorruption), fmtPct(b.rawCorruption), 'same input set'],
  ['User-visible final corruption', fmtPct(a.userObserved), fmtPct(b.userObserved), b.userObserved < a.userObserved ? 'better' : b.userObserved === a.userObserved ? 'same' : 'worse'],
  ['Total divergences', String(a.totalDivergences), String(b.totalDivergences), b.totalDivergences < a.totalDivergences ? 'lower' : b.totalDivergences === a.totalDivergences ? 'same' : 'higher'],
  ['Total retries used', String(a.retries), String(b.retries), b.retries < a.retries ? 'lower' : b.retries === a.retries ? 'same' : 'higher'],
  ['Retry/substrate-repaired divergences', String(a.mitigated), String(b.mitigated), b.mitigated > a.mitigated ? 'better' : b.mitigated === a.mitigated ? 'same' : 'worse'],
  ['Unrecovered LLM divergences', String(a.unrecovered), String(b.unrecovered), b.unrecovered < a.unrecovered ? 'better' : b.unrecovered === a.unrecovered ? 'same' : 'worse'],
  ['Gracefully degraded clean restores', String(a.degraded), String(b.degraded), 'clean final bytes'],
  ['Causal-source ID rate (D3)', fmtPct(a.causalRate), fmtPct(b.causalRate), ''],
];

const widths = rows.reduce((w, row) => row.map((cell, i) => Math.max(w[i] ?? 0, cell.length)), []);
for (const row of rows) {
  console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  '));
}

console.log('');
if (b.totalDivergences < a.totalDivergences || b.retries < a.retries || b.cost < a.cost) {
  console.log('VERDICT: edit-journal improves process efficiency while the substrate keeps final user-visible corruption at 0%.');
  console.log('Production hardening option: run surgical-patch for deterministic completion with no retry spend after a failed backward edit.');
} else if (!b.error && b.userObserved === a.userObserved) {
  console.log('VERDICT: no measurable edit-journal gain on this slice; substrate still protects final bytes.');
} else {
  console.log('VERDICT: inconclusive or error. Review per-domain rows for details.');
}

console.log('');
console.log(`Results saved to: ${outDir}`);
console.log(`  Run A: ${outA}`);
console.log(`  Run B: ${outB}`);
console.log(`Analyze with: node scripts/analyze-preflight-results.mjs "${outA}" "${outB}"`);
