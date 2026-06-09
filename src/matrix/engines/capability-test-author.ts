// capability-test-author.ts — the honesty backbone of autonomous yardstick authoring.
//
// The council's biggest risk for a no-human loop: the system writes itself an EASY EXAM (a yardstick it
// can trivially pass) and "climbs" against fiction. The structural defense is that an authored
// capability_test must clear three deterministic gates BEFORE it is installed — none of which an
// easy/green/decoupled test can pass:
//
//   1. INTEGRITY  — it must classify as a REAL wired probe (REAL_TEST / REAL_PRODUCT_PROBE), never a
//                   SELF_FULFILLING_STUB / STRUCTURAL_ONLY / SCAFFOLD (reuses the yardstick auditor).
//   2. GROUNDED   — the dim must have a competitor-grounded Score Ladder (the bar is researched, not
//                   invented), so the target is the real frontier, not an agent's soft self-set goal.
//   3. RED        — the test must FAIL on current HEAD. A yardstick that already PASSES is measuring
//                   nothing to build: it is either already-built (not an authoring target) or, far more
//                   likely for a freshly-authored test, a GREEN STUB. Only a red test proves there is a
//                   genuine, unbuilt capability gap for the capable agent to close.
//
// The author (the examiner agent) is separate from the builder, and writes ONLY the yardstick file —
// so the builder can never edit the exam it is graded against. This module is the deterministic gate;
// the creative authoring is delegated to the capable coding agent, exactly as the build step is.

import { execFile } from 'node:child_process';
import { auditCapabilityTest, type YardstickVerdict } from './capability-test-integrity.js';

export interface YardstickCandidate {
  dimId: string;
  /** The proposed capability_test shell command. */
  command: string;
  /** The production src/ file the test must exercise (its required_callsite). */
  callsite: string;
}

export interface AcceptanceResult {
  dimId: string;
  accepted: boolean;
  /** Why it was rejected (empty when accepted). */
  reasons: string[];
  auditVerdict: YardstickVerdict;
  /** RED = fails on HEAD for a CAPABILITY reason (the only acceptable state for an authored yardstick);
   *  GREEN = already passes (rejected — a green stub); RED_INVALID = fails for a LAUNCH/SYNTAX/ENV reason
   *  (unknown command / module-not-found / bad flag), NOT a capability gap (rejected); ERROR = could not
   *  run (inconclusive, rejected). */
  redGate: 'RED' | 'GREEN' | 'RED_INVALID' | 'ERROR';
}

type RunFn = (command: string, cwd: string, timeoutMs: number) => Promise<{ exitCode: number; output?: string }>;

/** Default runner: execute through the shell; return the exit code AND combined stdout+stderr (so the RED
 *  gate can tell a real capability failure from a launch/syntax/env failure). */
