#!/usr/bin/env node
// Phase 2 grounding run — drive the REAL HumanEval suite as a code-generation benchmark.
//
// Two modes:
//   --verify-gold              run the canonical solutions (ZERO LLM compute) to PROVE the runner works
//                              on the real dataset — expect pass_rate ~1.0. This is verification, NOT a
//                              grounding receipt (the canonical answers are not DanteForge's capability).
//   (default) --solver "<cmd>" the real grounding run: DanteForge's agent solves each problem (COMPUTE,
//                              one agent call per problem). The pass_rate IS the grounding measure.
//
// Usage:
//   node scripts/run-humaneval-grounding.mjs --data <HumanEval.jsonl|.gz> --verify-gold [--limit N]
//   node scripts/run-humaneval-grounding.mjs --data <HumanEval.jsonl|.gz> [--limit N] [--solver "claude -p"]
//
// Output ends with the JSON pass_rate line external-benchmark-runner.parsePassRate reads. To mint a
// receipt: register an external-benchmark outcome (benchmark: 'humaneval', your ratified min_pass_rate +
// leader_target), run on a signed surface (sign-outcome-evidence.mjs + DANTEFORGE_REQUIRE_SIGNED_EVIDENCE=1).

import 'tsx/esm';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';

const { runHumanEvalGrounding, runHumanEvalTest, parseHumanEvalJsonl, formatPassRateLine } =
  await import('../src/matrix/engines/humaneval-grounding.ts');
const { pipelineSolve } = await import('../src/matrix/engines/pipeline-solver.ts');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };

const dataPath = opt('--data', null);
const limit = Number(opt('--limit', '0')) || 0;
const verifyGold = flag('--verify-gold');
const solverCmd = opt('--solver', 'claude -p');
// CH-029: 'oneshot' = raw model call (grounds the MODEL); 'pipeline' = DanteForge's iterate-to-green
// loop over the model (grounds DanteForge's ORCHESTRATION — what the code_generation dim claims).
const solverMode = opt('--solver-mode', 'oneshot');
const maxIter = Number(opt('--max-iterations', '3')) || 3;

if (!dataPath) {
  console.error('[humaneval] --data <HumanEval.jsonl|.jsonl.gz> required. Dataset: https://github.com/openai/human-eval (data/HumanEval.jsonl.gz)');
  process.exit(2);
}

let raw = readFileSync(dataPath);
if (dataPath.endsWith('.gz')) raw = gunzipSync(raw);
let problems = parseHumanEvalJsonl(raw.toString('utf8'));
if (limit > 0) problems = problems.slice(0, limit);
if (problems.length === 0) { console.error(`[humaneval] no problems parsed from ${dataPath}`); process.exit(2); }

if (verifyGold) {
  // Zero-compute verification: run each problem's canonical solution directly through the runner.
  let resolved = 0;
  const failures = [];
  for (const p of problems) {
    const r = runHumanEvalTest(p, p.canonical_solution);
    if (r.passed) resolved++; else failures.push(`${p.task_id}: ${(r.error ?? '').split('\n').slice(-1)[0]}`);
  }
  const report = { total: problems.length, resolved, pass_rate: problems.length ? resolved / problems.length : 0, results: [] };
  console.error(`[humaneval] --verify-gold: canonical solutions resolved ${resolved}/${problems.length}`);
  for (const f of failures.slice(0, 10)) console.error(`  ✗ ${f}`);
  console.log(formatPassRateLine(report));
  process.exit(0);
}

// Real grounding run — the agent is the solver (COMPUTE). Ask for ONLY the function body.
console.error(`[humaneval] solving ${problems.length} problem(s) with solver: ${solverCmd}`);
function extractBody(text, entry) {
  let t = text.replace(/^```[a-zA-Z]*\n?/m, '').replace(/```\s*$/m, '').trimEnd();
  const defIdx = t.indexOf(`def ${entry}`);
  if (defIdx >= 0) { const lines = t.slice(defIdx).split('\n'); lines.shift(); t = lines.join('\n'); }
  return t.endsWith('\n') ? t : `${t}\n`;
}
const parts = solverCmd.split(' ');
const genPrompt = (specPrompt, feedback) =>
  `Complete this Python function. Output ONLY the function body (the indented lines after the signature) — no signature, no markdown fences, no prose.\n\n${specPrompt}${feedback ? `\n\n${feedback}` : ''}`;
const callModel = (promptText) => {
  const r = spawnSync(parts[0], [...parts.slice(1), promptText], { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) throw new Error(`solver exit ${r.status}: ${(r.stderr || '').slice(0, 200)}`);
  return r.stdout;
};

const solveOneShot = async (spec) => extractBody(callModel(genPrompt(spec.prompt)), spec.entry_point);

// Python runner for the pipeline loop's VISIBLE-example checks (mirrors humaneval-grounding's runner).
const pythonRunner = (program) => {
  const dir = mkdtempSync(join(tmpdir(), 'he-pipe-'));
  const file = join(dir, 'prog.py');
  try {
    writeFileSync(file, program, 'utf8');
    const r = spawnSync('python', [file], { encoding: 'utf8', timeout: 15_000 });
    return { status: r.status, stderr: (r.stderr ?? '') + (r.error ? `\n${String(r.error)}` : '') };
  } finally { rmSync(dir, { recursive: true, force: true }); }
};
const solvePipeline = async (spec) => {
  const generate = async (specPrompt, feedback) => extractBody(callModel(genPrompt(specPrompt, feedback)), spec.entry_point);
  const res = await pipelineSolve(spec, generate, pythonRunner, { maxIterations: maxIter });
  return res.body;
};

const solve = solverMode === 'pipeline' ? solvePipeline : solveOneShot;
console.error(`[humaneval] solver-mode: ${solverMode}${solverMode === 'pipeline' ? ` (max ${maxIter} iterations)` : ''}`);
const report = await runHumanEvalGrounding(problems, solve);
console.error(`[humaneval] resolved ${report.resolved}/${report.total}`);
console.log(formatPassRateLine(report));
