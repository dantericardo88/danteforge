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
import { randomUUID } from 'node:crypto';

const {
  parseDatasetRows, toSolverInput, buildPredictionLine, parseSwebenchReport, formatPassRateLine, datasetRowsUrl,
} = await import('../src/matrix/engines/swe-bench-real.ts');
const {
  parsePytestFailures, computeRegressions, formatRegressionFeedback, isTestFile, parsePassToPass,
  extractFailureDetail, formatRegressionFeedbackWithDetail, hasAnchored, deAnchorFeedback, hasTargetTests,
} = await import('../src/matrix/engines/regression-gate.ts');
const { regressionsFromGradeReport } = await import('../src/matrix/engines/swebench-failure-analysis.ts');
// No-walls DNA: an env-mismatch instance is not a dead end — decompose it into tracked sub-problems.
const { solveOrDecompose } = await import('../src/core/obstacle-solve-or-decompose.ts');
const { graderEnvMismatchObstacle, graderEnvMismatchChildren } = await import('../src/matrix/engines/swebench-obstacle.ts');
let envMismatchDecomposed = false; // once-per-run guard (recordDecomposition also dedups by title)

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const limit = Number(opt('--limit', '1')) || 1;
const offset = Number(opt('--offset', '0')) || 0;
// --spread N: sample N instances at evenly-spaced offsets across the dataset (CROSS-REPO — SWE-bench-lite
// is ordered by repo, so a contiguous window is one repo; a spread samples django/sympy/flask/… for an
// honest cross-repo signal, not one repo's sub-score).
const spread = Number(opt('--spread', '0')) || 0;
// --instances <id1,id2>: solve+grade EXACTLY these instance ids (scans the dataset to find them). Used to
// re-run specific instances — e.g. the known env-mismatch / fixed-but-regressed ones for CH-047 validation.
const instancesArg = opt('--instances', '');
// --dataset: lite | verified | live. 'live' = SWE-bench-Live (CONTAMINATION-RESISTANT: post-2024 issues,
// leak-detected, per-instance docker images in the `starryzhang` namespace) — graded by the SAME official
// harness with -d/-n/--split (verified 2026-06-16: lite split fetchable + starryzhang images exist).
const DATASETS = {
  lite:     { hf: 'SWE-bench/SWE-bench_Lite',          grade: 'SWE-bench/SWE-bench_Lite',          ns: 'swebench',    split: 'test', size: 300 },
  verified: { hf: 'SWE-bench/SWE-bench_Verified',      grade: 'SWE-bench/SWE-bench_Verified',      ns: 'swebench',    split: 'test', size: 500 },
  live:     { hf: 'SWE-bench-Live/SWE-bench-Live',     grade: 'SWE-bench-Live/SWE-bench-Live',     ns: 'starryzhang', split: 'lite', size: 300 },
};
const DS = DATASETS[opt('--dataset', 'lite')] || DATASETS.lite;
const DATASET_SIZE = DS.size;
const solverCmd = opt('--solver', 'claude -p');
// PLUGGABLE SOLVER SEAM (council-unanimous highest-leverage action): when set, the solve step runs THIS
// command in the repo checkout instead of the built-in `claude -p`. The task (problem + any regression
// feedback) is written to $SWEBENCH_TASK_FILE and the command edits the repo; `git diff` becomes the patch.
// This lets the SAME grade + classifier + signed-receipt pipeline measure ANY solver — a full DanteForge
// workflow (autoforge/party = the real "run DanteForge on itself"), another agent, or a different tool —
// without forking the harness. Empty = use the built-in claude solver.
const solveCommand = opt('--solve-command', '');
const runId = opt('--run-id', `dfground${offset}_${limit}`);
const work = opt('--work', 'X:/tmp/swebench-work');
const solveTimeoutMs = Number(opt('--solve-timeout-ms', '900000')) || 900000;
const maxIter = Number(opt('--max-iterations', '2')) || 2; // council #2: test-feedback iteration
const gradeOnly = opt('--grade-only', ''); // CH-035c: resume at the grade step (no re-solve)
// CH-039 STRUCTURAL regression-gate: the first contamination-resistant grade showed the solver FIXES the
// target but breaks previously-passing tests (PASS_TO_PASS regressions), and a prompt telling it "don't
// regress" produced a byte-identical patch (prompt-trust is insufficient). The gate runs the repo's OWN
// public test suite before+after the patch and feeds back ONLY the NEWLY-failing tests (never the target
// tests — no answer leak) so the solver gets the missing signal and re-solves. Off by default (expensive).
const regressionGate = args.includes('--regression-gate');
// CH-047 GRADE-IN-THE-LOOP: on env-mismatch instances the local pytest gate self-disables (CH-043), so
// PASS_TO_PASS regressions ship uncaught (every gradeable SWE-bench-Live instance landed fixed-but-regressed,
// 0/10). This uses the GRADER ITSELF as the regression oracle — faithful by construction (identical env to
// the verdict): grade the candidate patch, read the failing PASS_TO_PASS from report.json, feed those EXACT
// tests back, re-solve. Activates when the local gate is inactive (env mismatch). HEAVY (a Docker grade per
// iteration) — run locally ONLY under the WSL2 cap, sequentially. Pairs with --regression-gate (local gate for
// env-OK instances, grader oracle for env-mismatch); alone, the grader oracle runs for every instance.
const gradeInLoop = args.includes('--grade-in-loop');
const maxGradeIter = Number(opt('--max-grade-iterations', '2')) || 2;
const testCmd = opt('--test-cmd', 'python -m pytest -p no:cacheprovider --tb=no -q');
const testTimeoutMs = Number(opt('--test-timeout-ms', '900000')) || 900000;
// The gate's baseline runs on a FRESH clone (before the solver installs anything), so the package must be
// installed first or pytest can't even collect (exit 2). Editable install of the repo + pytest by default.
const installCmd = opt('--install-cmd', 'python -m pip install -e . pytest -q');
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

