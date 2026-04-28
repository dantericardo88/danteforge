/**
 * Adversarial dimension scorer.
 *
 * Calls an independent LLM (the "adversary") to produce a numerical 0-10 score
 * per dimension, then computes divergence from the self-score.
 *
 * Three adversary modes (set by resolveAdversaryProvider):
 *   'configured'     — explicit provider in config or env
 *   'ollama-auto'    — Ollama detected, primary is non-Ollama
 *   'self-challenge' — same provider with adversarial framing; still useful
 */
import { type LLMProvider } from './config.js';
import { type AdversaryResolution } from './config.js';
import { type HarshScoreResult, type ScoringDimension } from './harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DimensionAdversarialScore {
  dimension: ScoringDimension;
  adversarialScore: number;    // 0–10
  rationale: string;
  provider: string;
  mode: AdversaryResolution['mode'];
  generatedAt: string;
}

export interface AdversarialScoreResult {
  selfScore: number;
  adversarialScore: number;    // weighted average across dimensions
  divergence: number;          // adversarialScore - selfScore (negative = inflation)
  verdict: 'trusted' | 'watch' | 'inflated' | 'underestimated';
  dimensions: DimensionAdversarialScore[];
  adversaryResolution: AdversaryResolution;
  generatedAt: string;
}

export interface AdversarialScorerDimOptions {
  cwd?: string;
  /** Pre-resolved adversary (skips resolver — useful when caller already resolved it) */
  adversaryResolution?: AdversaryResolution;
  /** Score overall project in 1 LLM call instead of one-per-dimension (faster, lower cost) */
  summaryOnly?: boolean;
  /** Injection seam: replaces callLLM for testing */
  _callLLM?: (prompt: string, provider?: LLMProvider) => Promise<string>;
  /** Injection seam: replaces resolveAdversaryProvider */
  _resolveAdversary?: (config: import('./config.js').DanteConfig, opts?: unknown) => Promise<AdversaryResolution | null>;
  /** Injection seam: replaces loadConfig */
  _loadConfig?: () => Promise<import('./config.js').DanteConfig>;
}

// ── Dimension weights (mirrors harsh-scorer.ts) ───────────────────────────────

const DIMENSION_WEIGHTS: Record<ScoringDimension, number> = {
  functionality: 0.11,
  testing: 0.09,
  errorHandling: 0.08,
  security: 0.08,
  uxPolish: 0.06,
  documentation: 0.06,
  performance: 0.06,
  maintainability: 0.07,
  developerExperience: 0.08,
  autonomy: 0.07,
  planningQuality: 0.05,
  selfImprovement: 0.04,
  specDrivenPipeline: 0.03,
  convergenceSelfHealing: 0.03,
  tokenEconomy: 0.03,
  contextEconomy: 0.03,
  ecosystemMcp: 0.01,
  enterpriseReadiness: 0.01,
  communityAdoption: 0.01,
};

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildDimensionPrompt(
  dimension: ScoringDimension,
  _selfScore: number,
  mode: AdversaryResolution['mode'],
): string {
  const selfChallengePreamble = mode === 'self-challenge'
    ? `IMPORTANT: Play the role of a skeptical external evaluator. Score independently — do NOT anchor to any prior score.\n\n`
    : '';

  return `${selfChallengePreamble}You are a hostile technical reviewer hired by a competitor.
Score the "${dimension}" dimension of this software project from 0 to 10.

SCALE:
  0  — broken or absent
  3  — exists but has obvious gaps
  5  — average (matches most open-source projects)
  7  — better than average (competitive)
  9  — best-in-class (top 10% of similar tools)
  10 — industry-defining

RULES:
  - Score COMPETITIVE POSITION, not just whether the feature exists
  - A feature that EXISTS but is NOT CALLED from the execution path scores no higher than 4
  - Most projects overestimate by 1-2 points — be aggressive
  - Do NOT give 7+ unless evidence is concrete and specific
  - Do NOT anchor to any self-reported score — score cold from the evidence alone

Respond with ONLY valid JSON (no markdown wrapper):
{"score": <number 0-10, one decimal>, "rationale": "<1-2 sentences explaining the score>"}`;
}

