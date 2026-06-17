// danteforge-solve.mjs — the DanteForge-as-solver adapter for the pluggable --solve-command seam.
// Plug into the contamination-resistant pipeline as the TREATMENT arm of the DanteForge-vs-raw A/B:
//   node scripts/run-swebench-grounding.mjs --dataset live --solve-command "node scripts/danteforge-solve.mjs"
// vs the BASELINE arm (raw, one-shot): --solver "claude -p". Same model, same grader (cloud) — the only
// difference is DanteForge's STRUCTURE. A real resolve-rate lift = the contamination-resistant proof that
// DanteForge improves AI coding, the answer to "does the framework actually help".
//
// Contract (from run-swebench-grounding.mjs): runs in cwd = the cloned repo, gets the issue (+ any
// regression feedback) via $SWEBENCH_TASK_FILE, edits SOURCE files; the harness reads `git diff` as the
// patch (and reverts any test-file edits). This adapter drives the model through the 3-phase structured
// discipline (understand → implement → verify) under one persistent session so context carries across phases.
//
// SAFETY: grading is NOT done here (that is the harness's Docker step — cloud only). Solving = clone + model
// calls, which is light. --dry-run / DANTEFORGE_SOLVE_DRYRUN=1 prints the plan without calling the model.
import 'tsx/esm';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const { parseTaskFile, solvePhases } = await import('../src/matrix/engines/danteforge-solver-steps.ts');

const taskFile = process.env.SWEBENCH_TASK_FILE;
if (!taskFile || !existsSync(taskFile)) { console.error('[df-solve] no readable $SWEBENCH_TASK_FILE'); process.exit(2); }
const task = parseTaskFile(readFileSync(taskFile, 'utf8'));
const phases = solvePhases(task);

// The model command. Default uses claude in print mode with autonomous edits; override for the A/B or tests.
const CLAUDE = process.env.DANTEFORGE_SOLVE_CLAUDE || 'claude -p --permission-mode acceptEdits';
const dryRun = process.argv.includes('--dry-run') || process.env.DANTEFORGE_SOLVE_DRYRUN === '1';
const timeoutMs = Number(process.env.DANTEFORGE_SOLVE_TIMEOUT_MS || '600000') || 600000;
const sessionId = randomUUID(); // one persistent session so phases 2-3 keep the phase-1 understanding

for (let i = 0; i < phases.length; i++) {
  const { phase, prompt } = phases[i];
  const sessFlag = i === 0 ? `--session-id ${sessionId}` : `--resume ${sessionId}`;
  const cmd = `${CLAUDE} ${sessFlag} "${prompt.replace(/"/g, '\\"').slice(0, 12000)}"`;
  console.error(`[df-solve] phase ${i + 1}/3 (${phase})${dryRun ? ' [dry-run]' : ''}`);
  if (dryRun) { console.log(`DRYRUN ${i + 1} ${phase} ${sessFlag.split(' ')[0]}`); continue; }
  const r = spawnSync(cmd, { shell: true, cwd: process.cwd(), timeout: timeoutMs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) console.error(`[df-solve] phase ${phase} exited ${r.status}: ${(r.stderr || '').slice(-160)}`);
}
console.error('[df-solve] structured 3-phase solve complete — `git diff` (source-only) is the patch');
