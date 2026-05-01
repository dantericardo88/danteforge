#!/usr/bin/env node
// DELEGATE-52 live preflight smoke.
//
// This is an opt-in, tiny live check: $2 budget, 3 public domains,
// 1 round-trip per domain, and substrate restore/retry mitigation enabled.
// It is not GATE-1, does not update paper numbers, and should not be used
// as evidence for full DELEGATE-52 validation.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const BUDGET_USD = 2;
const MAX_DOMAINS = 3;
const ROUND_TRIPS = 1;
const RETRIES = 3;

// Auto-load .env from project root if ANTHROPIC_API_KEY is not already in the shell.
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
    'Run npm run delegate52:preflight only when you are ready to spend up to $2.',
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

const outDir = resolve(ROOT, '.danteforge', 'evidence', 'preflight-runs');
mkdirSync(outDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = resolve(outDir, `preflight-result-${timestamp}.json`);

const args = [
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
  '--mitigation-strategy', 'substrate-restore-retry',
  '--json',
];

console.log('DELEGATE-52 preflight smoke');
console.log('===========================');
console.log(`  budget cap:     $${BUDGET_USD}`);
console.log(`  domains:        ${MAX_DOMAINS}`);
console.log(`  round-trips:    ${ROUND_TRIPS}`);
console.log(`  retries:        ${RETRIES}`);
console.log('  status:         opt-in smoke, not GATE-1');
console.log(`  dataset:        ${datasetPath}`);
console.log(`  model:          ${process.env.ANTHROPIC_MODEL ?? 'provider default'}`);
console.log(`  output:         ${outPath}`);
console.log('');
console.log('Command:');
console.log(`  DANTEFORGE_DELEGATE52_LIVE=1 node ${args.map(arg => arg.includes(' ') ? JSON.stringify(arg) : arg).join(' ')}`);
console.log('');
console.log('Starting...');
console.log('');

// Bridge ANTHROPIC_API_KEY (the standard env name) to DANTEFORGE_CLAUDE_API_KEY (which the
// substrate's LLM caller actually reads), and bump the LLM request timeout to 120s so large
// imported documents (12KB+ basic_state files) don't time out at the 30s default. Pass 39+
// diff-attribution and Pass 36 oscillation detection both depend on the LLM call completing.
const env = {
  ...process.env,
  DANTEFORGE_DELEGATE52_LIVE: '1',
  DANTEFORGE_CLAUDE_API_KEY: process.env.DANTEFORGE_CLAUDE_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  DANTEFORGE_LLM_TIMEOUT_MS: process.env.DANTEFORGE_LLM_TIMEOUT_MS ?? '120000',
  DANTEFORGE_DELEGATE52_MODEL: process.env.DANTEFORGE_DELEGATE52_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
};
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
    writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    const d = parsed?.classes?.D;
    console.log('');
    console.log('Preflight completed.');
    console.log(`  exit code:  ${code}`);
    console.log(`  result:     ${outPath}`);
    if (d) {
      console.log('');
      console.log('Class D smoke summary:');
      console.log(`  status:                        ${d.status}`);
      console.log(`  total cost USD:                $${(d.totalCostUsd ?? 0).toFixed(4)}`);
      console.log(`  raw corruption rate:           ${((d.rawCorruptionRate ?? 0) * 100).toFixed(1)}%`);
      console.log(`  user-observed corruption rate: ${((d.userObservedCorruptionRate ?? 0) * 100).toFixed(1)}%`);
      console.log(`  retries:                       ${d.totalRetries ?? 0}`);
      console.log(`  unmitigated divergences:       ${d.totalUnmitigatedDivergences ?? 0}`);
      console.log(`  causal-source identification:  ${((d.causalSourceIdentificationRate ?? 0) * 100).toFixed(1)}%`);
    }
    process.exit(code ?? 0);
  } catch {
    console.error('');
    console.error('ERROR: failed to parse CLI output as JSON.');
    console.error(`  exit code: ${code}`);
    if (stderr.trim()) console.error(stderr.split('\n').map(line => `    ${line}`).join('\n'));
    process.exit(code ?? 1);
  }
});
