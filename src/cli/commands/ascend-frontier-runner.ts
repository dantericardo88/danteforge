// ascend-frontier-runner.ts — the typed CLI runner + run-ledger plumbing for the orchestrator.
//
// The council flagged the orchestrator's old `df()` helper as "a side-effect shell pipeline that
// swallows failures and infers truth by re-reading state": it ran the CLI inside `.catch(() => {})`,
// throwing away exit code AND stderr, so a half-failed command looked identical to success.
//
// `runCli` replaces it: it NEVER throws, but it also never discards what happened — every invocation
// returns a typed {exitCode, stdout, stderr, ms, ok} and is recorded to the active RunLedger. A
// non-zero exit is now visible in the run bundle instead of being silently inferred away.

import { spawn } from 'node:child_process';
import type { RunLedger } from '../../core/run-ledger.js';
import { trackChild, untrackChild, killTree, SPAWN_DETACHED } from '../../core/process-tree.js';
import { detectProviderOutage } from '../../core/provider-outage.js';

/** Keep at most the last N bytes of each captured stream — a 30-min build must never buffer unbounded. */
const STREAM_TAIL_CAP = 256 * 1024;

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
  ok: boolean;
}

// The orchestrator runs as a single sequential loop (parallel builds are separate CLI processes,
// not re-entrant in-process), so a module-scoped "active ledger" lets the deep push helpers record
// their sub-commands without threading the ledger through every signature.
let activeLedger: RunLedger | null = null;
export function setActiveLedger(ledger: RunLedger | null): void { activeLedger = ledger; }
export function getActiveLedger(): RunLedger | null { return activeLedger; }

/** When the last phase-timeout tree-kill fired — the next spawn waits out the reaper (see runCli). */
let lastTreeKillAt = 0;

/**
 * Phase-aware tree-kill cap (fleet run 2 dead-loop fix). The old UNIFORM 30-minute cap killed
 * build-to-7 mid-dim-001 every cycle: harden-crusade's inner per-dim autoresearch budget defaulted
 * to the SAME 30 minutes, so the outer kill always landed mid-cycle, the merge-back died with the
 * process, NOTHING persisted, and the next cycle restarted at dim001 — two fleet repos ran
 * identical no-progress cycles forever. Build phases (harden-crusade and the council crusades) now
 * get 60 minutes; paired with the 18m inner cycle budget + --max-minutes 55 checkpoint-exit they
 * finish and PERSIST on their own, so this cap is strictly a zombie guard, never the exit path.
 * Every other sub-command keeps the 30-minute cap.
 */
export function phaseTimeoutMs(args: string[]): number {
  const cmd = args[0] ?? '';
  // council-crusade/council run BUILDERS, which now get the real 30m leash (builderTimeoutMs,
  // CH-006) — a build round + revision cycle + merge court must FIT under the zombie guard
  // (L6 clock-nesting: outer cap > sum of inner budgets + slack), so those phases get 2h.
  if (cmd === 'council-crusade' || cmd === 'council') return 120 * 60_000;
  if (cmd === 'harden-crusade') return 60 * 60_000;
  return 30 * 60_000;
}

function truncate(s: string | undefined, n = 4000): string | undefined {
  if (!s) return undefined;
  return s.length > n ? `${s.slice(0, n)}…[+${s.length - n} chars]` : s;
}

// ── Process-control seam (laws harness) ──────────────────────────────────────
// The L4 process-hygiene law (tests/laws/laws-l4-process-hygiene.test.ts) drives runCli with
// RECORDING implementations of the spawn/track/kill surface so the track↔untrack pairing and the
// timeout tree-kill (exit 124) path are machine-checked without real long-lived children.
// Production behavior is unchanged: the defaults below ARE the real functions, and nothing in
// src ever calls setRunnerProcessControl.

export interface RunnerProcessControl {
  spawnFn: typeof spawn;
  trackChildFn: typeof trackChild;
  untrackChildFn: typeof untrackChild;
  killTreeFn: typeof killTree;
  phaseTimeoutMsFn: (args: string[]) => number;
}

function realProcessControl(): RunnerProcessControl {
  return { spawnFn: spawn, trackChildFn: trackChild, untrackChildFn: untrackChild, killTreeFn: killTree, phaseTimeoutMsFn: phaseTimeoutMs };
}

let processControl: RunnerProcessControl = realProcessControl();

