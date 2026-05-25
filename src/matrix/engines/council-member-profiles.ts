// Matrix Kernel — CouncilMemberProfiles
//
// Static capability profiles for each council member, used by the scheduler
// to route dimensions to the builder most likely to succeed. Matching is based
// on dimension ID / label keyword overlap with the member's strength keywords.
//
// This is NOT a score — it's a routing hint. The scheduler still assigns all
// dims; it just prefers routing high-match dims to their strongest builder.
export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface CouncilMemberProfile {
  id: CouncilMemberId;
  /** Short human label for logging. */
  label: string;
  /** Role persona prepended to judge prompts so verdicts are grounded in a consistent viewpoint. */
  persona: string;
  /**
   * Keywords that, when found in a dimension ID or label, indicate this member
   * is well-suited to build it. Case-insensitive substring match.
   */
  strengthKeywords: string[];
  /**
   * 0–1 weight applied to the scheduling score.
   * 1.0 = strongly prefer this member for matching dims.
   * 0.5 = neutral (use as tiebreaker only).
   */
  weight: number;
}

export const COUNCIL_PROFILES: Record<CouncilMemberId, CouncilMemberProfile> = {
  'codex': {
    id: 'codex',
    label: 'Codex (OpenAI)',
    persona: 'Security-First Test Engineer — you prioritize correctness, edge-case coverage, and rejection of superficial or stub implementations.',
    strengthKeywords: [
      'testing', 'test', 'coverage', 'tdd', 'spec', 'unit',
      'error_handling', 'error', 'validation', 'security', 'sanitize',
      'performance', 'benchmark', 'optimize',
    ],
    weight: 1.0,
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI (Google)',
    persona: 'Documentation and UX Specialist — you evaluate clarity, developer ergonomics, discoverability, and whether the change degrades the user-facing experience.',
    strengthKeywords: [
      'documentation', 'docs', 'readme', 'guide', 'onboarding',
      'ux_polish', 'ux', 'ui', 'design', 'accessibility',
      'developer_experience', 'dx', 'ergonomics', 'workflow',
    ],
    weight: 1.0,
  },
  'grok-build': {
    id: 'grok-build',
    label: 'Grok Build (xAI)',
    persona: 'Pragmatic Systems Architect — you evaluate structural integrity, maintainability, correct abstraction boundaries, and long-term extensibility.',
    strengthKeywords: [
      'refactor', 'maintainability', 'architecture', 'structure',
      'autonomy', 'agent', 'orchestration', 'multi_agent',
      'planning', 'convergence', 'self_healing', 'self_improvement',
    ],
    weight: 1.0,
  },
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code (Anthropic)',
    persona: 'Integration and Pipeline Specialist — you evaluate end-to-end correctness, callsite wiring, spec alignment, and whether the change fits the production execution path.',
    strengthKeywords: [
      'spec_driven', 'spec', 'pipeline', 'integration', 'ecosystem',
      'enterprise', 'compliance', 'token_economy', 'budget',
      'functionality', 'capability', 'feature', 'core',
    ],
    weight: 1.0,
  },
};

/**
 * Score how well a member profile matches a dimension.
 * Returns 0–N where N is the number of keyword hits.
 */
export function profileScore(
  profile: CouncilMemberProfile,
  dimId: string,
  dimLabel: string,
): number {
  const haystack = `${dimId} ${dimLabel}`.toLowerCase();
  let hits = 0;
  for (const kw of profile.strengthKeywords) {
    if (haystack.includes(kw.toLowerCase())) hits++;
  }
  return hits * profile.weight;
}

/**
 * Given a list of available member IDs and a dimension, return the member ID
 * that best matches the dimension's profile. Falls back to round-robin index
 * if no profile matches.
 */
export function bestMemberForDim(
  dimId: string,
  dimLabel: string,
  candidateIds: CouncilMemberId[],
  fallbackIndex: number,
): CouncilMemberId {
  if (candidateIds.length === 0) throw new Error('No candidates');

  // Default: round-robin. Only override if a member has a positive keyword match.
  const fallbackId = candidateIds[fallbackIndex % candidateIds.length]!;
  let bestId = fallbackId;
  let bestScore = 0;  // threshold — no match means stay with fallback

  for (const id of candidateIds) {
    const profile = COUNCIL_PROFILES[id];
    const score = profileScore(profile, dimId, dimLabel);
    if (score > bestScore) {
      bestScore = score;
      bestId = id;
    }
  }
  return bestId;
}
