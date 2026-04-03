// Maturity-Aware Quality Scoring — 6-level maturity definitions
// Maps aggregate quality scores to real-world readiness levels with founder-friendly descriptions

export type MaturityLevel = 1 | 2 | 3 | 4 | 5 | 6;

export const MATURITY_NAMES: Record<MaturityLevel, string> = {
  1: 'Sketch',
  2: 'Prototype',
  3: 'Alpha',
  4: 'Beta',
  5: 'Customer-Ready',
  6: 'Enterprise-Grade',
};

export const MATURITY_USE_CASES: Record<MaturityLevel, string> = {
  1: 'Demo to co-founder',
  2: 'Show investors',
  3: 'Internal team use',
  4: 'Paid beta customers',
  5: 'Production launch',
  6: 'Fortune 500 contracts',
};

export const MATURITY_PLAIN_LANG: Record<MaturityLevel, string> = {
  1: 'Your code proves the idea works. Good for demos to your co-founder.',
  2: 'Your code is ready to show investors. Works well enough to validate the business model.',
  3: 'Your code is ready for your team to use daily. Internal release quality.',
  4: 'Your code is ready for early customers who expect it to work. Paid beta quality.',
  5: 'Your code is ready for paying customers who trust you with their business. Production launch quality.',
  6: 'Your code is ready for Fortune 500 companies who will audit everything. Mission-critical quality.',
};

export interface MaturityCriteria {
  level: MaturityLevel;
  name: string;
  minScore: number;
  maxScore: number;
  functionality: string;
  testing: string;
  errorHandling: string;
  security: string;
  uxPolish: string;
  documentation: string;
  performance: string;
  maintainability: string;
}

export const MATURITY_CRITERIA: Record<MaturityLevel, MaturityCriteria> = {
  1: {
    level: 1,
    name: 'Sketch',
    minScore: 0,
    maxScore: 20,
    functionality: 'Happy path only, core feature works',
    testing: 'Manual or none',
    errorHandling: 'Basic try/catch, crashes are OK',
    security: 'Hardcoded values acceptable',
    uxPolish: 'Functional but raw',
    documentation: 'Code comments only',
    performance: 'Not measured',
    maintainability: 'Copy-paste is fine',
  },
  2: {
    level: 2,
    name: 'Prototype',
    minScore: 21,
    maxScore: 40,
    functionality: 'Main features work, some edge cases handled',
    testing: 'Basic unit tests (≥50% coverage)',
    errorHandling: 'Logs errors to console',
    security: 'Input validation on critical paths',
    uxPolish: 'Consistent styling, basic responsive',
    documentation: 'README with setup steps',
    performance: 'Works with <100 records',
    maintainability: 'Functions extracted, some reuse',
  },
  3: {
    level: 3,
    name: 'Alpha',
    minScore: 41,
    maxScore: 60,
    functionality: 'All features work, most edge cases covered',
    testing: '≥70% coverage, integration tests',
    errorHandling: 'Typed errors, structured logging',
    security: 'OWASP awareness, no obvious holes',
    uxPolish: 'Accessible (WCAG A), loading states',
    documentation: 'API docs, architecture guide',
    performance: 'Profiled, no obvious bottlenecks',
    maintainability: 'Modular, clear boundaries',
  },
  4: {
    level: 4,
    name: 'Beta',
    minScore: 61,
    maxScore: 75,
    functionality: 'Graceful degradation, error recovery',
    testing: '≥80% coverage, E2E + load tests',
    errorHandling: 'User-facing messages, retry logic',
    security: 'Secrets in env vars, HTTPS enforced, rate limiting',
    uxPolish: 'Polished, empty states, WCAG AA',
    documentation: 'User guides, troubleshooting',
    performance: 'p90 < 500ms for key ops',
    maintainability: 'Plugin architecture, extension points',
  },
  5: {
    level: 5,
    name: 'Customer-Ready',
    minScore: 76,
    maxScore: 88,
    functionality: 'Battle-tested, monitoring/alerts',
    testing: '≥85% coverage, chaos testing',
    errorHandling: 'Sentry/DataDog, PII scrubbing',
    security: 'Pen-tested, SOC2/GDPR ready',
    uxPolish: 'Delightful, animations, WCAG AAA',
    documentation: 'Videos, changelog, migrations',
    performance: 'p99 < 1s, CDN, caching',
    maintainability: 'Versioned APIs, backward compat',
  },
  6: {
    level: 6,
    name: 'Enterprise-Grade',
    minScore: 89,
    maxScore: 100,
    functionality: 'Multi-tenant, RBAC, SLAs',
    testing: '≥90% coverage, formal verification',
    errorHandling: 'Zero-downtime deploys, auto-rollback',
    security: 'Bug bounty, annual audits, zero-trust',
    uxPolish: 'White-label, i18n/l10n, certifications',
    documentation: 'Compliance docs, DR plans',
    performance: '99.99% uptime, auto-scaling',
    maintainability: 'OpenAPI specs, SDK generators',
  },
};

// Map aggregate score (0-100) to maturity level (1-6)
export function scoreToMaturityLevel(aggregateScore: number): MaturityLevel {
  if (aggregateScore >= 89) return 6;
  if (aggregateScore >= 76) return 5;
  if (aggregateScore >= 61) return 4;
  if (aggregateScore >= 41) return 3;
  if (aggregateScore >= 21) return 2;
  return 1;
}

// Generate founder-friendly description for a given level
export function describeLevelForFounders(level: MaturityLevel): string {
  return MATURITY_PLAIN_LANG[level];
}

// Get human-readable level name
export function getMaturityLevelName(level: MaturityLevel): string {
  return MATURITY_NAMES[level];
}

// Get use case description
export function getMaturityUseCase(level: MaturityLevel): string {
  return MATURITY_USE_CASES[level];
}

// Get full criteria object
export function getMaturityCriteria(level: MaturityLevel): MaturityCriteria {
  return MATURITY_CRITERIA[level];
}