const defaultRun: RunFn = (command, cwd, timeoutMs) =>
  new Promise(resolve => {
    const child = execFile(command, { cwd, shell: true, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = (err as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
      resolve({ exitCode: typeof code === 'number' ? code : (err ? 1 : 0), output: `${stdout ?? ''}\n${stderr ?? ''}` });
    });
    child.on('error', () => resolve({ exitCode: 1, output: '' }));
  });

/** A non-zero exit caused by the command failing to LAUNCH (not by a real capability gap). */
const LAUNCH_FAILURE_RE = /unknown command|command not found|is not recognized|MODULE_NOT_FOUND|cannot find module|SyntaxError|ENOENT|unknown option|unexpected argument|no such file/i;
function isLaunchFailure(exitCode: number, output: string): boolean {
  return exitCode === 127 || LAUNCH_FAILURE_RE.test(output);
}

/** A command rigged to exit non-zero regardless of the real capability — a MANUFACTURED red. */
const MANUFACTURED_RED_RE = /process\.exit\(\s*[1-9]|(?:^|;|&&|\|)\s*exit\s+[1-9]|\|\s*false\b|&&\s*false\b/i;

/**
 * Evaluate a freshly-authored capability_test candidate against the three honesty gates. Pure of side
 * effects except running the candidate command (the RED gate). `wired` is the project's wired-basename
 * set (buildWiredBasenames); `hasLadder` is whether the dim has a competitor Score Ladder.
 */
export async function evaluateCandidateYardstick(
  candidate: YardstickCandidate,
  ctx: { cwd: string; wired: Set<string>; hasLadder: boolean; timeoutMs?: number; run?: RunFn },
): Promise<AcceptanceResult> {
  const reasons: string[] = [];

  // Gate 1 — INTEGRITY: classify the candidate exactly as the auditor classifies installed yardsticks.
  const audit = auditCapabilityTest(
    { id: candidate.dimId, capability_test: { command: candidate.command }, outcomes: [{ required_callsite: candidate.callsite }] },
    ctx.wired, ctx.hasLadder,
  );
  if (audit.verdict !== 'REAL_TEST' && audit.verdict !== 'REAL_PRODUCT_PROBE') {
    reasons.push(`integrity: candidate is ${audit.verdict} — ${audit.reason}`);
  }

  // Gate 2 — GROUNDED: the bar must come from a researched competitor ladder, not an invented goal.
  if (!ctx.hasLadder) {
    reasons.push('grounded: the dim has no competitor Score Ladder — the loop must research+author the ladder before authoring a frontier yardstick (else the bar is self-set).');
  }

  // Gate 3 — RED: an authored yardstick MUST fail on current HEAD for a CAPABILITY reason. Reject a green
  // candidate, a manufactured red (rigged to exit non-zero regardless of the product), and a RED_INVALID
  // (fails only because the command can't launch — unknown command / module-not-found / bad flag). These
  // are the red-team's "any non-zero exit = real gap" bypass (`node dist/index.js not-a-real-command`).
  if (MANUFACTURED_RED_RE.test(candidate.command)) {
    reasons.push('red: the candidate forces a non-zero exit (process.exit(1) / exit 1 / && false / | false) regardless of the product — a manufactured RED, not a real capability gap.');
  }
  const run = ctx.run ?? defaultRun;
  let redGate: AcceptanceResult['redGate'];
  try {
    const { exitCode, output } = await run(candidate.command, ctx.cwd, ctx.timeoutMs ?? 120_000);
    if (exitCode === 0) redGate = 'GREEN';
    else if (isLaunchFailure(exitCode, output ?? '')) redGate = 'RED_INVALID';
    else redGate = 'RED';
  } catch {
    redGate = 'ERROR';
  }
  if (redGate === 'GREEN') {
    reasons.push('red: the candidate already PASSES on HEAD — an authored yardstick must FAIL until the capability is genuinely built, or it is a green stub measuring nothing.');
  } else if (redGate === 'RED_INVALID') {
    reasons.push('red: the candidate fails for a LAUNCH/SYNTAX/ENV reason (unknown command / module not found / bad flag), not a real capability gap — a yardstick must be RED because the capability is UNBUILT, not because the command is broken.');
  } else if (redGate === 'ERROR') {
    reasons.push('red: the candidate could not be run — inconclusive, so it is not accepted (a yardstick must demonstrably fail for a real capability reason).');
  }

  return { dimId: candidate.dimId, accepted: reasons.length === 0, reasons, auditVerdict: audit.verdict, redGate };
}

// ── Authoring orchestration (examiner agent → gate → install/revert) ─────────────

export interface AuthorResult {
  dimId: string;
  installed: boolean;
  candidate?: YardstickCandidate;
  acceptance?: AcceptanceResult;
  reason: string;
}

export interface AuthorContext {
  cwd: string;
  wired: Set<string>;
  hasLadder: boolean;
  /** The competitor-grounded capability the authored test must target (the Score Ladder's 9-row). */
  ladderBar: string;
  /** The production module the test must genuinely exercise (a wired src/ file). */
  targetModule: string;
  /** Dispatch the EXAMINER agent (distinct from the builder) to author the yardstick. It may write ONLY
   *  the test file + the dim's capability_test field — never the production code it grades. */
  dispatch: (objective: string) => Promise<{ ranOk: boolean; reason?: string }>;
  /** Read back the dim's capability_test command + callsite AFTER the examiner ran. */
  readCandidate: () => Promise<YardstickCandidate | null>;
  /** Restore the dim's capability_test to its prior state when the candidate is rejected. */
  revert: () => Promise<void>;
  timeoutMs?: number;
  run?: RunFn;
}

/** The objective handed to the examiner agent. It must produce a RED, wired, ladder-grounded yardstick. */
export function buildExaminerObjective(dimId: string, ladderBar: string, targetModule: string): string {
  return [
    `You are the EXAMINER. Author a capability_test (a yardstick) for dimension "${dimId}". You are NOT`,
    `allowed to edit production code — only the test file and the dimension's capability_test command.`,
    ``,
    `The test MUST:`,
    `  1. Genuinely EXERCISE the wired production module: ${targetModule} (import/call it — no inline fixtures).`,
    `  2. Demonstrate this competitor-grounded capability (the frontier bar — do NOT soften it):`,
    `       ${ladderBar}`,
    `  3. FAIL on the current code (exit non-zero) because that capability is NOT yet built — it is a RED`,
    `     target for the builder to close. A test that already passes is REJECTED as a green stub.`,
    `Do not write stubs, mocks, or self-fulfilling fixtures that check their own inline data. Set the`,
    `dimension's capability_test.command to run your new test.`,
  ].join('\n');
}

/**
 * Autonomously author a real, failing, ladder-grounded yardstick for a dim, gated by the three honesty
 * checks. The examiner agent does the creative authoring; this orchestration enforces that whatever it
 * produces is genuinely RED + wired + grounded before it is allowed to stand — else it is reverted. No
 * human in the loop, and the system cannot install an easy exam.
 */
export async function authorYardstick(dimId: string, ctx: AuthorContext): Promise<AuthorResult> {
  if (!ctx.hasLadder) {
    return { dimId, installed: false, reason: 'no competitor Score Ladder — the loop must research + author the ladder first (the examiner cannot self-set the frontier bar).' };
  }
  if (!ctx.targetModule) {
    return { dimId, installed: false, reason: 'no wired production module identified to exercise — wire/identify the capability before authoring its yardstick.' };
  }
  const dispatched = await ctx.dispatch(buildExaminerObjective(dimId, ctx.ladderBar, ctx.targetModule));
  if (!dispatched.ranOk) {
    return { dimId, installed: false, reason: `examiner agent did not run: ${dispatched.reason ?? 'unknown'}` };
  }
  const candidate = await ctx.readCandidate();
  if (!candidate) {
    await ctx.revert();
    return { dimId, installed: false, reason: 'examiner produced no usable capability_test command — reverted.' };
  }
  const acceptance = await evaluateCandidateYardstick(candidate, {
    cwd: ctx.cwd, wired: ctx.wired, hasLadder: ctx.hasLadder, timeoutMs: ctx.timeoutMs, run: ctx.run,
  });
  if (!acceptance.accepted) {
    await ctx.revert();
    return { dimId, installed: false, candidate, acceptance, reason: `rejected (reverted): ${acceptance.reasons.join(' | ')}` };
  }
  return { dimId, installed: true, candidate, acceptance, reason: 'installed a real, ladder-grounded, RED yardstick the loop can now build against.' };
}
