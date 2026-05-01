#!/usr/bin/env node
// Full DELEGATE-52 live run launcher.
//
// This is the GATE-1 path: 48 public domains, 10 round-trips per domain,
// surgical-patch mitigation, and a hard default budget cap of $160.
// It auto-loads project .env only for local operator convenience and writes
// a redacted command receipt next to the final validation JSON.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const BUDGET_USD = Number.parseFloat(process.env.DANTEFORGE_DELEGATE52_BUDGET_USD ?? '160');
const MAX_DOMAINS = Number.parseInt(process.env.DANTEFORGE_DELEGATE52_MAX_DOMAINS ?? '48', 10);
const ROUND_TRIPS = Number.parseInt(process.env.DANTEFORGE_DELEGATE52_ROUND_TRIPS ?? '10', 10);
const RETRIES = Number.parseInt(process.env.DANTEFORGE_DELEGATE52_RETRIES ?? '3', 10);
const STRATEGY = process.env.DANTEFORGE_DELEGATE52_STRATEGY ?? 'surgical-patch';
const MODEL = process.env.DANTEFORGE_DELEGATE52_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
const RESUME_FROM = process.env.DANTEFORGE_DELEGATE52_RESUME_FROM
  ? resolve(ROOT, process.env.DANTEFORGE_DELEGATE52_RESUME_FROM)
  : null;
const PRIOR_SPEND_USD = Number.parseFloat(process.env.DANTEFORGE_DELEGATE52_PRIOR_SPEND_USD ?? '0');
const isDryRun = process.env.DANTEFORGE_DELEGATE52_DRY_RUN === '1';

