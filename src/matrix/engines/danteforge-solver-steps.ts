// danteforge-solver-steps.ts — the STRUCTURED issue-fix discipline that distinguishes a DanteForge solve
// from a raw one-shot `claude -p "fix this"`. It is the treatment arm of the contamination-resistant A/B
// (DanteForge-vs-raw) that the pluggable --solve-command seam enables: same model, with vs without
// DanteForge's structure, refereed by the grader. Pure prompt construction here (no I/O) so the discipline
// is unit-tested; scripts/danteforge-solve.mjs drives the actual claude calls + git in the cloned repo.
//
// The three phases encode DanteForge's real value props for fixing a bug in an existing repo:
//   1. UNDERSTAND — spec the fix: root cause + the MINIMAL source change (no test edits). (spec-driven)
//   2. IMPLEMENT  — the smallest surgical edit per the plan. (disciplined implementation)
//   3. VERIFY     — run the existing relevant tests + reproduce; keep them green, narrow on regression.
//                   (verification gate + the regression-discipline that the 0/5 forensics identified)

export interface SolveTask {
  problem_statement: string;
  hints_text?: string;
}

const SOURCE_ONLY = 'Edit SOURCE files only — never modify, add, or delete test files (the grader resets them; editing tests is cheating and will be reverted).';

/** Phase 1 — UNDERSTAND: localize the root cause and spec the minimal change. No edits yet. */
export function understandPrompt(task: SolveTask): string {
  return (
    `You are a DanteForge engineer fixing a real GitHub issue (cwd = repo root). PHASE 1 of 3: UNDERSTAND.\n` +
    `Explore the codebase, find the ROOT CAUSE, and write a short plan: the exact source file(s)/function(s) ` +
    `to change and the MINIMAL change that fixes the issue. ${SOURCE_ONLY}\n` +
    `Do NOT edit anything yet — output the plan only.\n\nISSUE:\n${task.problem_statement}` +
    (task.hints_text ? `\n\nHINTS:\n${task.hints_text}` : '')
  );
}

/** Phase 2 — IMPLEMENT: the smallest surgical edit per the plan. */
export function implementPrompt(task: SolveTask): string {
  return (
    `PHASE 2 of 3: IMPLEMENT. Apply the SMALLEST possible surgical change that fixes the issue per your plan. ` +
    `Do not refactor, rename, or reformat anything unrelated. ${SOURCE_ONLY}\n` +
    `Make the edits now.\n\nISSUE (for reference):\n${task.problem_statement}`
  );
}

/** Phase 3 — VERIFY: reproduce + run existing tests; keep them green, narrow on regression. */
export function verifyPrompt(task: SolveTask): string {
  return (
    `PHASE 3 of 3: VERIFY. (1) Reproduce the bug and confirm your change fixes it. (2) Run the existing tests ` +
    `for the module(s) you touched. EVERY test that passed before your change MUST still pass — if any now ` +
    `fails, your change is too broad: narrow it to the minimal edit that fixes the issue without breaking ` +
    `them. ${SOURCE_ONLY} Leave only the minimal, verified source fix in the working tree.`
  );
}

/** The ordered structured-solve phases (used by the adapter and asserted by tests). */
export function solvePhases(task: SolveTask): Array<{ phase: 'understand' | 'implement' | 'verify'; prompt: string }> {
  return [
    { phase: 'understand', prompt: understandPrompt(task) },
    { phase: 'implement', prompt: implementPrompt(task) },
    { phase: 'verify', prompt: verifyPrompt(task) },
  ];
}

/**
 * The BUDGET-MATCHED CONTROL arm. The structured solve makes 3 model calls; a raw one-shot makes 1 — so a
 * naive A/B confounds STRUCTURE with sheer inference volume (if DanteForge wins you cannot tell which).
 * This returns N UNstructured turns (default 3, matched to solvePhases) under the same persistent session:
 * turn 1 states the issue, later turns are a generic "keep going" continuation — no understand/implement/
 * verify decomposition. Run BOTH arms at the same turn budget and the only difference is the structure.
 * (Turn-count match, not token match — the strongest cheap control; token-budget matching is a refinement.)
 */
export function rawTurns(task: SolveTask, n = 3): Array<{ phase: 'raw'; prompt: string }> {
  const turns: Array<{ phase: 'raw'; prompt: string }> = [];
  for (let i = 0; i < Math.max(1, n); i++) {
    turns.push({
      phase: 'raw',
      prompt: i === 0
        ? `You are an engineer fixing a real GitHub issue (cwd = repo root). Fix it. ${SOURCE_ONLY}\n\n` +
          `ISSUE:\n${task.problem_statement}${task.hints_text ? `\n\nHINTS:\n${task.hints_text}` : ''}`
        : `Continue working until the bug is fixed and no existing test regresses. ${SOURCE_ONLY}`,
    });
  }
  return turns;
}

/** Parse the SWEBENCH_TASK_FILE contents into a SolveTask. The seam writes the problem statement (+ any
 *  regression feedback) as markdown; we keep the whole text as the statement so feedback rounds carry through. */
export function parseTaskFile(contents: string): SolveTask {
  return { problem_statement: (contents ?? '').trim() };
}
