#!/usr/bin/env node
// REAL SWE-bench-lite grounding (CH-033) — the honest hard frontier, distinct from the toy
// @dantecode swe-bench-runner. End to end:
//   1. fetch REAL published instances (princeton-nlp/SWE-bench_Lite via HF datasets-server)
//   2. SOLVE: clone the real repo at base_commit, run an agentic solver (default: `claude -p` editing
//      files in the repo) given ONLY the problem_statement (never the tests/gold patch), then `git diff`
//   3. write predictions.jsonl ({instance_id, model_name_or_path, model_patch})
//   4. GRADE with the OFFICIAL swebench harness in DOCKER (real Linux per-instance test env) — the
//      truly-external grader we do not author. A Windows `resource` shim lets the host orchestrator run.
//   5. parse the report → emit the pass_rate line external-benchmark-runner.parsePassRate reads.
//
// Usage:
//   node scripts/run-swebench-grounding.mjs --limit 1 [--offset 0] [--solver "claude -p"]
//                                           [--run-id <id>] [--work <dir>] [--solve-timeout-ms N]
//
// HONEST EXPECTATION: the first real pass_rate will likely be 0 or very low — solving real GitHub
// issues is the capability frontier. A real 0/1 through the official grader is honest grounding; the
// climb (a better solver) is the depth work. This run is COMPUTE + DOCKER heavy (GB image pulls).

import 'tsx/esm';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { get as httpsGet } from 'node:https';

const {
  parseDatasetRows, toSolverInput, buildPredictionLine, parseSwebenchReport, formatPassRateLine, datasetRowsUrl,
} = await import('../src/matrix/engines/swe-bench-real.ts');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const limit = Number(opt('--limit', '1')) || 1;
const offset = Number(opt('--offset', '0')) || 0;
const solverCmd = opt('--solver', 'claude -p');
const runId = opt('--run-id', `dfground${offset}_${limit}`);
const work = opt('--work', 'X:/tmp/swebench-work');
const solveTimeoutMs = Number(opt('--solve-timeout-ms', '900000')) || 900000;
const MODEL_NAME = 'danteforge-agentic';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    httpsGet(url, { timeout: 30000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject).on('timeout', function () { this.destroy(new Error('timeout')); });
  });
}

function sh(cmd, cwd, timeout) {
  return spawnSync(cmd, { shell: true, cwd, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

console.error(`[swebench] fetching ${limit} real instance(s) from SWE-bench_Lite (offset ${offset})…`);
const rows = await fetchJson(datasetRowsUrl(offset, limit));
const instances = parseDatasetRows(rows);
if (instances.length === 0) { console.error('[swebench] no instances parsed'); process.exit(2); }

mkdirSync(work, { recursive: true });
const predictionsPath = join(work, `predictions-${runId}.jsonl`);
const predLines = [];

for (const inst of instances) {
  const si = toSolverInput(inst);
  const repoDir = join(work, inst.instance_id.replace(/[^\w.-]/g, '_'));
  console.error(`\n[swebench] ${inst.instance_id} (${inst.repo}@${inst.base_commit.slice(0, 8)})`);
  try {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    // Clone the REAL repo and check out the exact base_commit the issue was filed against.
    let r = sh(`git clone --quiet https://github.com/${inst.repo}.git "${repoDir}"`, work, 600000);
    if (r.status !== 0) throw new Error(`clone failed: ${(r.stderr || '').slice(-200)}`);
    r = sh(`git checkout --quiet ${inst.base_commit}`, repoDir, 120000);
    if (r.status !== 0) throw new Error(`checkout failed: ${(r.stderr || '').slice(-200)}`);

    // SOLVE: the agentic solver edits files in the repo to fix the issue (problem_statement ONLY).
    const task = `You are fixing a real GitHub issue in this repository (cwd is the repo root). Edit the source files to resolve it. Do NOT write or modify tests. Make the minimal change that fixes the described problem.\n\nISSUE:\n${si.problem_statement}\n${si.hints_text ? `\nHINTS:\n${si.hints_text}\n` : ''}`;
    const parts = solverCmd.split(' ');
    const solve = sh(`${parts[0]} ${parts.slice(1).map(a => `"${a}"`).join(' ')} "${task.replace(/"/g, '\\"').slice(0, 12000)}"`, repoDir, solveTimeoutMs);
    if (solve.status !== 0) console.error(`  [warn] solver exit ${solve.status}: ${(solve.stderr || '').slice(-160)}`);

    // The candidate patch = whatever the solver changed in tracked source files.
    const diff = sh(`git diff`, repoDir, 60000);
    const patch = diff.stdout || '';
    console.error(`  patch: ${patch.length} chars`);
    predLines.push(buildPredictionLine(inst.instance_id, MODEL_NAME, patch));
  } catch (err) {
    console.error(`  [error] ${err instanceof Error ? err.message : String(err)} — empty patch`);
    predLines.push(buildPredictionLine(inst.instance_id, MODEL_NAME, '')); // empty patch = unresolved (honest)
  }
}

writeFileSync(predictionsPath, predLines.join('\n') + '\n', 'utf8');
console.error(`\n[swebench] wrote ${predLines.length} prediction(s) → ${predictionsPath}`);

// GRADE via the LINUX ORCHESTRATOR (CH-034): a Windows host CRLF-corrupts the harness's eval.sh/patch
// inside the per-instance containers, so we run the ORCHESTRATOR itself in a Linux container (LF-native,
// has `resource`, reaches the host daemon via socket passthrough). scripts/swebench-orch/grade.sh builds
// the image once and runs the official harness in Linux.
const ids = instances.map(i => i.instance_id).join(' ');
const reportDir = join(work, `report-${runId}`);
mkdirSync(reportDir, { recursive: true });
console.error(`[swebench] grading via the LINUX orchestrator (run_id ${runId})… (image build + GB pulls on first run)`);
const grade = spawnSync(
  `bash scripts/swebench-orch/grade.sh "${predictionsPath}" ${runId} "${reportDir}" ${ids}`,
  { shell: true, cwd: process.cwd(), timeout: 3 * 3600 * 1000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);
process.stderr.write((grade.stdout || '').slice(-2000));
process.stderr.write((grade.stderr || '').slice(-2000));

// The harness writes <model_name>.<run_id>.json in the report dir (or cwd). Find + parse it.
function findReport(dir) {
  for (const base of [dir, reportDir, process.cwd()]) {
    try {
      const f = readdirSync(base).find(n => n.endsWith(`.${runId}.json`) || (n.includes(runId) && n.endsWith('.json')));
      if (f) return join(base, f);
    } catch { /* keep looking */ }
  }
  return null;
}
const reportPath = findReport(reportDir);
if (!reportPath) {
  console.error('[swebench] no report file found — grading did not complete. Emitting 0/N (honest: unresolved).');
  console.log(formatPassRateLine({ pass_rate: 0, resolved: 0, total: instances.length }));
  process.exit(0);
}
const report = parseSwebenchReport(JSON.parse(readFileSync(reportPath, 'utf8')));
console.error(`[swebench] resolved ${report.resolved}/${report.total} — ${reportPath}`);
console.log(formatPassRateLine(report));
