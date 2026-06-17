// raw-solve.mjs — the BUDGET-MATCHED control arm of the DanteForge-vs-raw A/B (council make-or-break fix).
// Identical session/turn mechanics to scripts/danteforge-solve.mjs, but UNstructured prompts (rawTurns):
// turn 1 = "fix it", later turns = "keep going". Same model, same turn budget (default 3, matched to the
// treatment's 3 phases), same persistent session — so the A/B isolates DanteForge's STRUCTURE, not sheer
// inference volume. Without this control a treatment win is uninterpretable (more calls vs better method).
//
//   baseline (budget-matched):  --solve-command "node scripts/raw-solve.mjs"
//   treatment (structured):     --solve-command "node scripts/danteforge-solve.mjs"
//   (and optionally the raw ONE-shot: --solver "claude -p", to also see structure-vs-one-shot.)
//
// SAFETY: solving only (clone + model calls); grading is the harness's cloud-only Docker step. --dry-run /
// DANTEFORGE_SOLVE_DRYRUN=1 prints the plan without calling the model.
import 'tsx/esm';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const { parseTaskFile, rawTurns } = await import('../src/matrix/engines/danteforge-solver-steps.ts');

const taskFile = process.env.SWEBENCH_TASK_FILE;
if (!taskFile || !existsSync(taskFile)) { console.error('[raw-solve] no readable $SWEBENCH_TASK_FILE'); process.exit(2); }
const task = parseTaskFile(readFileSync(taskFile, 'utf8'));
const turnCount = Number(process.env.DANTEFORGE_SOLVE_TURNS || '3') || 3; // match the treatment's phase count
const turns = rawTurns(task, turnCount);

const CLAUDE = process.env.DANTEFORGE_SOLVE_CLAUDE || 'claude -p --permission-mode acceptEdits';
const dryRun = process.argv.includes('--dry-run') || process.env.DANTEFORGE_SOLVE_DRYRUN === '1';
const timeoutMs = Number(process.env.DANTEFORGE_SOLVE_TIMEOUT_MS || '600000') || 600000;
const sessionId = randomUUID();

for (let i = 0; i < turns.length; i++) {
  const sessFlag = i === 0 ? `--session-id ${sessionId}` : `--resume ${sessionId}`;
  const cmd = `${CLAUDE} ${sessFlag} "${turns[i].prompt.replace(/"/g, '\\"').slice(0, 12000)}"`;
  console.error(`[raw-solve] turn ${i + 1}/${turns.length} (raw)${dryRun ? ' [dry-run]' : ''}`);
  if (dryRun) { console.log(`DRYRUN ${i + 1} raw ${sessFlag.split(' ')[0]}`); continue; }
  const r = spawnSync(cmd, { shell: true, cwd: process.cwd(), timeout: timeoutMs, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) console.error(`[raw-solve] turn ${i + 1} exited ${r.status}: ${(r.stderr || '').slice(-160)}`);
}
console.error(`[raw-solve] budget-matched raw solve complete (${turns.length} turns) — git diff (source-only) is the patch`);
