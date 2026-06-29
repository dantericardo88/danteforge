// loop-exit-classifier.ts — the brain of the auto-reengage Supervisor. PURE: given how an inner loop
// engine ended (its LoopRunSummary status/ceiling, any crash output, and how many stale restarts we've
// already burned), decide the SINGLE next supervisor action — restart, wait-then-restart, pause, or stop.
//
// This is the missing piece the loop-machinery audit named: DanteForge's 7 loop engines all exit CLEANLY
// with a status, but nothing re-engages them. The classifier encodes the "tiered autonomy" contract the
// operator chose: TRANSIENT stops (degraded panel / provider outage / crash / max-cycles-with-progress)
// auto-restart; only a REAL capability ceiling or a policy/budget stop pauses for a human. A circuit
// breaker stops the loop from burning forever on a wall it cannot climb.
//
// Side-effect free and deterministic given `nowMs` — the supervisor's control flow is unit-testable with
// fakes (no subprocess, no clock, no network), exactly like autonomous-loop-runner.ts.

import { detectProviderOutage } from './provider-outage.js';

/** How aggressively the supervisor re-engages. Chosen by the operator (default: tiered). */
export type Posture = 'tiered' | 'afk' | 'notify';

/** The one action the supervisor takes after an engine run ends. */
export type SupervisorAction =
  | { kind: 'restart'; reason: string; backoffMs: number }
  /** Provider outage with a NAMED reset instant — sleep until then, not a blind backoff. */
  | { kind: 'resume-at'; reason: string; resumeAtMs: number; backoffMs: number }
  /** Human-in-loop stop. escalate=true → decompose the ceiling into a worklist (no-walls). */
  | { kind: 'pause'; reason: string; escalate: boolean }
  /** Terminal success — the campaign target was reached. */
  | { kind: 'stop'; reason: string };

/** Everything the classifier needs to know about how the last engine run ended. */
export interface LoopExit {
  /** From LoopRunSummary.status — 'paused' (recoverable) or 'stopped' (terminal-from-the-loop's-view). */
  status: 'paused' | 'stopped';
  /** From LoopRunSummary.ceilingHit — true only for the honest capability ceiling. */
  ceilingHit: boolean;
  /** From LoopRunSummary.finalReason — parsed for budget/policy signatures. */
  finalReason: string;
  /** Combined stdout/stderr tail (or the thrown error) — scanned for provider-outage signatures. */
  output?: string;
  /** The engine THREW instead of returning a summary (e.g. docker down, worktree exploded). */
  crashed?: boolean;
  /** The campaign target has been reached (measured externally). */
  targetReached?: boolean;
  /** Consecutive prior restarts that produced NO grounding progress — drives backoff + circuit breaker. */
  staleRestarts?: number;
}

export interface ClassifyConfig {
  posture: Posture;
  /** First backoff; doubles per stale restart up to maxBackoffMs. Default 5s. */
  baseBackoffMs?: number;
  /** Backoff ceiling. Default 5 min. */
  maxBackoffMs?: number;
  /** Stale restarts before the circuit breaker forces a pause+escalate. Default 5. */
  maxStaleRestarts?: number;
}

const DEFAULTS = { baseBackoffMs: 5_000, maxBackoffMs: 5 * 60_000, maxStaleRestarts: 5 };

/** A budget/cost stop (not a capability ceiling) — pausable in tiered/notify, restartable in afk. */
export function isBudgetStop(reason: string): boolean {
  return /budget|token limit|out of (?:budget|tokens)|cost cap/i.test(reason);
}

/** A policy/governance block (court BLOCKED_BY_POLICY, gate refusal). */
export function isPolicyStop(reason: string): boolean {
  return /policy|blocked_by_policy|gate (?:blocked|refused)|governance|confirm/i.test(reason);
}