/** Install recording overrides (laws harness) or, with no argument, restore the real surface. */
export function setRunnerProcessControl(next?: Partial<RunnerProcessControl>): void {
  processControl = next ? { ...realProcessControl(), ...next } : realProcessControl();
}

// ── Budget-window + provider-outage awareness (self-challenge #7, CH-019) ──────
// The agent CLIs share a session usage limit; when it fires, EVERY subsequent build/judge fails
// with the same error until the window reopens ("You've hit your session limit · resets 7:10pm",
// or codex's "usage limit … try again at 8:45 PM"). Untimed outages (auth failures, quota) fail
// the same way with no reset time. Before this, a campaign near the limit burned its remaining
// cycles on guaranteed failures — and CH-019: the orchestrator misrecorded those as PERMANENT
// generator-ceilings. The runner detects the outage and records the resume instant; the orchestrator
// pauses the loop until then and records NOTHING durable for the affected cycle.

/** Untimed-outage backoff: how long to sleep when the provider error names no reset time. A fixed
 *  sleep is strictly better than burning cycles on guaranteed failures. Env-tunable (floor 60s). */
function outageBackoffMs(): number {
  const env = Number.parseInt(process.env['DANTEFORGE_OUTAGE_BACKOFF_MS'] ?? '', 10);
  if (Number.isFinite(env) && env >= 60_000) return env;
  return 20 * 60_000;
}

let budgetPauseUntilMs: number | null = null;
// The orchestrator consumes this AFTER each action: a non-null marker means a provider outage was
// detected during the cycle's sub-commands, so the cycle's lack of progress was the outage — not a
// generator failure — and must NOT advance any no-progress counter or mint a ceiling (CH-019).
let pendingOutage: { signature: string; at: number } | null = null;

/**
 * Detect a provider outage in sub-command output and, if found, set the pause-until instant (the
 * named reset, or now + backoff) AND raise the pending-outage marker for the orchestrator. Pure
 * given nowMs except for the two module-scoped sinks it intentionally updates.
 */
export function noteProviderOutage(output: string, nowMs: number = Date.now()): { outage: boolean; resumeAtMs: number; signature: string } | null {
  const o = detectProviderOutage(output, nowMs);
  if (!o.outage) return null;
  const resume = o.resumeAtMs ?? nowMs + outageBackoffMs();
  budgetPauseUntilMs = Math.max(budgetPauseUntilMs ?? 0, resume);
  pendingOutage = { signature: o.signature, at: nowMs };
  return { outage: true, resumeAtMs: resume, signature: o.signature };
}

/**
 * Raise a STRUCTURAL outage (CH-020): the court proved every judge was unavailable, with no provider
 * error string to parse. Schedule the default backoff and raise the cycle marker, exactly like a
 * signature-matched untimed outage — so a NEVER-BEFORE-SEEN provider failure still PAUSES instead of
 * being booked toward a ceiling. Returns the resume instant.
 */
export function noteStructuralOutage(signature: string, nowMs: number = Date.now()): number {
  const resume = nowMs + outageBackoffMs();
  budgetPauseUntilMs = Math.max(budgetPauseUntilMs ?? 0, resume);
  pendingOutage = { signature: signature.slice(0, 160), at: nowMs };
  return resume;
}

/** Back-compat shim (self-challenge #7): returns the pause-until instant ONLY for a TIMED limit
 *  (named reset). Untimed outages return null here but are still handled by noteProviderOutage. */
export function noteBudgetLimit(output: string, nowMs: number = Date.now()): number | null {
  const o = detectProviderOutage(output, nowMs);
  if (!o.outage || o.resumeAtMs === null) return null;
  budgetPauseUntilMs = Math.max(budgetPauseUntilMs ?? 0, o.resumeAtMs);
  return budgetPauseUntilMs;
}

export function getBudgetPauseUntil(): number | null { return budgetPauseUntilMs; }
export function clearBudgetPause(): void { budgetPauseUntilMs = null; }

/** Non-clearing read of the pending-outage marker (used inside a cycle to gate counter increments). */
export function peekPendingOutage(): { signature: string } | null {
  return pendingOutage ? { signature: pendingOutage.signature } : null;
}
/** Read AND clear the pending-outage marker (used after a cycle to log + reset for the next cycle). */
export function consumePendingOutage(): { signature: string } | null {
  const p = pendingOutage;
  pendingOutage = null;
  return p ? { signature: p.signature } : null;
}
/** Clear the marker without reading (used at the top of each cycle for a fresh slate). */
export function clearPendingOutage(): void { pendingOutage = null; }

