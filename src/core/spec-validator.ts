// Spec quality validator — checks completeness, clarity, measurability, and format.
// Returns a structured result with a score (0–10), issues, and suggestions.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecValidationResult {
  valid: boolean;
  score: number;          // 0–10 composite quality score
  issues: string[];       // things that must be fixed (blocking)
  suggestions: string[];  // nice-to-have improvements (non-blocking)
  dimensions: SpecValidationDimensions;
}

export interface SpecValidationDimensions {
  completeness: number;   // 0–10
  clarity: number;        // 0–10
  measurability: number;  // 0–10
  scope: number;          // 0–10
  format: number;         // 0–10
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SPEC_LENGTH = 100;
const MAX_SPEC_LENGTH = 50_000;
const MIN_REQUIREMENTS = 3;
const PASSING_SCORE = 6.0;

// Vague verbs that indicate un-measurable requirements
const VAGUE_VERBS = [
  'maybe', 'somehow', 'eventually', 'should consider', 'might', 'could possibly',
  'it would be nice', 'hopefully', 'probably', 'at some point', 'as needed',
  'when possible', 'later', 'tbd', 'todo', 'fixme', 'to be determined',
];

// Concrete verbs — at least some of these should appear in requirements
const CONCRETE_VERBS = [
  'must', 'shall', 'should', 'will', 'is required to', 'is expected to',
  'is forbidden to', 'must not', 'shall not',
];

// Incomplete-spec markers that indicate unfinished requirements
const PLACEHOLDER_MARKERS = ['TODO', 'TBD', 'FIXME', 'PLACEHOLDER', 'XXX', 'HACK'];

// ---------------------------------------------------------------------------
// Regex patterns for requirement detection
// ---------------------------------------------------------------------------

const REQ_NUMBERED = /^(\d+)[.)]\s+.{5,}/m;
const REQ_ID_FORMAT = /^REQ-\d{3,}[:\s]+.{5,}/im;
const REQ_CHECKBOX = /^-\s+\[[ xX]\]\s+.{5,}/m;

// ---------------------------------------------------------------------------
// Internal check functions
// ---------------------------------------------------------------------------

/** Returns true if spec has a recognizable title line (# heading or "Feature:" prefix). */
function hasTitle(specText: string): boolean {
  return /^#+\s+\S+/m.test(specText) || /^(Feature|Title|Name)[:\s]+\S+/im.test(specText);
}

/** Returns true if spec has a recognizable goal/purpose statement. */
function hasGoal(specText: string): boolean {
  return /\b(goal|purpose|objective|summary|overview|description|background|motivation)\b/i.test(specText);
}

/** Returns the count of recognized requirement lines. */
function countRequirements(specText: string): number {
  const lines = specText.split('\n');
  let count = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (
      /^(\d+)[.)]\s+.{5,}/.test(line) ||
      /^REQ-\d+[:\s]+.{5,}/i.test(line) ||
      /^-\s+\[[ xX]\]\s+.{5,}/.test(line)
    ) {
      count++;
    }
  }

  return count;
}

/** Returns true if spec has an acceptance criteria section. */
function hasAcceptanceCriteria(specText: string): boolean {
  return /#+\s*(acceptance\s+criteria|ac\s*:?\s*$)/im.test(specText);
}

/** Returns lines in the spec that contain incomplete-spec markers. */
function findPlaceholderLines(specText: string): string[] {
  const placeholders: string[] = [];
  const lines = specText.split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    for (const marker of PLACEHOLDER_MARKERS) {
      if (line.toUpperCase().includes(marker)) {
        placeholders.push(line.slice(0, 80));
        break;
      }
    }
  }

  return placeholders;
}

/** Returns vague verb phrases found in spec. */
function findVagueVerbs(specText: string): string[] {
  const lower = specText.toLowerCase();
  return VAGUE_VERBS.filter((v) => lower.includes(v));
}

/** Returns true if spec uses at least one concrete verb. */
function hasConcreteVerbs(specText: string): boolean {
  const lower = specText.toLowerCase();
  return CONCRETE_VERBS.some((v) => lower.includes(v));
}