/** Exponential backoff bounded by maxBackoffMs. */
export function backoffFor(staleRestarts: number, cfg: ClassifyConfig): number {
  const base = cfg.baseBackoffMs ?? DEFAULTS.baseBackoffMs;
  const max = cfg.maxBackoffMs ?? DEFAULTS.maxBackoffMs;
  return Math.min(max, base * 2 ** Math.max(0, staleRestarts));
}

/**
 * Decide the next supervisor action from how the engine run ended. Pure given nowMs.
 *
 * Order of precedence: target reached → provider outage (named/blind) → circuit breaker → ceiling →
 * budget/policy → degraded-panel pause → ordinary transient (crash / max-cycles) restart.
 */
export function classifyLoopExit(exit: LoopExit, cfg: ClassifyConfig, nowMs: number): SupervisorAction {
  const posture = cfg.posture;
  const stale = exit.staleRestarts ?? 0;
  const maxStale = cfg.maxStaleRestarts ?? DEFAULTS.maxStaleRestarts;
  const backoffMs = backoffFor(stale, cfg);

  // 1. Success — the only happy terminal.
  if (exit.targetReached) return { kind: 'stop', reason: 'campaign target reached' };

  // 2. Provider outage (CH-019): a usage/auth wall hits every build+judge identically. NEVER a ceiling —
  //    wait for the window to reopen. Scanned on both crash output and ordinary output.
  const outage = detectProviderOutage(exit.output ?? '', nowMs);
  if (outage.outage) {
    if (posture === 'notify') return { kind: 'pause', reason: `provider outage: ${outage.signature}`, escalate: false };
    if (outage.resumeAtMs !== null) {
      return { kind: 'resume-at', reason: `provider outage — resume at named reset: ${outage.signature}`, resumeAtMs: outage.resumeAtMs, backoffMs };
    }
    return { kind: 'restart', reason: `provider outage (untimed) — default backoff: ${outage.signature}`, backoffMs };
  }

  // 3. Circuit breaker: too many restarts with zero grounding progress → stop burning, escalate to a
  //    worklist. This is what keeps "fully unattended" from meaning "infinite loop on a guaranteed fail".
  if (stale >= maxStale) {
    return { kind: 'pause', reason: `circuit breaker: ${stale} restarts with no grounding progress — escalating`, escalate: true };
  }

  // 4. Honest capability ceiling — the human-in-loop stop in every posture (afk restarts through
  //    everything EXCEPT a hard frontier ceiling). Escalated so it ends with a worklist, never a wall.
  if (exit.ceilingHit) {
    return { kind: 'pause', reason: `capability ceiling: ${exit.finalReason}`, escalate: true };
  }

  // 5. Policy/governance block — never auto-overridden; a human owns the next step.
  if (isPolicyStop(exit.finalReason)) {
    return { kind: 'pause', reason: `policy block: ${exit.finalReason}`, escalate: false };
  }

  // 6. Budget/cost stop — tiered/notify pause; afk resets the window and restarts.
  if (isBudgetStop(exit.finalReason)) {
    if (posture === 'afk') return { kind: 'restart', reason: `budget window reset (afk): ${exit.finalReason}`, backoffMs };
    return { kind: 'pause', reason: `budget reached: ${exit.finalReason}`, escalate: false };
  }

  // 7. notify posture pauses on any remaining stop; the operator drives each re-engage.
  if (posture === 'notify') {
    return { kind: 'pause', reason: `notify posture — manual re-engage: ${exit.finalReason}`, escalate: false };
  }

  // 8. Everything else is TRANSIENT — degraded panel (CH-049), crash/docker-down (CH-035), or
  //    max-cycles-with-progress. Auto-restart with backoff. THIS is the auto-reengage that was missing.
  const cause = exit.crashed ? 'engine crashed' : exit.status === 'paused' ? 'degraded panel (recoverable)' : 'cycle cap with progress';
  return { kind: 'restart', reason: `transient — ${cause}: ${exit.finalReason}`, backoffMs };
}
