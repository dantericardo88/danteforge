// A REAL continuous graded evaluator for multi_agent_orchestration — DanteForge's most genuinely-novel
// capability (the peer-review council). It emits the OpenEvolve contract line that `danteforge evaluate`
// (and, next, the build loop) consumes: {"combined_score": 0..1, "metrics": {...}, "artifacts": {...}}.
//
// HONEST GRADIENT: the "have" checks run the real council/court functions and pass; the "frontier-gap" checks
// are honest assertions about capabilities we do NOT yet have versus CrewAI / AutoGen / LangGraph, and they
// currently FAIL. So combined_score < 1.0 by a real margin — that margin is exactly what the builder climbs.
// (A binary capability_test would have read 1.0/pass here and dispatched no builder — the bug we are fixing.)

import fs from 'node:fs';
import { signBuilderProvenance, verifyBuilderProvenance } from '../src/core/frontier-spec.js';
import { computeExcludedJudges } from '../src/cli/commands/frontier-review.js';
import type { CouncilMemberId } from '../src/cli/commands/council.js';

const ROSTER = [{ id: 'codex' as CouncilMemberId }, { id: 'claude-code' as CouncilMemberId }, { id: 'grok-build' as CouncilMemberId, judgeOnly: true }];
const tok = signBuilderProvenance('functionality', ['codex']);

const checks: Array<[string, boolean]> = [
  // HAVE — genuinely-novel, verified capabilities (real function calls):
  ['peer_review_seats_two_independent_judges', computeExcludedJudges('functionality', ['codex'], undefined, tok, ROSTER).size === 1],
  ['builder_provenance_round_trips', verifyBuilderProvenance('functionality', ['codex'], tok)],
  ['forged_token_holds_the_floor', !verifyBuilderProvenance('functionality', ['codex'], 'deadbeefdeadbeefdeadbeefdeadbeef')],
  ['token_is_dimension_bound', !verifyBuilderProvenance('security', ['codex'], tok)],
  // FRONTIER GAP — honest bar versus the named competitors; these FAIL today and are the gradient to climb:
  ['runnable_agent_benchmark_receipt_vs_competitors', fs.existsSync('.danteforge/benchmarks/multi_agent_orchestration.json')],
  ['three_plus_independent_judge_vendors_live', false], // CH-061: only grok is a reliable judge-only vendor
  ['published_head_to_head_vs_crewai_autogen_langgraph', fs.existsSync('docs/COMPARISON_MULTI_AGENT.md')],
];

const passed = checks.filter(([, ok]) => ok).length;
const combined_score = passed / checks.length;
const detail = checks.map(([n, ok]) => `${ok ? '✓' : '✗'} ${n}`).join(' | ');
// The final stdout line IS the contract the evaluator/build loop reads (logs above it are ignored).
console.log(JSON.stringify({ combined_score, metrics: { passed, total: checks.length }, artifacts: { detail } }));