export interface CourtParse {
  verdict: 'VALIDATED' | 'REJECTED';
  passedByJudges: string[];
  /** True when we could NOT read the court's answer (non-zero exit / no JSON) — REJECTED defensively. */
  parseError: boolean;
  /** True when the court RAN but EVERY judge abstained (0 PASS, 0 FAIL, ≥1 UNCLEAR) — the signature
   *  of a provider outage (failed judge adapters parse to UNCLEAR) or judges that genuinely couldn't
   *  tell. Either way it is NOT a clean capability rejection: the caller must not persist it as
   *  court-feedback or as generator-ceiling provenance (CH-019). */
  allAbstained: boolean;
  /** True when EVERY judge was structurally UNAVAILABLE (adapter threw/failed/timed-out), not merely
   *  uncertain — a provider outage proven by the court's own shape, with NO dependence on matching the
   *  provider's error wording (CH-020). The orchestrator pauses on this even when no signature matched. */
  allUnavailable: boolean;
  /** CH-010: a strict MAJORITY of judges abstained (UNCLEAR-dominant) even if ≥1 cast a FAIL — the
   *  panel could not decide. A lone dissent among abstainers is not a clean capability rejection; the
   *  caller routes this to a re-attemptable non-run, NOT a recorded rejection. (allAbstained ⊆ this.) */
  abstainDominant: boolean;
  /** Partial-seating OUTAGE (council 2026-06-22, Claude): the court convened but consensus was INSUFFICIENT
   *  (fewer than 2 LIVE cross-member judges — e.g. a 2-judge quorum that lost one mid-run). NOT a merits
   *  rejection; the caller routes it to a re-attemptable non-run, exactly like abstainDominant. */
  insufficient: boolean;
  /** CH-062: a VALIDATED verdict the CIP gate DOWNGRADED to a ceiling (the court ran, the integrity backstop
   *  caught stub/zero-outcome evidence) — a durable REJECTED, NEVER a parse error or build failure. */
  cipDowngraded: boolean;
}

/**
 * Parse `frontier-review --json` output into a verdict. The key honesty property: absent/garbage
 * JSON yields `parseError: true` (verdict defensively REJECTED) so the caller can record "we don't
 * actually know" rather than treating a corrupt stream as a clean rejection.
 *
 * Exit-code coherence (live pilot finding, fleet run 3): the frontier-review CLI exits 1 on an
 * honest REJECTED *by design* — so a complete court JSON carrying REJECTED on a non-zero exit IS
 * a court that ran, and must be recorded as a rejection. The old `!res.ok` short-circuit booked
 * EVERY honest rejection as "court didn't run" (build failure), churning re-convened judges on
 * retries and never feeding the attempt ledger. VALIDATED always exits 0, so a non-zero exit
 * claiming VALIDATED is incoherent (e.g. --write failed after printing) — fail CLOSED there only.
 */