/** Returns the dominant format used for requirements. */
function detectFormat(specText: string): 'numbered' | 'checkbox' | 'req-id' | 'mixed' | 'none' {
  const hasNumbered = REQ_NUMBERED.test(specText);
  const hasCheckbox = REQ_CHECKBOX.test(specText);
  const hasReqId = REQ_ID_FORMAT.test(specText);

  const count = [hasNumbered, hasCheckbox, hasReqId].filter(Boolean).length;

  if (count === 0) return 'none';
  if (count > 1) return 'mixed';
  if (hasNumbered) return 'numbered';
  if (hasCheckbox) return 'checkbox';
  return 'req-id';
}

// ---------------------------------------------------------------------------
// Dimension scorers
// ---------------------------------------------------------------------------

function scoreCompleteness(specText: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let points = 0;
  const maxPoints = 4;

  if (hasTitle(specText)) {
    points++;
  } else {
    issues.push('Missing title: add a # Heading or "Feature: <name>" line');
  }

  if (hasGoal(specText)) {
    points++;
  } else {
    issues.push('Missing goal/purpose section: add a "Goal:" or "## Overview" section');
  }

  const reqCount = countRequirements(specText);
  if (reqCount >= MIN_REQUIREMENTS) {
    points++;
  } else {
    issues.push(`Too few requirements: found ${reqCount}, need at least ${MIN_REQUIREMENTS} (numbered, checkbox, or REQ-NNN format)`);
  }

  if (hasAcceptanceCriteria(specText)) {
    points++;
  } else {
    suggestions.push('Add an "## Acceptance Criteria" section with testable conditions');
  }

  return { score: (points / maxPoints) * 10, issues, suggestions };
}

function scoreClarity(specText: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  const placeholders = findPlaceholderLines(specText);
  if (placeholders.length > 0) {
    issues.push(`Found ${placeholders.length} placeholder(s) in requirement text (TODO/TBD/FIXME). Remove or resolve them.`);
  }

  // Start at full score, deduct for placeholders (up to -5) and vague verbs (up to -2)
  const vagueFound = findVagueVerbs(specText);
  if (vagueFound.length > 0) {
    suggestions.push(`Vague language detected: "${vagueFound.slice(0, 3).join('", "')}". Use concrete verbs (must, shall, will).`);
  }

  const placeholderPenalty = Math.min(placeholders.length * 2.5, 5);
  const vaguePenalty = Math.min(vagueFound.length * 0.5, 2);
  const score = Math.max(0, 10 - placeholderPenalty - vaguePenalty);

  return { score, issues, suggestions };
}

function scoreMeasurability(specText: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];

  const concrete = hasConcreteVerbs(specText);
  const vague = findVagueVerbs(specText);

  if (!concrete) {
    issues.push('Requirements lack concrete obligation verbs (must, shall, should, will). Ambiguous specs cannot be verified.');
  }

  const vagueRatio = vague.length / Math.max(1, specText.split('\n').length);
  let score = concrete ? 8 : 3;

  if (vague.length > 0 && vague.length <= 2) {
    score -= 1;
    suggestions.push(`Replace vague language: "${vague.join('", "')}"`);
  } else if (vague.length > 2) {
    score -= 3;
    issues.push(`Multiple vague phrases (${vague.length}) make the spec unmeasurable: "${vague.slice(0, 2).join('", ')}..."`);
  }

  // Ensure score is clamped
  score = Math.max(0, Math.min(10, score - vagueRatio * 2));

  return { score, issues, suggestions };
}

