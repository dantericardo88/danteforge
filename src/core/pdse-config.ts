// PDSE Configuration — scoring constants, checklists, thresholds, and weights
// Planning Document Scoring Engine configuration.

export type ScoredArtifact = 'CONSTITUTION' | 'SPEC' | 'CLARIFY' | 'PLAN' | 'TASKS';
export type AutoforgeDecision = 'advance' | 'warn' | 'pause' | 'blocked';

export interface ScoreDimensions {
  completeness: number;           // 0–20
  clarity: number;                // 0–20
  testability: number;            // 0–20
  constitutionAlignment: number;  // 0–20
  integrationFitness: number;     // 0–10
  freshness: number;              // 0–10
}

// Section checklists — each item is a required heading or keyword pattern
export const SECTION_CHECKLISTS: Record<ScoredArtifact, string[]> = {
  CONSTITUTION: [
    'zero ambiguity',
    'local-first',
    'atomic commit',
    'verify before commit',
  ],
  SPEC: [
    '## Feature',
    '## What',
    '## User Stor',
    '## Non-functional',
    '## Acceptance Criteria',
  ],
  CLARIFY: [
    '## Ambiguities',
    '## Missing Requirements',
    '## Consistency',
    '## Clarification',
  ],
  PLAN: [
    '## Architecture',
    '## Implementation',
    '## Technology',
    '## Risk',
    '## Testing Strategy',
  ],
  TASKS: [
    '### Phase',
    'task',
  ],
};

// Ambiguity signals for Clarity scoring — each occurrence deducts points
export const AMBIGUITY_WORDS: string[] = [
  'should', 'might', 'could', 'TBD', 'etc.', 'maybe', 'probably',
  'somehow', 'sort of', 'roughly', 'approximately', 'unclear',
  'figure out', 'not sure', 'to be determined', 'we will see',
  'at some point', 'later', 'eventually', 'if possible',
];

// Anti-stub patterns — presence floors Clarity to 0 (from D9 doctrine)
// Supports both plain strings (case-insensitive includes) and RegExp patterns.
export const ANTI_STUB_PATTERNS: (string | RegExp)[] = [
  // ── Original string patterns ──
  'TODO',
  'FIXME',
  'stub',
  'shim',
  'placeholder',
  'tbd',
  'to be determined',
  'simulate',
  'mocked',
  'fake',
  'dummy',
  // ── Regex patterns (v0.8.1 expansion) ──
  /as\s+any/,                             // TypeScript type escape
  /@ts-ignore/,                           // TypeScript suppression
  /@ts-expect-error/,                     // TypeScript suppression
  /NotImplementedError/,                  // unfinished implementation
  /not\s+implemented/i,                   // unfinished implementation
  /coming\s+soon/i,                       // placeholder text
  /throw new Error\(['"]TODO/,            // TODO errors
  /\bxxx\b/i,                             // placeholder marker
  /\bhack\b/i,                            // code smell
  /\bworkaround\b/i,                      // code smell
  /\btemporary\b/i,                        // transient code (config files exempt in check-anti-stub)
  /\bunfinished\b/i,                      // incomplete code
  /\breturn\s+null\s*;?\s*\/\/\s*TODO/i, // null return with TODO
  /console\.log\(['"]debug/i,            // debug logging
];

// Required patterns in SPEC — absence causes completeness deduction
export const SPEC_REQUIRED_PATTERNS: RegExp[] = [
  /acceptance criteria/i,
  /user stor/i,
  /non-functional/i,
];

// Constitution alignment keywords — presence scores +points
export const CONSTITUTION_KEYWORDS: string[] = [
  'zero ambiguity', 'local-first', 'atomic commit',
  'fail-closed', 'verify', 'pipeda', 'audit', 'deterministic',
];

// Scoring weights per dimension (must sum to 100)
export const DIMENSION_WEIGHTS: ScoreDimensions = {
  completeness: 20,
  clarity: 20,
  testability: 20,
  constitutionAlignment: 20,
  integrationFitness: 10,
  freshness: 10,
};

// Decision thresholds
export const SCORE_THRESHOLDS = {
  EXCELLENT: 90,
  ACCEPTABLE: 70,
  NEEDS_WORK: 50,
  // below NEEDS_WORK = BLOCKED
} as const;

// Freshness deduction markers — each deducts 2 from freshness score
export const FRESHNESS_DEDUCTION_MARKERS: string[] = [
  'TODO', 'TBD', 'FIXME', 'to be determined', 'figure out later',
];

// Command remediation map — which command to suggest for each artifact
export const ARTIFACT_COMMAND_MAP: Record<ScoredArtifact, string> = {
  CONSTITUTION: 'constitution',
  SPEC: 'specify --refine',
  CLARIFY: 'clarify',
  PLAN: 'plan --refine',
  TASKS: 'tasks',
};

// Expected upstream artifacts for integration fitness scoring
export const UPSTREAM_DEPENDENCY_MAP: Record<ScoredArtifact, ScoredArtifact[]> = {
  CONSTITUTION: [],
  SPEC: ['CONSTITUTION'],
  CLARIFY: ['SPEC'],
  PLAN: ['SPEC', 'CLARIFY'],
  TASKS: ['PLAN'],
};