export function parseCourtOutput(res: { ok: boolean; stdout: string }): CourtParse {
  const fail = (parseError: boolean): CourtParse => ({ verdict: 'REJECTED', passedByJudges: [], parseError, allAbstained: false, allUnavailable: false, abstainDominant: false, insufficient: false, cipDowngraded: false });
  const brace = res.stdout.indexOf('{');
  if (brace === -1) return fail(true);
  try {
    const j = JSON.parse(res.stdout.slice(brace)) as {
      validatedWritten?: boolean; ceilingWritten?: boolean;
      result?: { verdict?: string; judges?: { verdict: string; judgeId: string; unavailable?: boolean }[]; vote?: { crossMember?: number; summary?: string } };
    };
    if (typeof j?.result?.verdict !== 'string') return fail(true);
    const verdict = j.result.verdict === 'VALIDATED' ? 'VALIDATED' : 'REJECTED';
    // CH-062 (council 2026-06-22, Codex): a VALIDATED verdict the CIP gate DOWNGRADED (validatedWritten=false +
    // ceilingWritten=true; the CLI legitimately exits 1) is a real INTEGRITY rejection — the court ran and the
    // structural backstop caught stub/zero-outcome evidence. Book it REJECTED+courtRan, NOT a parse error/build
    // failure (which would churn). Checked BEFORE the !ok+VALIDATED incoherence guard, since this case exits 1.
    if (verdict === 'VALIDATED' && j.validatedWritten === false && j.ceilingWritten === true) {
      return { verdict: 'REJECTED', passedByJudges: [], parseError: false, allAbstained: false, allUnavailable: false, abstainDominant: false, insufficient: false, cipDowngraded: true };
    }
    if (!res.ok && verdict === 'VALIDATED') return fail(true);
    const judges = j.result.judges ?? [];
    const passedByJudges = judges.filter(x => x.verdict === 'PASS').map(x => x.judgeId);
    // All-abstained: the court ran (≥1 judge) but none reached a PASS or a FAIL. A genuine REJECTED
    // always carries ≥1 FAIL; an all-UNCLEAR court is an outage/can't-tell signal, not a no.
    const allAbstained = judges.length > 0
      && passedByJudges.length === 0
      && judges.filter(x => x.verdict === 'FAIL').length === 0;
    // All-unavailable (CH-020): every judge was structurally unable to run. Proven by the court's own
    // shape — no dependence on the provider's error wording. allUnavailable ⊆ allAbstained.
    const allUnavailable = judges.length > 0 && judges.every(x => x.unavailable === true);
    // CH-010: abstain-DOMINANT — a strict majority abstained even if a lone judge cast a FAIL. Mirror
    // computeConsensus's UNCLEAR-dominant guard so the push routes "the panel couldn't decide" to a
    // re-attemptable non-run instead of booking a single dissent as a clean court rejection.
    const unclearCount = judges.filter(x => x.verdict === 'UNCLEAR').length;
    const abstainDominant = judges.length > 0 && unclearCount * 2 > judges.length;
    // Partial-seating INSUFFICIENT (council 2026-06-22, Claude): a 2-judge quorum that loses ONE judge mid-run
    // yields consensus INSUFFICIENT (crossMember<2). The per-judge counts above MISS it (1 UNCLEAR of 2 is not
    // abstain-dominant), so without this the orchestrator books "couldn't convene 2 LIVE judges" as a MERITS
    // reject — re-poisoning the verdict→builder loop CH-019/CH-020 fixed for the all-abstain case. Read the
    // consensus signal directly and route it to a re-attemptable non-run.
    const vote = j.result.vote;
    const insufficient = (typeof vote?.crossMember === 'number' && vote.crossMember < 2)
      || /insufficient/i.test(vote?.summary ?? '');
    return { verdict, passedByJudges, parseError: false, allAbstained, allUnavailable, abstainDominant, insufficient, cipDowngraded: false };
  } catch {
    return fail(true);
  }
}

