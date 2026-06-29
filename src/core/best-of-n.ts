// best-of-n.ts — the three-layer measured candidate loop (COMPILOT). Generate N candidate diffs (each council
// adapter / rollout yields one — Ornith's "many proposals"), run every candidate through three ordered gates,
// and PROMOTE the one with the highest MEASURED reward:
//
//   Layer 1 — cheap pre-filter (candidate-prefilter): trust boundary, file-size, stubs. Free, fail-fast.
//   Layer 2 — formal legality (injected): runs the diff-impacted tests / capability_test. BINARY: a candidate
//             is legal only if it passes. This is the COMPILOT firewall — correctness is decided by execution,
//             never by an LLM's opinion (and never by PDSE, which cannot enter this module by TYPE).
//   Layer 3 — measured-improvement reward: rank the LEGAL candidates by measured deltas only.
//
// COMPILOT's best-of-5 beat single-run 3.54x vs 2.66x; the cost controls are the same — memoize by diff-hash so
// identical candidates never re-run, and keep Layer 2 (the expensive one) behind Layer 1. Pure orchestration:
// generate/legality/reward are injected, so the whole flow is unit-testable with no agents and no test runner.

import { prefilterCandidate, type ChangedFile, type PrefilterResult } from './candidate-prefilter.js';

export interface Candidate {
  id: string;
  /** Stable hash of the diff — the memo key. Identical diffs are evaluated once. */
  diffHash: string;
  files: ChangedFile[];
  /** Which adapter/rollout produced it (codex/claude/grok/…) — for provenance, never for scoring. */
  source: string;
}

/** MEASURED deltas only — the official reward's sole inputs. There is deliberately no PDSE/soft field here:
 *  the type system is the firewall that keeps a soft heuristic from raising the official number. */
export interface CandidateMetrics {
  /** Net tests turned green by this candidate (negative = regression). */
  passDelta?: number;
  /** Coverage percentage-point delta. */
  coverageDelta?: number;
  /** Derived-score (tier) delta from real receipts. */
  derivedScoreDelta?: number;
  /** Token-cost delta; NEGATIVE is good (cheaper). */
  tokenCostDelta?: number;
}

export interface LegalityResult {
  legal: boolean;
  reason: string;
  metrics?: CandidateMetrics;
}

export interface ScoredCandidate {
  candidate: Candidate;
  reward: number;
  metrics: CandidateMetrics;
}

export interface BestOfNDeps {
  /** Produce candidate i (0..n-1). Return null to skip (a council member declined / died). */
  generate: (index: number) => Promise<Candidate | null>;
  /** Layer 2 — measured legality. Injected (real: diff-impacted tests + runCapabilityTest). */
  legality: (candidate: Candidate) => Promise<LegalityResult>;
  /** Layer 1 override (defaults to prefilterCandidate over the candidate's files). */
  prefilter?: (candidate: Candidate) => PrefilterResult;
  /** Layer 3 reward over MEASURED metrics (defaults to defaultReward). */
  reward?: (metrics: CandidateMetrics) => number;
  log?: (msg: string) => void;
}

export interface BestOfNConfig {
  n: number;
}

export interface BestOfNResult {
  best: ScoredCandidate | null;
  evaluated: ScoredCandidate[];
  rejected: Array<{ candidate: Candidate; layer: 'prefilter' | 'legality'; reason: string }>;
  skippedDuplicates: number;
}

/**
 * Multi-metric reward (the Goodhart guard): a candidate cannot win by trading one axis for another — every
 * measured improvement adds, every regression subtracts, weighted by how load-bearing each signal is. Token
 * cost only helps when it drops (tokenCostDelta < 0). Pure.
 */
export function defaultReward(m: CandidateMetrics): number {
  const pass = m.passDelta ?? 0;
  const cov = m.coverageDelta ?? 0;
  const derived = m.derivedScoreDelta ?? 0;
  const tok = m.tokenCostDelta ?? 0;
  const tokenBonus = tok < 0 ? Math.min(2, -tok / 1000) : -Math.min(2, tok / 1000); // bounded ±2
  return pass * 10 + derived * 8 + cov * 0.5 + tokenBonus;
}

/**
 * Run best-of-N. Generates n candidates, dedupes by diffHash, drops Layer-1 and Layer-2 failures, and returns
 * the legal candidate with the maximum measured reward (stable: first-generated wins ties). Deterministic
 * given deterministic deps.
 */
export async function runBestOfN(deps: BestOfNDeps, config: BestOfNConfig): Promise<BestOfNResult> {
  const log = deps.log ?? (() => {});
  const prefilter = deps.prefilter ?? ((c: Candidate) => prefilterCandidate(c.files));
  const reward = deps.reward ?? defaultReward;

  const evaluated: ScoredCandidate[] = [];
  const rejected: BestOfNResult['rejected'] = [];
  const seen = new Set<string>();
  let skippedDuplicates = 0;

  for (let i = 0; i < config.n; i++) {
    const candidate = await deps.generate(i);
    if (!candidate) { log(`[best-of-n] candidate ${i}: generator declined`); continue; }
    if (seen.has(candidate.diffHash)) { skippedDuplicates++; log(`[best-of-n] candidate ${candidate.id}: duplicate diff — memoized`); continue; }
    seen.add(candidate.diffHash);

    // Layer 1 — cheap pre-filter (fail-fast before the expensive Layer 2).
    const pre = prefilter(candidate);
    if (!pre.pass) {
      const reason = pre.findings.map((f) => `${f.check}:${f.path}`).join('; ');
      rejected.push({ candidate, layer: 'prefilter', reason });
      log(`[best-of-n] candidate ${candidate.id}: REJECTED at L1 — ${reason}`);
      continue;
    }

    // Layer 2 — formal legality (measured, binary).
    const legal = await deps.legality(candidate);
    if (!legal.legal) {
      rejected.push({ candidate, layer: 'legality', reason: legal.reason });
      log(`[best-of-n] candidate ${candidate.id}: REJECTED at L2 — ${legal.reason}`);
      continue;
    }

    // Layer 3 — measured reward.
    const metrics = legal.metrics ?? {};
    evaluated.push({ candidate, reward: reward(metrics), metrics });
    log(`[best-of-n] candidate ${candidate.id}: legal, reward=${reward(metrics).toFixed(2)}`);
  }

  const best = evaluated.reduce<ScoredCandidate | null>((acc, c) => (acc === null || c.reward > acc.reward ? c : acc), null);
  if (best) log(`[best-of-n] promoted ${best.candidate.id} (reward=${best.reward.toFixed(2)}) from ${evaluated.length} legal of ${config.n}`);
  else log(`[best-of-n] no legal candidate among ${config.n}`);
  return { best, evaluated, rejected, skippedDuplicates };
}