function buildSummaryPrompt(
  _selfScore: number,
  projectContext: string,
  mode: AdversaryResolution['mode'],
): string {
  const selfChallengePreamble = mode === 'self-challenge'
    ? `IMPORTANT: Play the role of a skeptical external evaluator. Score independently — do NOT anchor to any prior score.\n\n`
    : '';

  return `${selfChallengePreamble}You are a hostile technical reviewer hired by a competitor.
Score this software project overall from 0 to 10.

SCALE: 0=broken, 3=has gaps, 5=average, 7=competitive, 9=best-in-class, 10=industry-defining
Score COMPETITIVE POSITION — does this beat leading alternatives at its core mission?
Most projects overestimate by 1-2 points. Be aggressive. Do NOT anchor to any self-reported score.

PROJECT CONTEXT:
${projectContext}

Respond with ONLY valid JSON:
{"score": <number 0-10, one decimal>, "rationale": "<1-2 sentences>"}`;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function computeVerdict(selfScore: number, advScore: number): AdversarialScoreResult['verdict'] {
  const diff = advScore - selfScore;
  // At high self-scores (≥8.0) tighten the "trusted" band — any drop ≥0.3 is worth flagging
  // because inflated high scores are the hardest to detect and most costly.
  const trustedThreshold = selfScore >= 8.0 ? 0.3 : 0.5;
  if (Math.abs(diff) <= trustedThreshold) return 'trusted';
  if (diff <= -1.5) return 'inflated';
  if (diff >= 1.0) return 'underestimated';
  return 'watch';
}

function parseScoreResponse(raw: string, fallback: number): { score: number; rationale: string } {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const score = typeof parsed['score'] === 'number' ? parsed['score'] : Number(parsed['score']);
    if (Number.isFinite(score) && score >= 0 && score <= 10) {
      return {
        score: Math.round(score * 10) / 10,
        rationale: typeof parsed['rationale'] === 'string' ? parsed['rationale'] : '',
      };
    }
  } catch {
    // fall through to conservative discount
  }
  return { score: Math.round(fallback * 0.85 * 10) / 10, rationale: '(parse error — conservative discount applied)' };
}