function sh(cmd, cwd, timeout, env) {
  return spawnSync(cmd, { shell: true, cwd, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env });
}

// parsePytestFailures + computeRegressions + formatRegressionFeedback are imported from the tested
// src/matrix/engines/regression-gate.ts (the climb logic that decides what is fed back to the solver).

// Revert any solver edits to TEST files — SWE-bench scores SOURCE-only (the grader resets tests), and a
// naive gate is gamed by a solver that edits tests to silence regressions (observed: v3 edited 15 test
// files, the gate accepted, the grader failed it). Reverting makes the prediction honest + the gate faithful.
function revertTestEdits(repoDir) {
  const changed = (sh('git diff --name-only', repoDir, 60000).stdout || '').split('\n').map(s => s.trim()).filter(Boolean);
  const tests = changed.filter(isTestFile);
  if (tests.length > 0) {
    sh(`git checkout -- ${tests.map(t => `"${t}"`).join(' ')}`, repoDir, 60000);
    console.error(`  [gate] reverted ${tests.length} solver edit(s) to TEST files (prediction is SOURCE-only): ${tests.slice(0, 4).join(', ')}${tests.length > 4 ? ' …' : ''}`);
  }
  return tests.length;
}

// Run the repo's public test suite and return { failures:Set, ran:boolean }. ran=false when the runner
// itself could not execute (wrong runner / collection error) — the gate then skips honestly rather than
// treating "couldn't run" as "everything regressed".
function runRepoTests(repoDir, label) {
  const r = sh(testCmd, repoDir, testTimeoutMs);
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  // pytest exits 0 (all pass), 1 (tests failed), 5 (no tests). A collection/usage error is exit 2/3/4 or a
  // missing-module crash — treat those as "could not run" so the gate doesn't fabricate regressions.
  const usable = r.status === 0 || r.status === 1 || r.status === 5;
  const failures = parsePytestFailures(out);
  console.error(`  [regression-gate] ${label}: test run exit ${r.status}, ${failures.size} failing${usable ? '' : ' (UNUSABLE — runner could not execute; gate skipped)'}`);
  return { failures, ran: usable };
}

