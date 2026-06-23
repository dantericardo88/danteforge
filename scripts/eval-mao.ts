// A REAL continuous graded evaluator for multi_agent_orchestration — DanteForge's most genuinely-novel
// capability (the peer-review council). It emits the OpenEvolve contract line that `danteforge evaluate`
// (and, next, the build loop) consumes: {"combined_score": 0..1, "metrics": {...}, "artifacts": {...}}.
//
// HONEST GRADIENT: the "have" checks run the real council/court functions and pass; the "frontier-gap" checks
// are honest assertions about capabilities we do NOT yet have versus CrewAI / AutoGen / LangGraph, and they
// currently FAIL. So combined_score < 1.0 by a real margin — that margin is exactly what the builder climbs.
// (A binary capability_test would have read 1.0/pass here and dispatched no builder — the bug we are fixing.)

import fs from 'node:fs';
import { signBuilderProvenance, verifyBuilderProvenance, verifyClaim } from '../src/core/frontier-spec.js';
import { computeExcludedJudges } from '../src/cli/commands/frontier-review.js';
import type { CouncilMemberId } from '../src/cli/commands/council.js';

const ROSTER = [{ id: 'codex' as CouncilMemberId }, { id: 'claude-code' as CouncilMemberId }, { id: 'grok-build' as CouncilMemberId, judgeOnly: true }];
const tok = signBuilderProvenance('functionality', ['codex']);

/** A frontier-gap check is satisfied ONLY by a KERNEL-SIGNED receipt (council 2026-06-22, Claude's #1 fix):
 *  a builder cannot raise the score by `touch`-ing a file — it must produce a receipt the kernel signed after a
 *  REAL run. `touch foo.json` writes no valid signature, so the check stays honestly false. This is the
 *  anti-gaming property the old `fs.existsSync` checks lacked; the deeper version is the court-as-RULER (CH-063). */
function signedFrontierClaim(claim: string): boolean {
  try {
    const r = JSON.parse(fs.readFileSync(`.danteforge/frontier-receipts/${claim}.json`, 'utf8')) as { claim?: string; sig?: string };
    return r.claim === claim && verifyClaim(claim, r.sig);
  } catch { return false; }
}

const checks: Array<[string, boolean]> = [
  // HAVE — genuinely-novel, verified BASELINE capabilities (real function calls):
  ['peer_review_seats_two_independent_judges', computeExcludedJudges('functionality', ['codex'], undefined, tok, ROSTER).size === 1],
  ['builder_provenance_round_trips', verifyBuilderProvenance('functionality', ['codex'], tok)],
  ['forged_token_holds_the_floor', !verifyBuilderProvenance('functionality', ['codex'], 'deadbeefdeadbeefdeadbeefdeadbeef')],
  ['token_is_dimension_bound', !verifyBuilderProvenance('security', ['codex'], tok)],
  // FRONTIER BAR — the COURT attests genuine competitor-parity (court-as-RULER, CH-063). This closes ONLY when
  // the HARDENED frontier-review court validates this dim against its bar, and signs the receipt below. Agents
  // cannot forge the kernel signature, so combined_score can reach 1.0 only after a REAL court validation — the
  // trusted last mile the climb dogfood proved was missing. (The court holistically subsumes the prior
  // benchmark / judge-diversity / head-to-head gaps: it judges whether the dim is genuinely frontier-grade.)
  ['court_validated_frontier_vs_competitors', signedFrontierClaim('multi_agent_orchestration_court_validated')],
];

const passed = checks.filter(([, ok]) => ok).length;
const combined_score = passed / checks.length;
const detail = checks.map(([n, ok]) => `${ok ? '✓' : '✗'} ${n}`).join(' | ');
// The final stdout line IS the contract the evaluator/build loop reads (logs above it are ignored).
console.log(JSON.stringify({ combined_score, metrics: { passed, total: checks.length }, artifacts: { detail } }));