async function callLLMFn(
  prompt: string,
  resolution: AdversaryResolution,
  _callLLM?: AdversarialScorerDimOptions['_callLLM'],
): Promise<string> {
  if (_callLLM) {
    return _callLLM(prompt, resolution.provider as LLMProvider);
  }
  const { callLLM } = await import('./llm.js');
  return callLLM(prompt, resolution.provider as LLMProvider);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score all 19 dimensions adversarially, one LLM call per dimension.
 * Returns full AdversarialScoreResult with per-dimension breakdown.
 */
export async function generateAdversarialScore(
  selfResult: HarshScoreResult,
  opts: AdversarialScorerDimOptions = {},
): Promise<AdversarialScoreResult> {
  const resolution = await resolveAdversary(selfResult, opts);
  const now = new Date().toISOString();

  if (opts.summaryOnly) {
    return generateAdversarialScoreSummary(selfResult.displayScore, buildProjectContext(selfResult), {
      ...opts,
      adversaryResolution: resolution,
    });
  }

  const dims = Object.entries(selfResult.displayDimensions ?? {}) as [ScoringDimension, number][];
  const dimensionResults: DimensionAdversarialScore[] = [];

  for (const [dim, selfDimScore] of dims) {
    const prompt = buildDimensionPrompt(dim, selfDimScore, resolution.mode);
    const raw = await callLLMFn(prompt, resolution, opts._callLLM).catch(() => '');
    const { score, rationale } = parseScoreResponse(raw, selfDimScore);
    dimensionResults.push({
      dimension: dim,
      adversarialScore: score,
      rationale,
      provider: resolution.provider,
      mode: resolution.mode,
      generatedAt: now,
    });
  }

  // Weighted average adversarial score
  const totalWeight = dimensionResults.reduce((s, d) => s + (DIMENSION_WEIGHTS[d.dimension] ?? 0), 0);
  const adversarialScore = totalWeight > 0
    ? Math.round(
        dimensionResults.reduce(
          (s, d) => s + d.adversarialScore * (DIMENSION_WEIGHTS[d.dimension] ?? 0),
          0,
        ) / totalWeight * 10,
      ) / 10
    : selfResult.displayScore * 0.9;

  const divergence = Math.round((adversarialScore - selfResult.displayScore) * 10) / 10;

  return {
    selfScore: selfResult.displayScore,
    adversarialScore,
    divergence,
    verdict: computeVerdict(selfResult.displayScore, adversarialScore),
    dimensions: dimensionResults,
    adversaryResolution: resolution,
    generatedAt: now,
  };
}

/**
 * Score the project in a single LLM call (faster, less granular).
 * Useful for quick checks or when per-dimension detail isn't needed.
 */
export async function generateAdversarialScoreSummary(
  selfScore: number,
  projectContext: string,
  opts: AdversarialScorerDimOptions = {},
): Promise<AdversarialScoreResult> {
  const resolution = opts.adversaryResolution ?? await resolveAdversaryFallback(opts);
  const now = new Date().toISOString();

  const prompt = buildSummaryPrompt(selfScore, projectContext, resolution.mode);
  const raw = await callLLMFn(prompt, resolution, opts._callLLM).catch(() => '');
  const { score, rationale } = parseScoreResponse(raw, selfScore);

  const divergence = Math.round((score - selfScore) * 10) / 10;

  return {
    selfScore,
    adversarialScore: score,
    divergence,
    verdict: computeVerdict(selfScore, score),
    dimensions: [{
      dimension: 'functionality' as ScoringDimension,
      adversarialScore: score,
      rationale,
      provider: resolution.provider,
      mode: resolution.mode,
      generatedAt: now,
    }],
    adversaryResolution: resolution,
    generatedAt: now,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveAdversary(
  selfResult: HarshScoreResult,
  opts: AdversarialScorerDimOptions,
): Promise<AdversaryResolution> {
  if (opts.adversaryResolution) return opts.adversaryResolution;

  const config = opts._loadConfig ? await opts._loadConfig() : await (await import('./config.js')).loadConfig();
  const resolverFn = opts._resolveAdversary ?? (await import('./adversary-resolver.js')).resolveAdversaryProvider;
  const resolved = await resolverFn(config).catch(() => null);

  if (resolved) return resolved;

  // Absolute fallback: self-challenge with the primary provider
  return {
    provider: config.defaultProvider as LLMProvider,
    mode: 'self-challenge',
  };
}

async function resolveAdversaryFallback(
  opts: AdversarialScorerDimOptions,
): Promise<AdversaryResolution> {
  const config = opts._loadConfig ? await opts._loadConfig() : await (await import('./config.js')).loadConfig();
  const resolverFn = opts._resolveAdversary ?? (await import('./adversary-resolver.js')).resolveAdversaryProvider;
  const resolved = await resolverFn(config).catch(() => null);
  return resolved ?? { provider: config.defaultProvider as LLMProvider, mode: 'self-challenge' };
}

function buildProjectContext(selfResult: HarshScoreResult): string {
  const dims = Object.entries(selfResult.displayDimensions ?? {})
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([dim, score]) => `  ${dim}: ${(score as number).toFixed(1)}/10`)
    .join('\n');
  return `Top dimensions:\n${dims}\nOverall self-score: ${selfResult.displayScore.toFixed(1)}/10`;
}