// CH-047: grade ONE instance's candidate patch through the SAME Docker grader the final grade uses, and
// return its report.json (the flat SwebenchReport the classifier reads). The grader resets test files and
// runs in the instance's own image, so its PASS_TO_PASS.failure is the AUTHORITATIVE regression list — the
// signal the local pip-env gate cannot produce on env-mismatch instances. Returns null when no per-instance
// report was produced (infra/daemon outage) so the caller treats it as inconclusive, never a false accept.
function gradeOneInstance(inst, patch, label) {
  const gid = `${runId}_gil${label}`;
  const predPath = join(work, `${gid}.predictions.jsonl`);
  writeFileSync(predPath, buildPredictionLine(inst.instance_id, MODEL_NAME, patch) + '\n', 'utf8');
  const repDir = join(work, `report-${gid}`);
  mkdirSync(repDir, { recursive: true });
  console.error(`  [grade-in-loop] grading candidate via the Docker grader (${label})… (heavy: container test run)`);
  const g = sh(`bash scripts/swebench-orch/grade.sh "${predPath}" ${gid} "${repDir}" ${DS.grade} ${DS.ns} ${DS.split} ${inst.instance_id}`,
    process.cwd(), 2 * 3600 * 1000, { MSYS_NO_PATHCONV: '1' });
  if (g.status !== 0) console.error(`  [grade-in-loop] grader exit ${g.status}: ${((g.stderr || '') + (g.stdout || '')).slice(-200)}`);
  try {
    const report = JSON.parse(readFileSync(join(repDir, inst.instance_id, 'report.json'), 'utf8'));
    // CH-050: also capture the grader's full test output (assertion/tracebacks) so the feedback can carry the
    // real failure detail, not just the test names (the solver can't reproduce these locally on env mismatch).
    let log = '';
    try { log = readFileSync(join(repDir, inst.instance_id, 'post_patch_log.txt'), 'utf8'); } catch { /* no log — detail omitted */ }
    return { report, log };
  } catch {
    console.error(`  [grade-in-loop] no per-instance report.json under ${repDir}/${inst.instance_id} — inconclusive (not a false accept)`);
    return null;
  }
}

let instances = [];
if (gradeOnly) {
  for (const l of readFileSync(gradeOnly, 'utf8').split('\n')) {
    const t = l.trim(); if (!t) continue;
    try { instances.push({ instance_id: JSON.parse(t).instance_id, repo: '', base_commit: '', problem_statement: '' }); } catch { /* skip malformed line */ }
  }
  console.error(`[swebench] --grade-only: grading ${instances.length} existing prediction(s) from ${gradeOnly} (no re-solve)`);
} else if (instancesArg) {
  // Target SPECIFIC instances by id (CH-047 validation needs the known env-mismatch instances, e.g.
  // cfn-lint-3798; the HF datasets-server fetches by offset, so scan in chunks and filter to the wanted ids).
  const wanted = new Set(instancesArg.split(',').map(s => s.trim()).filter(Boolean));
  console.error(`[swebench] targeting ${wanted.size} instance(s) by id: ${[...wanted].join(', ')} (scanning ${DATASET_SIZE})…`);
  for (let off = 0; off < DATASET_SIZE && instances.length < wanted.size; off += 100) {
    const rows = parseDatasetRows(await fetchJson(datasetRowsUrl(off, Math.min(100, DATASET_SIZE - off), DS.hf, DS.split)));
    for (const r of rows) if (wanted.has(r.instance_id)) instances.push(r);
  }
} else if (spread > 0) {
  const step = Math.max(1, Math.floor(DATASET_SIZE / spread));
  console.error(`[swebench] CROSS-REPO sample: ${spread} instances at offsets spaced by ${step} across ${DATASET_SIZE}…`);
  for (let k = 0; k < spread; k++) {
    const off = Math.min(DATASET_SIZE - 1, k * step);
    const got = parseDatasetRows(await fetchJson(datasetRowsUrl(off, 1, DS.hf, DS.split)));
    if (got[0]) instances.push(got[0]);
  }
} else {
  console.error(`[swebench] fetching ${limit} real instance(s) from ${DS.hf} [${DS.split}] (offset ${offset})…`);
  instances = parseDatasetRows(await fetchJson(datasetRowsUrl(offset, limit, DS.hf, DS.split)));
}
if (instances.length === 0) { console.error('[swebench] no instances parsed'); process.exit(2); }
// CH-059: skip instances with NO target tests (empty FAIL_TO_PASS). They CANNOT be resolved (nothing to
// fix-and-verify), so solving them wastes a solver call and dilutes the resolve rate with an un-evaluable 0 —
// the rate then reflects capability on WELL-POSED instances. --include-no-target keeps the raw denominator;
// --grade-only never filters (it grades whatever predictions exist).
if (!gradeOnly && !args.includes('--include-no-target')) {
  const before = instances.length;
  instances = instances.filter(i => hasTargetTests(i.FAIL_TO_PASS));
  const skipped = before - instances.length;
  if (skipped > 0) console.error(`[swebench] skipped ${skipped}/${before} instance(s) with NO target tests (empty FAIL_TO_PASS — un-evaluable); measuring capability on ${instances.length} well-posed instance(s). Use --include-no-target for the raw denominator.`);
  if (instances.length === 0) { console.error('[swebench] all instances were no-target — nothing evaluable to solve'); process.exit(2); }
}
console.error(`[swebench] repos in sample: ${[...new Set(instances.map(i => i.repo))].join(', ')}`);

