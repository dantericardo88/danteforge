// Model Personality Profiles — statistical map of a model's coding behavior.
// Built automatically from DanteForge verification data.
// Persisted per-project in .danteforge/model-profiles/.

/**
 * Statistical profile of a model's coding behavior.
 * Built automatically from DanteForge verification data.
 * Persisted per-project in .danteforge/model-profiles/.
 */
export interface ModelProfile {
  /** Provider + model identifier. e.g. "grok:grok-3" */
  modelKey: string;
  providerId: string;
  modelId: string;

  /** When this profile was created and last updated. */
  createdAt: string;
  updatedAt: string;

  /** Total number of tasks this model has been evaluated on. */
  totalTasks: number;

  /** Category-level performance statistics. */
  categories: Record<string, CategoryStats>;

  /** Known weakness patterns (from verification failures and 7 Levels Deep findings). */
  weaknesses: WeaknessPattern[];

  /** Known strength patterns (consistently high PDSE categories). */
  strengths: StrengthPattern[];

  /** Compensating instructions that improve output quality. */
  compensations: CompensationRule[];

  /** Overall aggregate scores. */
  aggregate: {
    averagePdse: number;
    firstPassSuccessRate: number;
    averageRetriesNeeded: number;
    averageTokensPerTask: number;
    stubViolationRate: number;
  };
}

export interface CategoryStats {
  category: string;
  taskCount: number;
  averagePdse: number;
  minPdse: number;
  maxPdse: number;
  firstPassSuccessRate: number;
  averageRetries: number;
  averageTokens: number;
  stubViolationRate: number;
  /** Recent trend: improving, stable, or declining. */
  trend: 'improving' | 'stable' | 'declining';
  /** Recent scores for trend calculation (last 10). */
  recentScores: Array<{ timestamp: string; pdse: number }>;
}

export interface WeaknessPattern {
  id: string;
  description: string;
  category: string;
  severity: 'low' | 'medium' | 'high';
  occurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  /** Level 3/4 root cause from 7 Levels Deep, if available. */
  rootCause?: string;
  /** Whether a compensation rule has been created for this. */
  compensated: boolean;
}

export interface StrengthPattern {
  id: string;
  description: string;
  category: string;
  averagePdse: number;
  taskCount: number;
}

export interface CompensationRule {
  id: string;
  weaknessId: string;
  /** Instruction injected into the system prompt when the task matches. */
  instruction: string;
  appliesTo: string[];
  source: 'auto' | 'manual';
  pdseImpact?: number;
}

// ── Task Category Classifier ──────────────────────────────────────────────────

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  authentication: [/auth/i, /oauth/i, /login/i, /jwt/i, /session/i, /password/i, /token/i, /sso/i, /saml/i],
  database: [/database/i, /sql/i, /query/i, /migration/i, /schema/i, /orm/i, /prisma/i, /mongo/i, /redis/i],
  api: [/api/i, /endpoint/i, /rest/i, /graphql/i, /grpc/i, /route/i, /middleware/i, /request/i, /response/i],
  testing: [/test/i, /spec/i, /mock/i, /fixture/i, /coverage/i, /assert/i, /vitest/i, /jest/i],
  ui: [/component/i, /react/i, /vue/i, /css/i, /layout/i, /render/i, /style/i, /html/i, /frontend/i],
  devops: [/\bci\b/i, /\bcd\b/i, /deploy/i, /docker/i, /kubernetes/i, /pipeline/i, /github.action/i, /workflow/i],
  algorithm: [/algorithm/i, /sort/i, /search/i, /\btree\b/i, /\bgraph\b/i, /dynamic.programming/i],
  refactoring: [/refactor/i, /restructure/i, /cleanup/i, /rename/i, /extract/i, /consolidat/i],
  documentation: [/document/i, /readme/i, /\bcomment/i, /jsdoc/i, /explain/i, /describe/i],
  security: [/security/i, /vulnerab/i, /encrypt/i, /sanitiz/i, /\bxss\b/i, /injection/i, /csrf/i],
  error_handling: [/\berror\b/i, /exception/i, /\bcatch\b/i, /\bthrow\b/i, /retry/i, /fallback/i, /recovery/i],
  configuration: [/config/i, /settings/i, /\benv\b/i, /\byaml\b/i, /\btoml\b/i, /\bsetup\b/i],
  performance: [/performance/i, /optimize/i, /\bcache\b/i, /latency/i, /throughput/i, /memory.leak/i],
  migration: [/migrat/i, /upgrade/i, /convert/i, /\bport\b/i, /legacy/i],
};

