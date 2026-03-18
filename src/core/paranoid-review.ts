// Paranoid Review — two-pass security and quality audit.
// Pass 1: CRITICAL (SQL injection, auth bypass, secrets exposure)
// Pass 2: INFORMATIONAL (race conditions, N+1 queries, missing error boundaries)

export type ReviewSeverity = 'critical' | 'informational';
export type ReviewResolution = 'fix' | 'acknowledge' | 'false-positive';

export interface ReviewFinding {
  severity: ReviewSeverity;
  category: string;
  filePath: string;
  lineNumber?: number;
  description: string;
  recommendation: string;
  resolution?: ReviewResolution;
}

export interface ReviewResult {
  critical: ReviewFinding[];
  informational: ReviewFinding[];
  summary: string;
}

// ── Critical patterns (Pass 1) ──────────────────────────────────────────────

const CRITICAL_PATTERNS: Array<{
  regex: RegExp;
  category: string;
  description: string;
  recommendation: string;
}> = [
  {
    regex: /(?:(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b.*\$\{|\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b)/i,
    category: 'sql-injection',
    description: 'Potential SQL injection — template literal used in SQL query',
    recommendation: 'Use parameterized queries or an ORM instead of string interpolation',
  },
  {
    regex: /(?:password|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"]{8,}/i,
    category: 'secrets-exposure',
    description: 'Hardcoded secret or credential detected',
    recommendation: 'Move secrets to environment variables or a secrets manager',
  },
  {
    regex: /eval\s*\(/,
    category: 'code-injection',
    description: 'eval() usage detected — potential code injection risk',
    recommendation: 'Replace eval() with a safer alternative (JSON.parse, Function constructor, etc.)',
  },
  {
    regex: /innerHTML\s*=/,
    category: 'xss',
    description: 'Direct innerHTML assignment — potential XSS vulnerability',
    recommendation: 'Use textContent, DOM APIs, or a sanitization library instead',
  },
  {
    regex: /(?:req|request)\.(?:body|query|params)\b(?!.*(?:validate|sanitize|schema|zod|joi))/,
    category: 'input-validation',
    description: 'User input accessed without apparent validation',
    recommendation: 'Validate and sanitize all user input before use',
  },
  {
    regex: /\.env\b.*(?:commit|push|add)/i,
    category: 'secrets-exposure',
    description: '.env file referenced in git operations',
    recommendation: 'Ensure .env is in .gitignore and never committed',
  },
];

// ── Informational patterns (Pass 2) ─────────────────────────────────────────

const INFORMATIONAL_PATTERNS: Array<{
  regex: RegExp;
  category: string;
  description: string;
  recommendation: string;
}> = [
  {
    regex: /for\s*\(.*\)\s*\{[^}]*await\s/,
    category: 'n-plus-1',
    description: 'Await inside loop — potential N+1 query pattern',
    recommendation: 'Consider batching or using Promise.all for parallel execution',
  },
  {
    regex: /catch\s*\([^)]*\)\s*\{\s*\}/,
    category: 'error-swallowing',
    description: 'Empty catch block — errors silently swallowed',
    recommendation: 'Log the error or re-throw. Empty catches hide bugs.',
  },
  {
    regex: /setTimeout\s*\(\s*[^,]+,\s*0\s*\)/,
    category: 'race-condition',
    description: 'setTimeout(fn, 0) — potential race condition or timing hack',
    recommendation: 'Use proper async/await patterns instead of setTimeout hacks',
  },
  {
    regex: /any\b/,
    category: 'type-safety',
    description: 'TypeScript "any" type detected — reduces type safety',
    recommendation: 'Replace with proper types or use "unknown" with type guards',
  },
  {
    regex: /console\.log\s*\(/,
    category: 'debug-artifacts',
    description: 'console.log left in production code',
    recommendation: 'Remove debug logging or replace with a proper logger',
  },
];

// ── Main review function ────────────────────────────────────────────────────

export function runParanoidReview(diffText: string): ReviewResult {
  const critical: ReviewFinding[] = [];
  const informational: ReviewFinding[] = [];

  const lines = diffText.split('\n');
  let currentFile = '';
  let currentLine = 0;

  for (const line of lines) {
    // Track current file from diff headers
    const fileMatch = line.match(/^\+\+\+ b\/(.*)/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    // Track line numbers from diff hunks
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }

    // Only check added lines (lines starting with +)
    if (!line.startsWith('+') || line.startsWith('+++')) continue;
    const content = line.substring(1); // Remove the leading +

    // Pass 1: CRITICAL
    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.regex.test(content)) {
        critical.push({
          severity: 'critical',
          category: pattern.category,
          filePath: currentFile,
          lineNumber: currentLine,
          description: pattern.description,
          recommendation: pattern.recommendation,
        });
      }
    }

    // Pass 2: INFORMATIONAL
    for (const pattern of INFORMATIONAL_PATTERNS) {
      if (pattern.regex.test(content)) {
        informational.push({
          severity: 'informational',
          category: pattern.category,
          filePath: currentFile,
          lineNumber: currentLine,
          description: pattern.description,
          recommendation: pattern.recommendation,
        });
      }
    }

    currentLine++;
  }

  const summary = critical.length === 0
    ? `Review passed: ${informational.length} informational finding(s)`
    : `Review has ${critical.length} CRITICAL finding(s) that must be resolved before shipping`;

  return { critical, informational, summary };
}

// ── Finding resolution ──────────────────────────────────────────────────────

export function resolveFindings(
  findings: ReviewFinding[],
  resolutions: Record<number, ReviewResolution>,
): ReviewFinding[] {
  return findings.map((finding, index) => ({
    ...finding,
    resolution: resolutions[index] ?? finding.resolution,
  }));
}

// ── Summary formatting ──────────────────────────────────────────────────────

export function formatReviewSummary(result: ReviewResult): string {
  const lines: string[] = [
    '## Pre-Landing Review',
    '',
    result.summary,
    '',
  ];

  if (result.critical.length > 0) {
    lines.push('### CRITICAL Findings');
    for (const f of result.critical) {
      lines.push(`- **[${f.category}]** ${f.filePath}${f.lineNumber ? `:${f.lineNumber}` : ''}: ${f.description}`);
      lines.push(`  Recommendation: ${f.recommendation}`);
    }
    lines.push('');
  }

  if (result.informational.length > 0) {
    lines.push('### INFORMATIONAL Findings');
    for (const f of result.informational) {
      lines.push(`- **[${f.category}]** ${f.filePath}${f.lineNumber ? `:${f.lineNumber}` : ''}: ${f.description}`);
    }
  }

  return lines.join('\n');
}
