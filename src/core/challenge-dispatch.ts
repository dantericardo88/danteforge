// challenge-dispatch.ts — the missing CLOSURE loop (Codex/Grok/Claude + council convergent, 2026-06-21):
// "the bottleneck isn't decomposition, it's dispatch closure." obstacle-decomposition.ts FILLS the challenge
// ledger with DEFINED sub-problems; nothing drove them to DONE. This routes each open challenge into a dispatch
// LANE and hands it to the lane's handler, resolving it in the ledger ONLY when the handler verifies closure —
// never auto-declaring victory (the integrity gates forbid that), and honestly ESCALATING the lanes a loop
// cannot close (world-capped market evidence, missing infra).
//
// The handlers (code=forge+verify, outcome=author+validate, external=grade+register, infra=provision) are
// injected — this module owns the ROUTER + the loop; the heavy lane handlers wire in incrementally. The router
// is the piece that turns 31 defined-but-open challenges into a systematically-worked queue.

export type DispatchLane =
  | 'code'      // implementable now: a code change + verify
  | 'infra'     // needs environment (Docker, Linux CI, a token) — provision or escalate; not reasoning
  | 'outcome'   // needs outcome authoring + cold validate
  | 'external'  // needs evidence from OUTSIDE the system (a benchmark grade, telemetry) — run + register
  | 'capped'    // ontologically world-capped (adoption / spend / audits) — escalate; a loop cannot fabricate it
  | 'measure';  // a built hypothesis awaiting measurement (the result then re-routes it)

export interface ChallengeClassification {
  lane: DispatchLane;
  reason: string;
  /** What blocks immediate closure for infra/external lanes (e.g. 'docker', 'github-token', 'cloud-grade'). */
  blockedBy?: string;
}

export interface DispatchableChallenge {
  id: string;
  title: string;
  problem: string;
  opportunity?: string;
  status: string;
}

/**
 * Route an open challenge into its dispatch lane from its text. Heuristic but honest — the lane decides which
 * handler can close it, or that it must escalate to the world / await infra. Order matters: world-capped and
 * infra are checked first so a SWE-bench challenge that needs Docker is routed to infra, not external.
 */