function loadDotEnv() {
  const dotEnvPath = resolve(ROOT, '.env');
  if (!existsSync(dotEnvPath)) return;

  for (const line of readFileSync(dotEnvPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

function hasAnyCredential() {
  return Boolean(
    process.env.ANTHROPIC_API_KEY
      || process.env.DANTEFORGE_CLAUDE_API_KEY
      || process.env.DANTEFORGE_ANTHROPIC_API_KEY
      || process.env.DANTEFORGE_LLM_API_KEY,
  );
}

function fail(message, nextSteps = []) {
  console.error(`ERROR: ${message}`);
  for (const step of nextSteps) console.error(`  ${step}`);
  process.exit(1);
}

function preserveExistingFile(filePath, label) {
  if (!existsSync(filePath)) return null;
  const backupPath = `${filePath}.previous-${timestamp}`;
  renameSync(filePath, backupPath);
  console.log(`Preserved previous ${label}: ${backupPath}`);
  return backupPath;
}

loadDotEnv();

if (!Number.isFinite(BUDGET_USD) || BUDGET_USD <= 0) {
  fail('DANTEFORGE_DELEGATE52_BUDGET_USD must be a positive number.');
}
if (!Number.isFinite(PRIOR_SPEND_USD) || PRIOR_SPEND_USD < 0) {
  fail('DANTEFORGE_DELEGATE52_PRIOR_SPEND_USD must be zero or a positive number.');
}
if (RESUME_FROM && !existsSync(RESUME_FROM)) {
  fail(`resume output directory does not exist: ${RESUME_FROM}`);
}

if (!isDryRun && !hasAnyCredential()) {
  fail('No live LLM credential found.', [
    'Set ANTHROPIC_API_KEY in the shell or project .env.',
    'Or set DANTEFORGE_CLAUDE_API_KEY / DANTEFORGE_ANTHROPIC_API_KEY / DANTEFORGE_LLM_API_KEY.',
  ]);
}

const datasetPath = resolve(ROOT, '.danteforge', 'datasets', 'delegate52-public.jsonl');
if (!existsSync(datasetPath)) {
  fail(`dataset missing at ${datasetPath}`, [
    'Fetch the public DELEGATE-52 dataset first; do not substitute fabricated rows.',
  ]);
}

const distPath = resolve(ROOT, 'dist', 'index.js');
if (!existsSync(distPath)) {
  fail(`dist not built at ${distPath}`, ['Run npm run build first.']);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = RESUME_FROM ?? resolve(ROOT, '.danteforge', 'evidence', `delegate52-live-full-${timestamp}`);
mkdirSync(outDir, { recursive: true });

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
  '--mitigation-strategy', STRATEGY,
  '--out', outDir,
  '--json',
];

if (RESUME_FROM) {
  args.push('--resume-from', RESUME_FROM);
}
if (Number.isFinite(PRIOR_SPEND_USD) && PRIOR_SPEND_USD > 0) {
  args.push('--prior-spend-usd', String(PRIOR_SPEND_USD));
}

const env = {
  ...process.env,
  DANTEFORGE_DELEGATE52_LIVE: '1',
  DANTEFORGE_CLAUDE_API_KEY: process.env.DANTEFORGE_CLAUDE_API_KEY
    ?? process.env.ANTHROPIC_API_KEY
    ?? process.env.DANTEFORGE_ANTHROPIC_API_KEY,
  DANTEFORGE_LLM_TIMEOUT_MS: process.env.DANTEFORGE_LLM_TIMEOUT_MS ?? '300000',
  DANTEFORGE_DELEGATE52_MODEL: MODEL,
};

const redactedReceipt = {
  createdAt: new Date().toISOString(),
  cwd: ROOT,
  outDir,
  resumeFrom: RESUME_FROM,
  priorSpendUsd: Number.isFinite(PRIOR_SPEND_USD) ? PRIOR_SPEND_USD : 0,
  command: [process.execPath, ...args],
  env: {
    DANTEFORGE_DELEGATE52_LIVE: env.DANTEFORGE_DELEGATE52_LIVE,
    DANTEFORGE_DELEGATE52_DRY_RUN: env.DANTEFORGE_DELEGATE52_DRY_RUN ?? null,
    DANTEFORGE_LLM_TIMEOUT_MS: env.DANTEFORGE_LLM_TIMEOUT_MS,
    DANTEFORGE_DELEGATE52_MODEL: env.DANTEFORGE_DELEGATE52_MODEL,
    hasCredential: hasAnyCredential(),
  },
};
const commandPath = resolve(outDir, 'command.json');
preserveExistingFile(commandPath, 'command receipt');
writeFileSync(commandPath, `${JSON.stringify(redactedReceipt, null, 2)}\n`, 'utf8');

console.log('DELEGATE-52 full live run');
console.log('=========================');
console.log(`  budget cap:     $${BUDGET_USD}`);
console.log(`  domains:        ${MAX_DOMAINS}`);
console.log(`  round-trips:    ${ROUND_TRIPS}`);
console.log(`  retries:        ${RETRIES}`);
console.log(`  strategy:       ${STRATEGY}`);
console.log(`  model:          ${MODEL}`);
console.log(`  dry run:        ${isDryRun ? 'yes' : 'no'}`);
console.log(`  resume from:    ${RESUME_FROM ?? 'no'}`);
console.log(`  prior spend:    $${Number.isFinite(PRIOR_SPEND_USD) ? PRIOR_SPEND_USD : 0}`);
console.log(`  output dir:     ${outDir}`);
console.log('');
console.log('Starting...');
console.log('');

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
  const stdoutPath = resolve(outDir, 'stdout.json');
  const stderrPath = resolve(outDir, 'stderr.log');
  preserveExistingFile(stdoutPath, 'stdout log');
  preserveExistingFile(stderrPath, 'stderr log');
  writeFileSync(stdoutPath, stdout, 'utf8');
  writeFileSync(stderrPath, stderr, 'utf8');

  try {
    const parsed = JSON.parse(stdout);
    writeFileSync(resolve(outDir, 'result.json'), `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    const d = parsed?.classes?.D;
    console.log('');
    console.log('Full run completed.');
    console.log(`  exit code:  ${code}`);
    console.log(`  result:     ${resolve(outDir, 'result.json')}`);
    if (d) {
      console.log('');
      console.log('Class D summary:');
      console.log(`  status:                        ${d.status}`);
      console.log(`  total cost USD:                $${(d.totalCostUsd ?? 0).toFixed(4)}`);
      console.log(`  budget exhausted:              ${d.budgetExhausted ? 'yes' : 'no'}`);
      console.log(`  raw corruption rate:           ${((d.rawCorruptionRate ?? 0) * 100).toFixed(1)}%`);
      console.log(`  user-observed corruption rate: ${((d.userObservedCorruptionRate ?? 0) * 100).toFixed(1)}%`);
      console.log(`  retries:                       ${d.totalRetries ?? 0}`);
      console.log(`  unmitigated divergences:       ${d.totalUnmitigatedDivergences ?? 0}`);
      console.log(`  causal-source identification:  ${((d.causalSourceIdentificationRate ?? 0) * 100).toFixed(1)}%`);
    }
  } catch {
    console.log('');
    console.log('Full run ended, but stdout was not valid JSON.');
    console.log(`  exit code:  ${code}`);
    console.log(`  stdout:     ${stdoutPath}`);
    console.log(`  stderr:     ${stderrPath}`);
  }

  process.exit(code ?? 0);
});