mkdirSync(work, { recursive: true });
const predictionsPath = gradeOnly || join(work, `predictions-${runId}.jsonl`);
const predLines = [];

for (const inst of (gradeOnly ? [] : instances)) {
  const si = toSolverInput(inst);
  // Per-RUN repo dir (run-id prefix): two experiments on the SAME instance must not share a checkout — a
  // prior run holding a Windows file lock made rmSync leave a partial dir and the re-clone fail silently
  // (empty patch → invalid result). A unique dir per run removes the collision entirely.
  const repoDir = join(work, `${runId}__${inst.instance_id.replace(/[^\w.-]/g, '_')}`);
  console.error(`\n[swebench] ${inst.instance_id} (${inst.repo}@${inst.base_commit.slice(0, 8)})`);
  try {
    if (existsSync(repoDir)) rmSync(repoDir, { recursive: true, force: true });
    // Clone the REAL repo and check out the exact base_commit the issue was filed against. Capture stdout
    // too so a non-zero clone never fails with an empty (useless) message.
    let r = sh(`git clone --quiet https://github.com/${inst.repo}.git "${repoDir}"`, work, 600000);
    if (r.status !== 0) throw new Error(`clone failed (exit ${r.status}): ${((r.stderr || '') + (r.stdout || '')).slice(-200) || 'no output'}`);
    r = sh(`git checkout --quiet ${inst.base_commit}`, repoDir, 120000);
    if (r.status !== 0) throw new Error(`checkout failed: ${(r.stderr || '').slice(-200)}`);

    // SOLVE with TEST-FEEDBACK ITERATION (council #2). The agentic solver has Bash, so the prompt
    // instructs it to reproduce → fix → RUN the repo's relevant tests → iterate until green within a
    // call. The harness adds a structural retry: if a call produced no diff, retry with feedback (the
    // largest closable-by-wiring slice of the Devin gap, reusing the sandbox). Tests it runs are the
    // repo's OWN — never the hidden FAIL_TO_PASS (no answer leak).
    const parts = solverCmd.split(' ');
    // REGRESSION-DISCIPLINED prompt (CH-039). Forensics on the first contamination-resistant grade (0/5)
    // showed the solver FIXES the target (FAIL_TO_PASS often fully passes) but breaks a handful of
    // previously-passing tests (PASS_TO_PASS) — SWE-bench requires BOTH. So the lever is not "fix harder"
    // but "do not regress": minimal surgical diff + establish a baseline + re-run the touched modules' FULL
    // test files and keep every previously-passing test green.
    const baseTask = `You are an autonomous software engineer fixing a real GitHub issue in this repository (cwd = repo root).\n` +
      `CRITICAL ACCEPTANCE RULE: your patch is REJECTED if it breaks ANY test that passed before your change — even if it fixes the issue. Keeping existing tests green is EXACTLY as important as the new fix. So make the SMALLEST possible surgical change; do not refactor, rename, reformat, or "improve" anything unrelated to the bug.\n` +
      `STEPS: (1) explore to find the precise cause; (2) reproduce the bug with a throwaway script and run it; (3) BEFORE editing, run the test FILE(S) covering the module(s) you will touch and note which tests pass (your baseline); (4) edit ONLY the SOURCE lines needed to fix the bug — never modify the test suite; (5) re-run those SAME test files PLUS your reproduction: every test that passed in your baseline MUST still pass, and the bug must be fixed. If any previously-passing test now fails, your change is too broad — revert and narrow it to the minimal edit; (6) iterate (3)-(5) until the bug is fixed AND zero regressions; (7) delete throwaway scripts so only the minimal real fix remains.\n\nISSUE:\n${si.problem_statement}\n${si.hints_text ? `\nHINTS:\n${si.hints_text}\n` : ''}`;
    let patch = '';
    const priorPatches = []; // CH-052: prior attempts' patches, for anchoring (byte-identical re-submit) detection
    // CH-039 regression gate: capture the pre-patch failure baseline on the CLEAN repo so post-patch we can
    // isolate NEWLY-failing (regressed) tests from pre-existing/flaky failures AND from the target tests
    // (which go fail->pass, never pass->fail — so they are never counted as regressions: no answer leak).
    let baseFail = new Set();
    let gateActive = false;
    if (regressionGate) {
      // Install the repo so the baseline can collect tests (a fresh clone has no deps yet).
      console.error(`  [regression-gate] installing repo for baseline (${installCmd})…`);
      const ins = sh(installCmd, repoDir, testTimeoutMs);
      if (ins.status !== 0) console.error(`  [regression-gate] install non-zero (exit ${ins.status}) — trying baseline anyway: ${(ins.stderr || '').slice(-160)}`);
      const b = runRepoTests(repoDir, 'baseline (pre-patch)');
      gateActive = b.ran;
      baseFail = b.failures;
      if (!gateActive) console.error('  [regression-gate] disabled for this instance (runner unusable even after install) — accepting first valid patch');
    }
    // CH-041: the dataset's PASS_TO_PASS is the grader's must-stay-green set (harness-side only — never given
    // to the solver). Intersecting the gate's newly-failing tests with it makes the gate match the grader.
    const mustStayGreen = parsePassToPass(inst.PASS_TO_PASS);
    // CH-043 — ENV-FIDELITY self-check: PASS_TO_PASS tests pass in the GRADER's environment by definition.
    // If any of them ALREADY FAIL in our local baseline, our `pip install -e .` env != the grader's Docker
    // image, so real regressions in those tests would be masked (they look "already failing") → a false
    // accept (observed: cfn-lint-3798 — 4 must-stay-green tests fail locally on the clean repo). When that
    // happens the local gate CANNOT faithfully match the grader, so it disables itself and defers to the
    // authoritative Docker grade rather than emit a misleading "no regressions".
    if (gateActive && mustStayGreen.size > 0) {
      const baselineMustGreenFailures = [...baseFail].filter(t => mustStayGreen.has(t));
      if (baselineMustGreenFailures.length > 0) {
        console.error(`  [regression-gate] ENV MISMATCH: ${baselineMustGreenFailures.length} must-stay-green (PASS_TO_PASS) test(s) already FAIL in the local baseline — local env != the grader's Docker image, so regression detection is UNRELIABLE. Disabling the gate (the Docker grade is authoritative).`);
        gateActive = false;
        // No-walls: this env-mismatch is a problem to BREAK DOWN, not a dead end. Decompose it into the
        // council's ranked sub-problems (test-in-grader-image first) and record them to the ledger as the
        // next work — once per run; recordDecomposition dedups so a fresh repo never duplicates them.
        if (!envMismatchDecomposed) {
          envMismatchDecomposed = true;
          try {
            const receipt = await solveOrDecompose(
              graderEnvMismatchObstacle(inst.instance_id, baselineMustGreenFailures.slice(0, 4)),
              { cwd: process.cwd(), proposeChildren: graderEnvMismatchChildren },
            );
            if (receipt.resolution.kind === 'decomposed') {
              console.error(`  [no-walls] env-mismatch decomposed into ${receipt.resolution.children.length} tracked sub-problem(s) — see the challenge ledger (not a wall)`);
            }
          } catch (e) { console.error(`  [no-walls] decomposition skipped: ${e?.message || e}`); }
        }
      }
    }
    if (gateActive) console.error(`  [regression-gate] env OK; PASS_TO_PASS must-stay-green set: ${mustStayGreen.size} tests${mustStayGreen.size ? '' : ' (none — conservative full-suite signal)'}`);
    // CH-040: PERSISTENT iterative session. The fresh-call-per-attempt loop produced byte-identical patches
    // across attempts (the agent re-did the obvious fix with no memory of the feedback). When the solver is
    // `claude`, run attempt 1 under a fixed --session-id and RESUME that session for each follow-up so the
    // agent keeps full context (its prior patch + the specific regression feedback) and actually revises.
    // For non-claude solvers (or --no-session) fall back to appending feedback to a fresh task.
    // The built-in claude solver uses a persistent session (CH-040); a pluggable --solve-command does not
    // (it gets the task + feedback via $SWEBENCH_TASK_FILE each attempt — its own internal loop is its own).
    const useSession = !solveCommand && /\bclaude\b/.test(solverCmd) && !args.includes('--no-session');
    const sessionId = useSession ? randomUUID() : null;
    const taskFile = solveCommand ? join(work, `${runId}__task.md`) : null;
    const NODIFF_FB = `Your previous attempt left NO source changes. Explore harder, actually edit the source files that cause the bug, run the tests, and iterate until they pass.`;
    let nextMessage = baseTask; // attempt 1 sends the full task; later attempts send feedback (session keeps context)
    for (let attempt = 1; attempt <= maxIter; attempt++) {
      let solve;
      if (solveCommand) {
        // Pluggable solver: hand the task via a file (outside repoDir so it never pollutes git diff) + env.
        writeFileSync(taskFile, nextMessage, 'utf8');
        solve = sh(solveCommand, repoDir, solveTimeoutMs, {
          SWEBENCH_TASK_FILE: taskFile, SWEBENCH_INSTANCE_ID: inst.instance_id, SWEBENCH_REPO: inst.repo,
        });
      } else {
        // claude: --session-id on the first turn, --resume on follow-ups (context persists). Legacy: no flag.
        const sessFlag = useSession ? (attempt === 1 ? `--session-id ${sessionId}` : `--resume ${sessionId}`) : '';
        const cmd = `${parts[0]} ${parts.slice(1).map(a => `"${a}"`).join(' ')} ${sessFlag} "${nextMessage.replace(/"/g, '\\"').slice(0, 12000)}"`;
        solve = sh(cmd, repoDir, solveTimeoutMs);
      }
      if (solve.status !== 0) console.error(`  [warn] attempt ${attempt} solver exit ${solve.status}: ${(solve.stderr || '').slice(-160)}`);
      revertTestEdits(repoDir); // enforce SOURCE-only predictions + an ungameable gate (no test-file edits)
      patch = sh(`git diff`, repoDir, 60000).stdout || '';
      console.error(`  attempt ${attempt}${solveCommand ? ' (solve-command)' : useSession ? ' (session)' : ''}: patch ${patch.length} chars`);
      // CH-052: detect ANCHORING — the solver re-produced a byte-identical patch despite feedback (the observed
      // cfn-lint-3798 failure). Flag it now so the feedback below forces a structurally different approach.
      const anchored = patch.trim().length > 0 && hasAnchored(patch, priorPatches);
      if (anchored) console.error(`  [de-anchor] attempt ${attempt}: patch byte-identical to a prior attempt — forcing a structurally different approach`);
      if (patch.trim().length > 0) priorPatches.push(patch);
      if (patch.trim().length === 0) { nextMessage = useSession ? NODIFF_FB : `${baseTask}\n\n${NODIFF_FB}`; continue; }
      // REGRESSION ORACLE — pick the most faithful source available, in priority order:
      //  (a) local gate active → fast local pytest before/after (CH-039/041), free.
      //  (b) gate inactive + --grade-in-loop → the GRADER as oracle (CH-047): the only faithful signal on
      //      env-mismatch instances where the local gate self-disabled. Heavy (a Docker grade per iteration).
      //  (c) neither → accept the first non-empty patch (legacy behavior).
      // `regressions === null` means "no actionable regression signal" (no oracle, or the GRADE says the fix
      // itself — not regressions — is the blocker): accept the current patch honestly rather than thrash.
      let regressions = null;
      let regrDetail = ''; // CH-050: the grader's actual failure output for the regressed tests (env-mismatch path)
      if (gateActive) {
        const post = runRepoTests(repoDir, `post-patch attempt ${attempt}`);
        regressions = computeRegressions(baseFail, post.failures, mustStayGreen);
      } else if (gradeInLoop && attempt <= maxGradeIter) {
        const graded = gradeOneInstance(inst, patch, `a${attempt}`);
        if (graded && graded.report && graded.report.resolved) { console.error(`  [grade-in-loop] attempt ${attempt}: GRADER says RESOLVED — patch accepted`); break; }
        const gr = graded && graded.report ? regressionsFromGradeReport(graded.report) : null;
        if (gr) {
          regressions = gr.regressions;
          // CH-050: extract the grader's assertion/traceback for each regressed test so the feedback is
          // debuggable (the solver cannot reproduce these locally on an env-mismatch instance).
          regrDetail = extractFailureDetail(graded.log || '', gr.regressions);
          console.error(`  [grade-in-loop] attempt ${attempt}: target fixed (${gr.targetFixed}), ${gr.regressions.length} GRADER regression(s)${regrDetail ? ' (+failure detail)' : ''}: ${gr.regressions.slice(0, 8).join(', ')}`);
        } else {
          console.error(`  [grade-in-loop] attempt ${attempt}: not fixed-but-regressed (the fix, not regressions, is the blocker) or inconclusive — accepting patch honestly`);
        }
      } else {
        break;
      }
      if (regressions === null) break;                   // no actionable signal → accept current patch
      if (regressions.length === 0) { console.error(`  [regression] attempt ${attempt}: NO regressions — patch accepted`); break; }
      console.error(`  [regression] attempt ${attempt}: ${regressions.length} regression(s): ${regressions.slice(0, 8).join(', ')}`);
      if (attempt < maxIter) {
        // CH-052: if the solver anchored (identical patch), escalate to de-anchoring feedback that bans the
        // repeated wide-blast-radius approach; otherwise the normal regression feedback (+grader detail).
        const regrFB = anchored
          ? deAnchorFeedback(regressions, regrDetail)
          : (regrDetail ? formatRegressionFeedbackWithDetail(regressions, regrDetail) : formatRegressionFeedback(regressions));
        nextMessage = useSession ? regrFB : `${baseTask}\n\n${regrFB}`;
      } else {
        console.error(`  [regression] max attempts reached, ${regressions.length} regression(s) remain — recording the patch honestly (grades as unresolved)`);
      }
    }
    predLines.push(buildPredictionLine(inst.instance_id, MODEL_NAME, patch));
  } catch (err) {
    console.error(`  [error] ${err instanceof Error ? err.message : String(err)} — empty patch`);
    predLines.push(buildPredictionLine(inst.instance_id, MODEL_NAME, '')); // empty patch = unresolved (honest)
  }
  writeFileSync(predictionsPath, predLines.join('\n') + '\n', 'utf8'); // CH-035c: incremental — a mid-solve wedge keeps completed solves (resume via --grade-only)
}