export function classifyChallenge(c: Pick<DispatchableChallenge, 'title' | 'problem' | 'opportunity'>): ChallengeClassification {
  const text = `${c.title} ${c.problem} ${c.opportunity ?? ''}`.toLowerCase();
  if (/\b(community_adoption|enterprise_readiness|token_economy|adoption|real users|production spend|soc2|market evidence)\b/.test(text))
    return { lane: 'capped', reason: 'needs real-world market/adoption evidence — no council or loop can fabricate this honestly' };
  if (/\b(docker|grader env|grader's docker|cloud|linux ci|github_token|github token|daemon|host sleep|unattended)\b/.test(text)) {
    const blockedBy = /docker|grader/.test(text) ? 'docker' : /github.?token/.test(text) ? 'github-token' : /cloud|linux ci/.test(text) ? 'cloud-ci' : 'infra';
    return { lane: 'infra', reason: 'needs environment/infrastructure, not reasoning', blockedBy };
  }
  if (/\b(swe-bench|benchmark|resolve rate|contamination-resistant|receipt|external grounding|leaderboard)\b/.test(text))
    return { lane: 'external', reason: 'needs evidence from an external benchmark the loop cannot author', blockedBy: 'cloud-grade' };
  if (/\b(outcome|validate|capability_test|t5|t7|evidence design|min_pass_rate|frontier_spec)\b/.test(text))
    return { lane: 'outcome', reason: 'needs outcome authoring + cold validate before the score can move' };
  if (/\b(measure|unmeasured|hypothesis|never been through the grader|the result picks)\b/.test(text))
    return { lane: 'measure', reason: 'a built hypothesis awaiting measurement; the result re-routes it' };
  return { lane: 'code', reason: 'implementable now: a code change + verify' };
}

export type LaneHandler = (c: DispatchableChallenge) => Promise<{ resolved: boolean; detail: string }>;

export interface DispatchOptions {
  /** Per-lane handlers. Absent lane → recorded 'no-handler' (the honest worklist of what needs building/infra). */
  handlers?: Partial<Record<DispatchLane, LaneHandler>>;
  /** Close a challenge in the ledger when a handler verifies it (default: self-challenge.resolveChallenge). */
  resolve?: (id: string, resolution: string) => Promise<void>;
  /** Budget: max challenges to dispatch this run. */
  maxDispatch?: number;
  log?: (m: string) => void;
}

export interface DispatchOutcome {
  id: string;
  lane: DispatchLane;
  /** resolved = handler verified closure; escalated = world-capped; no-handler = lane unhandled (build/provision
   *  it); blocked = handler ran but could not close (the honest result, re-decomposed next round). */
  result: 'resolved' | 'escalated' | 'blocked' | 'no-handler';
  detail: string;
}

export interface DispatchSummary {
  outcomes: DispatchOutcome[];
  resolved: number;
  byLane: Record<DispatchLane, number>;
  /** Lanes with open work and no handler — the build/provision worklist (the honest "what's standing in the way"). */
  needsHandler: DispatchLane[];
}

/**
 * Drive open challenges toward closure. Each open challenge is classified, routed to its lane handler, and
 * RESOLVED in the ledger only when the handler verifies closure (never auto-declared). World-capped challenges
 * escalate; lanes with no handler are recorded as the honest build/provision worklist. Deterministic given
 * deterministic handlers — the top-level overnight driver wires real handlers in for code/outcome/external/infra.
 */
export async function dispatchChallenges(
  challenges: DispatchableChallenge[],
  opts: DispatchOptions = {},
): Promise<DispatchSummary> {
  const log = opts.log ?? (() => {});
  const open = challenges.filter(c => c.status === 'open').slice(0, opts.maxDispatch ?? 1000);
  const outcomes: DispatchOutcome[] = [];
  const byLane: Record<DispatchLane, number> = { code: 0, infra: 0, outcome: 0, external: 0, capped: 0, measure: 0 };
  const needsHandler = new Set<DispatchLane>();

  for (const c of open) {
    const cls = classifyChallenge(c);
    byLane[cls.lane]++;
    if (cls.lane === 'capped') {
      outcomes.push({ id: c.id, lane: cls.lane, result: 'escalated', detail: cls.reason });
      log(`[dispatch] ${c.id} → capped → escalate (${cls.reason})`);
      continue;
    }
    const handler = opts.handlers?.[cls.lane];
    if (!handler) {
      needsHandler.add(cls.lane);
      outcomes.push({ id: c.id, lane: cls.lane, result: 'no-handler', detail: `${cls.reason}${cls.blockedBy ? ` (blocked by ${cls.blockedBy})` : ''}` });
      log(`[dispatch] ${c.id} → ${cls.lane} → NO HANDLER yet (${cls.blockedBy ?? 'build it'})`);
      continue;
    }
    try {
      const r = await handler(c);
      if (r.resolved) {
        if (opts.resolve) await opts.resolve(c.id, r.detail);
        outcomes.push({ id: c.id, lane: cls.lane, result: 'resolved', detail: r.detail });
        log(`[dispatch] ${c.id} → ${cls.lane} → RESOLVED (${r.detail})`);
      } else {
        outcomes.push({ id: c.id, lane: cls.lane, result: 'blocked', detail: r.detail });
        log(`[dispatch] ${c.id} → ${cls.lane} → blocked (${r.detail}) — re-decompose next round`);
      }
    } catch (e) {
      outcomes.push({ id: c.id, lane: cls.lane, result: 'blocked', detail: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    outcomes,
    resolved: outcomes.filter(o => o.result === 'resolved').length,
    byLane,
    needsHandler: [...needsHandler],
  };
}
