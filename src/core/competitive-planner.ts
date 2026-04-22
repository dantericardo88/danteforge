// Competitive Leapfrog Planner — identifies opportunities where your project can get ahead
// of competitors by adopting patterns they haven't implemented yet.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompetitorProfile {
  name: string;
  url: string;
  strengths: string[];       // dimensions where they score high
  weaknesses: string[];      // dimensions where they score low
  recentFeatures: string[];  // latest 3-5 features
  estimatedScore: number;    // 0-10 overall quality estimate
}

export interface LeapfrogOpportunity {
  dimension: string;
  ourCurrentScore: number;
  competitorBestScore: number;
  adoptionPattern: string;   // pattern name that would close the gap
  leapfrogScore: number;     // how much ahead we'd be after adoption (0-10)
  urgency: 'immediate' | 'high' | 'medium' | 'low';
}

export interface LeapfrogPlan {
  generatedAt: string;
  competitors: CompetitorProfile[];
  opportunities: LeapfrogOpportunity[];
  topRecommendation: string; // one-sentence action
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeUrgency(leapfrogScore: number): LeapfrogOpportunity['urgency'] {
  if (leapfrogScore >= 8) return 'immediate';
  if (leapfrogScore >= 6) return 'high';
  if (leapfrogScore >= 4) return 'medium';
  return 'low';
}

function computeLeapfrogScore(ourCurrentScore: number, competitorBestScore: number): number {
  // Score = gap we'd close + headroom above the competitor
  const raw = (10 - competitorBestScore) + (competitorBestScore - ourCurrentScore);
  return Math.min(10, Math.max(0, raw));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parses an LLM JSON response into CompetitorProfile[].
 * On parse error, returns [].
 */
export function buildCompetitorProfiles(llmResponse: string): CompetitorProfile[] {
  try {
    // Strip markdown code fences if present
    const cleaned = llmResponse
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is CompetitorProfile => {
      if (typeof item !== 'object' || item === null) return false;
      const p = item as Record<string, unknown>;
      return (
        typeof p['name'] === 'string' &&
        typeof p['url'] === 'string' &&
        Array.isArray(p['strengths']) &&
        Array.isArray(p['weaknesses']) &&
        Array.isArray(p['recentFeatures']) &&
        typeof p['estimatedScore'] === 'number'
      );
    });
  } catch {
    return [];
  }
}

/**
 * For each dimension where a competitor scores >= ourScore + 1, finds matching
 * adoptionCandidates. Returns LeapfrogOpportunity[] sorted by leapfrogScore desc.
 */
export function findLeapfrogOpportunities(
  ourScores: Record<string, number>,
  competitors: CompetitorProfile[],
  adoptionCandidates: Array<{ patternName: string; unlocksGapClosure: string[] }>,
): LeapfrogOpportunity[] {
  const opportunities: LeapfrogOpportunity[] = [];

  for (const [dimension, ourScore] of Object.entries(ourScores)) {
    // Find the best competitor score for this dimension
    let competitorBestScore = -Infinity;
    for (const competitor of competitors) {
      // CompetitorProfile uses strengths/weaknesses not per-dimension scores,
      // so we derive a score: strength mention = estimatedScore, weakness mention = estimatedScore * 0.5
      const isStrength = competitor.strengths.some(
        (s) => s.toLowerCase().includes(dimension.toLowerCase()),
      );
      const isWeakness = competitor.weaknesses.some(
        (w) => w.toLowerCase().includes(dimension.toLowerCase()),
      );
      let dimScore: number;
      if (isStrength) {
        dimScore = competitor.estimatedScore;
      } else if (isWeakness) {
        dimScore = competitor.estimatedScore * 0.5;
      } else {
        // Neutral assumption: competitor average
        dimScore = competitor.estimatedScore * 0.75;
      }
      if (dimScore > competitorBestScore) {
        competitorBestScore = dimScore;
      }
    }

    if (competitors.length === 0) continue;

    // Only create opportunity if competitor is meaningfully ahead
    if (competitorBestScore < ourScore + 1) continue;

    // Find matching adoption candidates
    const matchingCandidates = adoptionCandidates.filter((c) =>
      c.unlocksGapClosure.some(
        (gap) => gap.toLowerCase().includes(dimension.toLowerCase()),
      ),
    );

    if (matchingCandidates.length === 0) continue;

    const leapfrogScore = computeLeapfrogScore(ourScore, competitorBestScore);
    const urgency = computeUrgency(leapfrogScore);

    // Prefer the first matching candidate (most relevant)
    const adoptionPattern = matchingCandidates[0]!.patternName;

    opportunities.push({
      dimension,
      ourCurrentScore: ourScore,
      competitorBestScore,
      adoptionPattern,
      leapfrogScore,
      urgency,
    });
  }

  // Sort by leapfrogScore descending
  return opportunities.sort((a, b) => b.leapfrogScore - a.leapfrogScore);
}

/**
 * Builds a full LeapfrogPlan. If opportunities.length === 0, topRecommendation
 * is the no-opportunity message. Calls LLM for topRecommendation if available
 * and there are opportunities.
 */
export async function buildLeapfrogPlan(
  ourScores: Record<string, number>,
  competitors: CompetitorProfile[],
  candidates: Array<{ patternName: string; unlocksGapClosure: string[] }>,
  _llmCaller?: (prompt: string) => Promise<string>,
): Promise<LeapfrogPlan> {
  const opportunities = findLeapfrogOpportunities(ourScores, competitors, candidates);

  let topRecommendation: string;

  if (opportunities.length === 0) {
    topRecommendation =
      'No immediate leapfrog opportunities — maintain lead by accelerating adoption velocity.';
  } else if (_llmCaller) {
    try {
      const top = opportunities[0]!;
      const prompt = [
        'You are a competitive strategy advisor.',
        `The top leapfrog opportunity is the "${top.dimension}" dimension.`,
        `Our score: ${top.ourCurrentScore}/10. Competitor best: ${top.competitorBestScore}/10.`,
        `Adoption pattern: ${top.adoptionPattern}. Urgency: ${top.urgency}.`,
        'Write ONE concise action sentence (max 25 words) recommending what to do next.',
        'Return only the sentence, no preamble.',
      ].join('\n');
      const raw = await _llmCaller(prompt);
      topRecommendation = raw.trim().replace(/^["']|["']$/g, '');
      if (!topRecommendation) throw new Error('empty');
    } catch {
      topRecommendation = buildFallbackRecommendation(opportunities[0]!);
    }
  } else {
    topRecommendation = buildFallbackRecommendation(opportunities[0]!);
  }

  return {
    generatedAt: new Date().toISOString(),
    competitors,
    opportunities,
    topRecommendation,
  };
}

function buildFallbackRecommendation(top: LeapfrogOpportunity): string {
  return `Adopt "${top.adoptionPattern}" to leapfrog competitors on ${top.dimension} (urgency: ${top.urgency}).`;
}

/**
 * Returns a prompt string asking LLM to return CompetitorProfile[] JSON for
 * the given project description and dimensions.
 */
export function buildCompetitorPrompt(
  projectDescription: string,
  dimensions: string[],
): string {
  return [
    'You are a competitive intelligence analyst.',
    '',
    `Project: ${projectDescription}`,
    '',
    `Dimensions to evaluate: ${dimensions.join(', ')}`,
    '',
    'Return a JSON array of CompetitorProfile objects with this exact shape:',
    '[',
    '  {',
    '    "name": "string",',
    '    "url": "string",',
    '    "strengths": ["dimension strings where they score high"],',
    '    "weaknesses": ["dimension strings where they score low"],',
    '    "recentFeatures": ["feature1", "feature2", "feature3"],',
    '    "estimatedScore": 7.5',
    '  }',
    ']',
    '',
    'Rules:',
    '- Include 3-5 real competitors.',
    '- estimatedScore is 0-10.',
    '- strengths and weaknesses reference the provided dimensions.',
    '- recentFeatures lists their latest 3-5 shipped capabilities.',
    '- Return ONLY the JSON array, no explanation.',
  ].join('\n');
}

/**
 * Returns the canonical path for the leapfrog plan JSON file.
 */
export function getLeapfrogPlanPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'leapfrog-plan.json');
}

/**
 * Saves the leapfrog plan to disk (best-effort — never throws).
 */
export async function saveLeapfrogPlan(
  plan: LeapfrogPlan,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  try {
    const planPath = getLeapfrogPlanPath(cwd);
    const write = _fsWrite ?? (async (p, d) => {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, d, 'utf8');
    });
    await write(planPath, JSON.stringify(plan, null, 2));
  } catch {
    // best-effort: never throw
  }
}