if (!gradeOnly) {
  writeFileSync(predictionsPath, predLines.join('\n') + '\n', 'utf8');
  console.error(`\n[swebench] wrote ${predLines.length} prediction(s) → ${predictionsPath}`);
}

// GRADE via the LINUX ORCHESTRATOR (CH-034): a Windows host CRLF-corrupts the harness's eval.sh/patch
// inside the per-instance containers, so we run the ORCHESTRATOR itself in a Linux container (LF-native,
// has `resource`, reaches the host daemon via socket passthrough). scripts/swebench-orch/grade.sh builds
// the image once and runs the official harness in Linux.
const ids = instances.map(i => i.instance_id).join(' ');
const reportDir = join(work, `report-${runId}`);
mkdirSync(reportDir, { recursive: true });
console.error(`[swebench] grading ${DS.grade} [${DS.split}] via the LINUX orchestrator (run_id ${runId}, ns ${DS.ns})… (image build + GB pulls on first run)`);
const grade = spawnSync(
  `bash scripts/swebench-orch/grade.sh "${predictionsPath}" ${runId} "${reportDir}" ${DS.grade} ${DS.ns} ${DS.split} ${ids}`,
  { shell: true, cwd: process.cwd(), timeout: 3 * 3600 * 1000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, MSYS_NO_PATHCONV: '1' } },
);
const gradeOut = `${grade.stdout || ''}\n${grade.stderr || ''}`;
process.stderr.write(gradeOut.slice(-2500));

