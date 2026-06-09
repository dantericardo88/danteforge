// capability-test-conductor.ts — the self-healing routing brain of the autonomous loop.
//
// Given the yardstick audit of every dimension, decide — with NO human — what each dim needs next, and
// drive it there. This is the "(D) self-heal every blocker class" the thesis demands, made into a pure,
// inspectable decision plus a seam-injected orchestration. The shipped honesty primitives (auditor +
// CapabilityTestAuthor) are the parts; this strings them into a continuous pass:
//
//   REAL yardstick      -> PROCEED        (the build loop can grip a real metric)
//   stub/structural/etc -> AUTHOR_YARDSTICK   (author a real, RED, ladder-grounded test — if a ladder exists)
//   …but no Score Ladder-> RESEARCH_LADDER    (research + author the competitor ladder first, then author)
//   market-capped       -> CEILING        (honestly capped at 5.0 — never fabricate adoption)
//
// Routing is a pure function (planRemediation) so the conductor's judgement is fully testable; the
// expensive real actions (author via the examiner agent, research the ladder) are injected.

import type { YardstickAudit } from './capability-test-integrity.js';
import type { AuthorResult } from './capability-test-author.js';
import type { SensitivityVerdict } from './capability-test-sensitivity.js';

/** Dimensions whose 9.0 needs real external adoption/telemetry — honestly capped at 5.0, never authored. */
export const MARKET_CAPPED_DIMS = new Set(['token_economy', 'enterprise_readiness', 'community_adoption']);

export type RemediationAction = 'PROCEED' | 'AUTHOR_YARDSTICK' | 'RESEARCH_LADDER' | 'CEILING';

export interface Remediation {
  dimId: string;
  action: RemediationAction;
  reason: string;
}

/** Decide what one dimension needs next, from its yardstick audit. Pure + deterministic. */
export function planRemediation(audit: YardstickAudit, isMarketCapped: boolean): Remediation {
  const { dimId, verdict, hasLadder } = audit;
  if (!audit.needsAuthoring) {
    return { dimId, action: 'PROCEED', reason: `Real yardstick (${verdict}) — the build loop can drive against it.` };
  }
  if (isMarketCapped) {
    return { dimId, action: 'CEILING', reason: `Market-capped dimension (≤5.0): needs real external adoption/telemetry that cannot be fabricated — not an authoring target.` };
  }
  if (!hasLadder) {
    return { dimId, action: 'RESEARCH_LADDER', reason: `${verdict} with no competitor Score Ladder — research + author the ladder first so the yardstick bar is grounded, not self-set.` };
  }
  return { dimId, action: 'AUTHOR_YARDSTICK', reason: `${verdict} — author a real, RED, ladder-grounded yardstick the loop can build against (current metric is fiction).` };
}

/** Plan remediation for every audited dimension. */
export function planAllRemediations(audits: YardstickAudit[], isMarketCapped: (dimId: string) => boolean = (d) => MARKET_CAPPED_DIMS.has(d)): Remediation[] {
  return audits.map(a => planRemediation(a, isMarketCapped(a.dimId)));
}

export interface RemediationOutcome extends Remediation {
  status: 'PROCEED' | 'AUTHORED' | 'AUTHOR_REJECTED' | 'CEILING' | 'BLOCKED' | 'SKIPPED';
  /** True when this dim's competitor Score Ladder was researched + authored during this remediation. */
  ladderResearched?: boolean;
  detail?: string;
}

export interface RemediationReport {
  outcomes: RemediationOutcome[];
  counts: Record<RemediationOutcome['status'], number>;
}

export interface ConductorContext {
  /** Author a real RED yardstick for a dim (the examiner agent + the 3 honesty gates). */
  authorFn: (dimId: string) => Promise<AuthorResult>;
  /** Research + author the competitor Score Ladder for a dim (so a frontier bar exists). */
  researchLadderFn: (dimId: string) => Promise<{ ok: boolean; reason: string }>;
  /** Verify a "real" (PROCEED) yardstick by EXECUTION — the dynamic sensitivity probe. A STUB verdict
   *  means the metric is decoupled fiction and must be re-authored, not built against. Omit to trust the
   *  static verdict (weaker — a static REAL is unverified). */
  verifyRealFn?: (dimId: string) => Promise<SensitivityVerdict>;
  isMarketCapped?: (dimId: string) => boolean;
  /** Token/time budget guard — return false to stop spending on more remediations this pass. */
  hasBudget?: () => boolean;
}

/**
 * Drive every dim to a real yardstick (or an honest ceiling), with no human. A RESEARCH_LADDER dim is
 * researched THEN authored in the same pass (the ladder is the prerequisite for grounded authoring). The
 * budget guard lets the fleet-scale loop bound spend; exhausted dims are SKIPPED, not failed.
 */
export async function remediateYardsticks(audits: YardstickAudit[], ctx: ConductorContext): Promise<RemediationReport> {
  const isMarketCapped = ctx.isMarketCapped ?? ((d: string) => MARKET_CAPPED_DIMS.has(d));
  const outcomes: RemediationOutcome[] = [];

  for (const plan of planAllRemediations(audits, isMarketCapped)) {
    if (plan.action === 'PROCEED') {
      // A static REAL verdict is UNVERIFIED until execution proves dependence. Run the sensitivity probe;
      // a STUB result (the metric is invariant to its callsite — decoupled / self-fulfilling) re-routes the
      // dim to authoring. GENUINE / INCONCLUSIVE / BASELINE_RED keep the static decision.
      if (ctx.verifyRealFn && (!ctx.hasBudget || ctx.hasBudget())) {
        const v = await ctx.verifyRealFn(plan.dimId);
        if (v === 'STUB') {
          const authored = await ctx.authorFn(plan.dimId);
          outcomes.push({
            dimId: plan.dimId, action: 'AUTHOR_YARDSTICK',
            reason: 'sensitivity probe: the PROCEED metric is DECOUPLED (invariant to its callsite) — re-authoring.',
            status: authored.installed ? 'AUTHORED' : 'AUTHOR_REJECTED', detail: authored.reason,
          });
          continue;
        }
        outcomes.push({ ...plan, status: 'PROCEED', detail: `sensitivity: ${v}` });
        continue;
      }
      outcomes.push({ ...plan, status: 'PROCEED' });
      continue;
    }
    if (plan.action === 'CEILING') { outcomes.push({ ...plan, status: 'CEILING' }); continue; }
    if (ctx.hasBudget && !ctx.hasBudget()) { outcomes.push({ ...plan, status: 'SKIPPED', detail: 'budget exhausted this pass' }); continue; }

    let ladderResearched = false;
    if (plan.action === 'RESEARCH_LADDER') {
      const res = await ctx.researchLadderFn(plan.dimId);
      if (!res.ok) { outcomes.push({ ...plan, status: 'BLOCKED', detail: `ladder research failed: ${res.reason}` }); continue; }
      ladderResearched = true;
      // Ladder now exists → author the grounded yardstick in the same pass.
    }

    const authored = await ctx.authorFn(plan.dimId);
    outcomes.push({
      ...plan,
      status: authored.installed ? 'AUTHORED' : 'AUTHOR_REJECTED',
      ladderResearched,
      detail: authored.reason,
    });
  }

  const counts = outcomes.reduce((acc, o) => { acc[o.status] = (acc[o.status] ?? 0) + 1; return acc; },
    {} as Record<RemediationOutcome['status'], number>);
  return { outcomes, counts };
}