function runOnce(cwd: string, args: string[]): Promise<CliResult> {
  const node = process.execPath;
  const cli = process.argv[1] ?? 'dist/index.js';
  const start = Date.now();
  // spawn + size-capped streaming capture — NOT execFile's fixed maxBuffer, which a long build
  // overflows → destroyed pipe → EPIPE / exit 127 with no ledger (DanteSecurity DS-024). We always
  // consume the data events (no backpressure) and keep only the last STREAM_TAIL_CAP bytes.
  return new Promise<CliResult>((resolve) => {
    let out = '', err = '', settled = false;
    let lastOutputAt = Date.now();
    const cap = (s: string) => (s.length > STREAM_TAIL_CAP ? s.slice(s.length - STREAM_TAIL_CAP) : s);
    // stdin:'ignore' — an unattended sub-command that prompts gets EOF and fails fast instead of
    // blocking forever (the silent autoresearch hang the fleet hit). detached on POSIX for group-kill.
    const child = processControl.spawnFn(node, [cli, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: SPAWN_DETACHED });
    processControl.trackChildFn(child.pid);
    const done = (exitCode: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      processControl.untrackChildFn(child.pid);
      // Budget-window + provider-outage awareness (self-challenge #7, CH-019): agent CLIs surface
      // their shared usage limit AND auth/quota failures as errors here. Detect them so the
      // orchestrator can PAUSE until the window reopens (and skip ceiling-minting for the affected
      // cycle) instead of burning cycles on builds/judges that all fail the same way.
      noteProviderOutage(out + '\n' + err);
      resolve({ exitCode, stdout: out, stderr: err, ms: Date.now() - start, ok: exitCode === 0 });
    };
    // On timeout, kill the WHOLE tree (harden-crusade + its autoresearch grandchildren), not just the
    // direct child — otherwise the grandchildren orphan and accumulate as zombies across sessions.
    const timer = setTimeout(() => { lastTreeKillAt = Date.now(); processControl.killTreeFn(child.pid); done(124); }, processControl.phaseTimeoutMsFn(args));
    // LIVE ECHO + HEARTBEAT — the fleet's "silent stall": piped output was captured but never shown,
    // so a 20-min build-to-7 looked frozen and operators killed healthy runs. Echo the child's lines
    // as they arrive (prefixed, so the operator sees the real sub-command working), and when the child
    // goes quiet, say so every 60s with how long it has been silent — a stall is now an OBSERVED fact
    // ("silent for 12m"), not an inference from a blank console.
    const label = args[0] ?? 'sub-command';
    // ALWAYS echo to stderr: the parent's stdout is a machine contract (--json prints the final
    // result there) — interleaving sub-command lines into it would break every JSON consumer.
    const echo = (d: Buffer) => {
      lastOutputAt = Date.now();
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) process.stderr.write(`  [${label}] ${line}\n`);
      }
      return text;
    };
    const heartbeat = setInterval(() => {
      const silentMs = Date.now() - lastOutputAt;
      if (silentMs >= 55_000) {
        process.stderr.write(`  [${label}] … still running (${Math.round((Date.now() - start) / 60_000)}m elapsed, no output for ${Math.round(silentMs / 60_000)}m)\n`);
      }
    }, 60_000);
    child.stdout?.on('data', (d: Buffer) => { out = cap(out + echo(d)); });
    child.stderr?.on('data', (d: Buffer) => { err = cap(err + echo(d)); });
    // ENOENT (binary not found) → 127, matching a shell "command not found".
    child.on('error', (e: NodeJS.ErrnoException) => done(e.code === 'ENOENT' ? 127 : 1));
    child.on('close', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

/**
 * Run `node <cli> <args>` in `cwd`, capturing exit code, stdout, stderr and duration.
 *
 * NEVER throws — a failure is returned as `{ ok: false, exitCode }`, **logged loudly**, and recorded
 * to the active RunLedger, so the orchestrator can act on a failure rather than swallow it (the
 * council asked for exactly this: surface the failing command + exit code instead of a silent abort).
 *
 * A *fast* exit 127 / ENOENT (a command-not-found that failed at spawn time, before doing any work)
 * is the intermittent Windows child-spawn glitch the fleet hit — it is retried once after a short
 * backoff. A 127 that arrives only after real work ran (a deep child died) is NOT retried (it would
 * re-run minutes of work); it's returned for the loop to handle as a build failure.
 */
export async function runCli(cwd: string, args: string[]): Promise<CliResult> {
  // Breadcrumb BEFORE the spawn: if this parent is killed while the child runs, the post-resolve
  // logCommand() below never fires — without this line the run's commands-live.jsonl is empty and the
  // crash is undebuggable (DanteSecurity DS-026). Synchronous append guarantees it's on disk first.
  activeLedger?.logCommandStart('danteforge', args, cwd);
  // Kill/spawn race guard (live DanteForge run: parent died 5s after a 124 tree-kill, no logs):
  // the previous phase's timeout fires a DETACHED `taskkill /T /F` that enumerates the old child's
  // tree asynchronously — spawning the next phase immediately puts fresh PIDs in the reuse window
  // while that enumeration is still walking. Let the reaper finish before populating new PIDs.
  if (lastTreeKillAt > 0 && Date.now() - lastTreeKillAt < 5_000) {
    await new Promise(r => setTimeout(r, 5_000 - (Date.now() - lastTreeKillAt)));
  }
  let res = await runOnce(cwd, args);
  // Retry only a spawn-time 127/ENOENT (failed in <3s ⇒ nothing ran ⇒ transient spawn race).
  if (!res.ok && res.exitCode === 127 && res.ms < 3000) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] transient spawn failure (exit 127, ${res.ms}ms) for "danteforge ${args[0]}" — retrying once`);
    await new Promise(r => setTimeout(r, 750));
    res = await runOnce(cwd, args);
  }
  activeLedger?.logCommand('danteforge', args, res.exitCode, res.ms, truncate(res.stdout), truncate(res.stderr), cwd);
  if (!res.ok) {
    const { logger } = await import('../../core/logger.js');
    logger.warn(`[ascend-frontier] sub-command FAILED (exit ${res.exitCode}, ${res.ms}ms): danteforge ${args.join(' ')}${res.stderr ? ` — ${truncate(res.stderr, 300)}` : ''}`);
  }
  return res;
}