/**
 * Classify a task description into one or more categories for profile matching.
 * Returns ["general"] if no category matched.
 */
export function classifyTask(description: string): string[] {
  const categories: string[] = [];
  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    const matched = patterns.some(p => p.test(description));
    if (matched) categories.push(category);
  }
  return categories.length > 0 ? categories : ['general'];
}

// ── Compensation Generation ────────────────────────────────────────────────────

const COMPENSATION_TEMPLATES: Record<string, string> = {
  authentication: 'Pay special attention to authentication edge cases: token refresh, session expiry, and OAuth2 redirect handling. Implement these fully — do not stub or defer them.',
  database: 'Ensure all database operations include proper error handling, connection cleanup, and null-safety for optional fields. Do not stub migration logic.',
  api: 'Implement full request validation, response typing, and error codes. Every endpoint must handle malformed input gracefully.',
  testing: 'Write tests that cover the happy path, error paths, and boundary conditions. Do not write placeholder or skipped tests.',
  ui: 'Implement complete UI components with all states (loading, error, empty, populated). Avoid conditional rendering stubs.',
  devops: 'Ensure CI/CD configurations are complete with all required steps. Do not omit environment variable handling or secret management.',
  algorithm: 'Verify algorithm correctness at boundary conditions (empty input, single element, maximum size). Include complexity analysis in comments.',
  refactoring: 'Preserve all existing behavior after refactoring. Add tests before and after to confirm equivalence.',
  documentation: 'Write documentation that is accurate and complete. Include examples for non-obvious usage.',
  security: 'Apply defense-in-depth: validate inputs, escape outputs, use parameterized queries, and never log sensitive data.',
  error_handling: 'Handle all error paths explicitly. Do not use catch-all blocks without specific recovery logic for known error types.',
  configuration: 'Validate all required configuration values at startup. Provide clear error messages for missing or invalid configuration.',
  performance: 'Profile before optimizing. Document the bottleneck identified and the trade-off made.',
  migration: 'Ensure migrations are reversible and include rollback logic. Test against representative data before running in production.',
  general: 'Implement all requirements completely. Do not use placeholder implementations or defer logic to future iterations.',
};

/**
 * Generate a compensating instruction rule from a detected weakness pattern.
 */
export function generateCompensation(weakness: WeaknessPattern): CompensationRule {
  const template = COMPENSATION_TEMPLATES[weakness.category] ?? COMPENSATION_TEMPLATES['general']!;
  const categoryNote = weakness.description.length > 0
    ? ` Context: ${weakness.description}.`
    : '';

  return {
    id: `comp_${weakness.id}`,
    weaknessId: weakness.id,
    instruction: template + categoryNote,
    appliesTo: [weakness.category],
    source: 'auto',
  };
}

// ── Profile Factory ───────────────────────────────────────────────────────────

/**
 * Create an empty profile for a new model.
 */
export function createEmptyProfile(providerId: string, modelId: string): ModelProfile {
  const now = new Date().toISOString();
  return {
    modelKey: `${providerId}:${modelId}`,
    providerId,
    modelId,
    createdAt: now,
    updatedAt: now,
    totalTasks: 0,
    categories: {},
    weaknesses: [],
    strengths: [],
    compensations: [],
    aggregate: {
      averagePdse: 0,
      firstPassSuccessRate: 0,
      averageRetriesNeeded: 0,
      averageTokensPerTask: 0,
      stubViolationRate: 0,
    },
  };
}

/**
 * Compute trend for a category based on recentScores.
 * Compares the average of the first half vs the second half of up to 10 scores.
 */
export function computeTrend(recentScores: Array<{ timestamp: string; pdse: number }>): 'improving' | 'stable' | 'declining' {
  if (recentScores.length < 4) return 'stable';
  const mid = Math.floor(recentScores.length / 2);
  const firstHalf = recentScores.slice(0, mid);
  const secondHalf = recentScores.slice(mid);
  const avgFirst = firstHalf.reduce((s, r) => s + r.pdse, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, r) => s + r.pdse, 0) / secondHalf.length;
  const delta = avgSecond - avgFirst;
  if (delta > 3) return 'improving';
  if (delta < -3) return 'declining';
  return 'stable';
}
