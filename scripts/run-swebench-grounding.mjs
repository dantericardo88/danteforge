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
// --spread N: sample N instances at evenly-spaced offsets across the dataset (CROSS-REPO — SWE-bench-lite
// is ordered by repo, so a contiguous window is one repo; a spread samples django/sympy/flask/… for an
// honest cross-repo signal, not one repo's sub-score).
const spread = Number(opt('--spread', '0')) || 0;
const DATASET_SIZE = 300; // SWE-bench-lite test split
const solverCmd = opt('--solver', 'claude -p');
const runId = opt('--run-id', `dfground${offset}_${limit}`);
const work = opt('--work', 'X:/tmp/swebench-work');
const solveTimeoutMs = Number(opt('--solve-timeout-ms', '900000')) || 900000;
const maxIter = Number(opt('--max-iterations', '2')) || 2; // council #2: test-feedback iteration
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

let instances = [];
if (spread > 0) {
  const step = Math.max(1, Math.floor(DATASET_SIZE / spread));
  console.error(`[swebench] CROSS-REPO sample: ${spread} instances at offsets spaced by ${step} across ${DATASET_SIZE}…`);
  for (let k = 0; k < spread; k++) {
    const off = Math.min(DATASET_SIZE - 1, k * step);
    const got = parseDatasetRows(await fetchJson(datasetRowsUrl(off, 1)));
    if (got[0]) instances.push(got[0]);
  }
} else {
  console.error(`[swebench] fetching ${limit} real instance(s) from SWE-bench_Lite (offset ${offset})…`);
  instances = parseDatasetRows(await fetchJson(datasetRowsUrl(offset, limit)));
}
if (instances.length === 0) { console.error('[swebench] no instances parsed'); process.exit(2); }
console.error(`[swebench] repos in sample: ${[...new Set(instances.map(i => i.repo))].join(', ')}`);

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

    // SOLVE with TEST-FEEDBACK ITERATION (council #2). The agentic solver has Bash, so the prompt
    // instructs it to reproduce → fix → RUN the repo's relevant tests → iterate until green within a
    // call. The harness adds a structural retry: if a call produced no diff, retry with feedback (the
    // largest closable-by-wiring slice of the Devin gap, reusing the sandbox). Tests it runs are the
    // repo's OWN — never the hidden FAIL_TO_PASS (no answer leak).
    const parts = solverCmd.split(' ');
    const baseTask = `You are an autonomous software engineer fixing a real GitHub issue in this repository (cwd = repo root).\nSTEPS: (1) explore the codebase to find the cause; (2) reproduce the bug with a throwaway script and run it; (3) edit the SOURCE files to fix it — do NOT modify the test suite; (4) RUN the repository's existing relevant tests + your reproduction and ITERATE on the fix until they pass; (5) make the minimal correct change; (6) delete any throwaway scripts so only the real fix remains.\n\nISSUE:\n${si.problem_statement}\n${si.hints_text ? `\nHINTS:\n${si.hints_text}\n` : ''}`;
    let patch = '';
    for (let attempt = 1; attempt <= maxIter; attempt++) {
      const feedback = attempt === 1 ? '' :
        `\n\nYour previous attempt left NO source changes. Explore harder, actually edit the source files that cause the bug, run the tests, and iterate until they pass.`;
      const task = `${baseTask}${feedback}`;
      const solve = sh(`${parts[0]} ${parts.slice(1).map(a => `"${a}"`).join(' ')} "${task.replace(/"/g, '\\"').slice(0, 12000)}"`, repoDir, solveTimeoutMs);
      if (solve.status !== 0) console.error(`  [warn] attempt ${attempt} solver exit ${solve.status}: ${(solve.stderr || '').slice(-160)}`);
      patch = sh(`git diff`, repoDir, 60000).stdout || '';
      console.error(`  attempt ${attempt}: patch ${patch.length} chars`);
      if (patch.trim().length > 0) break; // got a candidate; the agent already iterated on tests internally
    }
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
const gradeOut = `${grade.stdout || ''}\n${grade.stderr || ''}`;
process.stderr.write(gradeOut.slice(-2500));

// AUTHORITATIVE source = the harness's own stdout summary (always printed), robust to the report
// file landing in the ephemeral container cwd. Fall back to a report file if the lines are absent.
const mResolved = /Instances resolved:\s*(\d+)/i.exec(gradeOut);
const mTotal = /Total instances:\s*(\d+)/i.exec(gradeOut);
let report;
if (mResolved && mTotal) {
  const resolved = Number(mResolved[1]), total = Number(mTotal[1]);
  report = { resolved, total, pass_rate: total > 0 ? resolved / total : 0 };
  console.error(`[swebench] OFFICIAL grader: resolved ${resolved}/${total}`);
} else {
  // Fallback: a report file (model.<run_id>.json) if the harness wrote one to a readable dir.
  let reportPath = null;
  for (const base of [reportDir, process.cwd()]) {
    try { const f = readdirSync(base).find(n => n.includes(runId) && n.endsWith('.json')); if (f) { reportPath = join(base, f); break; } } catch { /* keep looking */ }
  }
  if (reportPath) {
    report = parseSwebenchReport(JSON.parse(readFileSync(reportPath, 'utf8')));
    console.error(`[swebench] resolved ${report.resolved}/${report.total} — ${reportPath}`);
  } else {
    console.error('[swebench] grading did not produce a parseable summary (no "Instances resolved:" line, no report file). Honest: unscored.');
    report = { pass_rate: 0, resolved: 0, total: instances.length };
  }
}
console.log(formatPassRateLine(report));