// AUTHORITATIVE source = the harness's own stdout summary (always printed), robust to the report
// file landing in the ephemeral container cwd. Fall back to a report file if the lines are absent.
const mResolved = /Instances resolved:\s*(\d+)/i.exec(gradeOut);
const mTotal = /Total instances:\s*(\d+)/i.exec(gradeOut);
// SWE-bench-Live (evaluation.evaluation) prints "Success:" (resolved) instead of the swebench.harness
// summary; the honest denominator is the full sample we asked to grade (empty/error/failure = unresolved).
const mLiveOk = /^Success:\s*(\d+)/im.exec(gradeOut);
let report;
if (mResolved && mTotal) {
  const resolved = Number(mResolved[1]), total = Number(mTotal[1]);
  report = { resolved, total, pass_rate: total > 0 ? resolved / total : 0 };
  console.error(`[swebench] OFFICIAL grader: resolved ${resolved}/${total}`);
} else if (mLiveOk) {
  const resolved = Number(mLiveOk[1]), total = instances.length;
  // CH-038: the Live grader reports Error/Incomplete (infra/daemon outages, CH-035) SEPARATELY from a real
  // Failure. Surface them so an UNRESOLVED number that is actually infra-degraded is not mistaken for a true
  // capability signal — the conservative denominator stays the full sample, but a degraded run is flagged
  // (so an unattended loop re-runs the errored instances instead of trusting a depressed rate).
  const errored = Number((/^Error:\s*(\d+)/im.exec(gradeOut) ?? [])[1] ?? 0);
  const incomplete = Number((/^Incomplete:\s*(\d+)/im.exec(gradeOut) ?? [])[1] ?? 0);
  const degraded = errored + incomplete;
  report = { resolved, total, pass_rate: total > 0 ? resolved / total : 0, errored, incomplete };
  console.error(`[swebench] SWE-bench-Live grader (contamination-resistant): resolved ${resolved}/${total}`);
  if (degraded > 0) {
    console.error(`[swebench] WARNING: ${degraded}/${total} instance(s) errored/incomplete (infra, not a real fail) — ` +
      `this rate is DEGRADED. Re-grade the affected instances (--grade-only) before trusting the number as capability.`);
  }
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