function scoreScope(specText: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const len = specText.length;

  if (len < MIN_SPEC_LENGTH) {
    issues.push(`Spec is too short (${len} chars). A useful spec needs at least ${MIN_SPEC_LENGTH} characters.`);
    return { score: 2, issues, suggestions };
  }

  if (len > MAX_SPEC_LENGTH) {
    issues.push(`Spec is too long (${len} chars > ${MAX_SPEC_LENGTH}). Split into multiple specs or trim context.`);
    return { score: 4, issues, suggestions };
  }

  // Ideal range: 200–10,000 chars → full score; taper at extremes
  const idealMin = 200;
  const idealMax = 10_000;

  if (len < idealMin) {
    suggestions.push('Consider expanding the spec — very brief specs often lack detail needed for planning.');
    return { score: 6, issues, suggestions };
  }

  if (len > idealMax) {
    suggestions.push('Large spec detected — consider extracting sub-specs for each major module.');
    return { score: 7, issues, suggestions };
  }

  return { score: 10, issues, suggestions };
}

function scoreFormat(specText: string): { score: number; issues: string[]; suggestions: string[] } {
  const issues: string[] = [];
  const suggestions: string[] = [];
  const fmt = detectFormat(specText);

  if (fmt === 'none') {
    issues.push('No recognized requirement format found. Use numbered list (1. ...), checkboxes (- [ ] ...), or REQ-NNN identifiers.');
    return { score: 2, issues, suggestions };
  }

  if (fmt === 'mixed') {
    suggestions.push('Mixed requirement formats detected. Pick one style (numbered, checkbox, or REQ-NNN) and apply consistently.');
    return { score: 7, issues, suggestions };
  }

  return { score: 10, issues, suggestions };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validates a spec text and returns a structured result with a quality score,
 * blocking issues, and non-blocking suggestions.
 *
 * Scores five dimensions (completeness, clarity, measurability, scope, format)
 * and combines them into a weighted composite (0–10). A spec passes when
 * `score >= 6.0` AND there are no blocking issues.
 *
 * @param specText - Raw markdown or plain-text spec content to validate.
 *   Must be at least 100 characters to avoid a scope penalty.
 *   Supports numbered lists (`1. …`), checkbox lists (`- [ ] …`), and
 *   `REQ-NNN` identifiers for requirement detection.
 * @returns A `SpecValidationResult` containing:
 *   - `valid` — true when the spec passes all gates
 *   - `score` — 0–10 composite quality score (rounded to 1 dp)
 *   - `issues` — blocking problems that must be fixed before planning
 *   - `suggestions` — optional improvements (non-blocking)
 *   - `dimensions` — per-dimension breakdown for detailed feedback
 *
 * @example
 * // Validate a minimal spec
 * const result = validateSpec(`
 * # Login Feature
 * Goal: Allow users to sign in with email and password.
 * 1. The system must authenticate with bcrypt.
 * 2. The system shall return JWT on success.
 * 3. The system must not expose password hashes.
 * ## Acceptance Criteria
 * - Login round-trip < 500 ms.
 * `);
 * console.log(result.valid);  // true
 * console.log(result.score);  // e.g. 8.4
 */
export function validateSpec(specText: string): SpecValidationResult {
  const comp = scoreCompleteness(specText);
  const clar = scoreClarity(specText);
  const meas = scoreMeasurability(specText);
  const scope = scoreScope(specText);
  const fmt = scoreFormat(specText);

  // Weighted composite: completeness 35%, clarity 25%, measurability 20%, scope 10%, format 10%
  const score =
    comp.score * 0.35 +
    clar.score * 0.25 +
    meas.score * 0.20 +
    scope.score * 0.10 +
    fmt.score * 0.10;

  const roundedScore = Math.round(score * 10) / 10;

  const allIssues = [...comp.issues, ...clar.issues, ...meas.issues, ...scope.issues, ...fmt.issues];
  const allSuggestions = [
    ...comp.suggestions,
    ...clar.suggestions,
    ...meas.suggestions,
    ...scope.suggestions,
    ...fmt.suggestions,
  ];

  return {
    valid: roundedScore >= PASSING_SCORE && allIssues.length === 0,
    score: roundedScore,
    issues: allIssues,
    suggestions: allSuggestions,
    dimensions: {
      completeness: Math.round(comp.score * 10) / 10,
      clarity: Math.round(clar.score * 10) / 10,
      measurability: Math.round(meas.score * 10) / 10,
      scope: Math.round(scope.score * 10) / 10,
      format: Math.round(fmt.score * 10) / 10,
    },
  };
}
