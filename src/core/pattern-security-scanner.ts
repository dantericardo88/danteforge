// Pattern Security Scanner — scans pattern implementation snippets for security concerns
// before adoption. Flags but does NOT block (advisory only). Pure functions, no IO.

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SecurityConcern {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;         // e.g. 'hardcoded-secret', 'command-injection'
  description: string;
  line?: number;        // line number in snippet where issue found (1-based)
}

export interface PatternScanResult {
  patternName: string;
  scannedAt: string;
  concerns: SecurityConcern[];
  isSafe: boolean;           // true if no critical/high concerns
  recommendation: 'adopt' | 'review' | 'reject';
  // adopt: 0 critical/high; review: 1+ medium (no critical); reject: 1+ critical
}

// ── Regex definitions ─────────────────────────────────────────────────────────

// 1. Hardcoded secrets: password/secret/apikey/api_key/token = 'longvalue'
const RE_HARDCODED_SECRET = /(password|secret|apikey|api_key|token)\s*=\s*['"][^'"]{8,}['"]/gi;

// 2. Command injection: child_process.exec( with a non-template-literal argument
//    Catches exec("..."), exec('...'), exec(variable) but NOT exec(`...`)
//    Use RegExp constructor to avoid backtick syntax issues in template-literal context.
const RE_COMMAND_INJECTION = new RegExp('child_process\\.exec\\s*\\(\\s*(?![`])', 'g');

// 3. Path traversal: ../ appearing in string concatenation or path.join with user input
//    We flag any occurrence of ../ inside a quoted string or adjacent to +
//    Use RegExp constructor to avoid backtick syntax issues in template-literal context.
const RE_PATH_TRAVERSAL = new RegExp("(?:['\"`][^'\"`]*\\.\\./|path\\.join\\s*\\([^)]*\\+[^)]*\\))", 'g');

// 4. XSS: innerHTML = or document.write(
const RE_XSS = /innerHTML\s*=|document\.write\s*\(/g;

// 5. Insecure randomness: Math.random() near security-sensitive keywords
//    We check per-line for Math.random() when the line contains token/password/secret
const RE_INSECURE_RANDOM = /Math\.random\s*\(\s*\)/g;
const RE_SECURITY_CONTEXT = /\b(token|password|secret|key|nonce|salt|csrf)\b/i;

// 6. eval or new Function
const RE_EVAL = /\beval\s*\(|new\s+Function\s*\(/g;

// ── Internal helpers ──────────────────────────────────────────────────────────

function findLineNumber(snippet: string, index: number): number {
  // Count newlines before the match index to get 1-based line number
  let line = 1;
  for (let i = 0; i < index && i < snippet.length; i++) {
    if (snippet[i] === '\n') line++;
  }
  return line;
}

function scanForPattern(
  snippet: string,
  regex: RegExp,
  buildConcern: (match: RegExpExecArray, lineNum: number) => SecurityConcern,
): SecurityConcern[] {
  const concerns: SecurityConcern[] = [];
  // Reset lastIndex to support re-use of global regexes
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(snippet)) !== null) {
    const lineNum = findLineNumber(snippet, match.index);
    concerns.push(buildConcern(match, lineNum));
  }
  return concerns;
}

// ── Core scanner ──────────────────────────────────────────────────────────────

/**
 * Scans a single pattern snippet for security concerns.
 * Returns a PatternScanResult (advisory only — does not throw).
 */
export function scanPattern(patternName: string, snippet: string): PatternScanResult {
  const concerns: SecurityConcern[] = [];

  // 1. Hardcoded secrets → critical
  concerns.push(
    ...scanForPattern(snippet, RE_HARDCODED_SECRET, (m, line) => ({
      severity: 'critical',
      type: 'hardcoded-secret',
      description: `Hardcoded credential detected near "${m[1]}" assignment.`,
      line,
    })),
  );

  // 2. Command injection → high
  concerns.push(
    ...scanForPattern(snippet, RE_COMMAND_INJECTION, (_m, line) => ({
      severity: 'high',
      type: 'command-injection',
      description:
        'child_process.exec() called with a non-template-literal argument — vulnerable to command injection if input is user-controlled.',
      line,
    })),
  );

  // 3. Path traversal → medium
  concerns.push(
    ...scanForPattern(snippet, RE_PATH_TRAVERSAL, (_m, line) => ({
      severity: 'medium',
      type: 'path-traversal',
      description:
        'Potential path traversal: "../" in a string literal or path.join() with concatenated user input.',
      line,
    })),
  );

  // 4. XSS → high
  concerns.push(
    ...scanForPattern(snippet, RE_XSS, (m, line) => ({
      severity: 'high',
      type: 'xss',
      description: `Unsafe DOM write via "${m[0].trim()}" — may allow XSS if content is user-controlled.`,
      line,
    })),
  );

  // 5. Insecure randomness → medium (only when near security context)
  const lines = snippet.split('\n');
  lines.forEach((lineText, idx) => {
    RE_INSECURE_RANDOM.lastIndex = 0;
    if (RE_INSECURE_RANDOM.test(lineText) && RE_SECURITY_CONTEXT.test(lineText)) {
      concerns.push({
        severity: 'medium',
        type: 'insecure-randomness',
        description:
          'Math.random() used in a security-sensitive context — use crypto.getRandomValues() or crypto.randomBytes() instead.',
        line: idx + 1,
      });
    }
  });

  // 6. eval / new Function → critical
  concerns.push(
    ...scanForPattern(snippet, RE_EVAL, (m, line) => ({
      severity: 'critical',
      type: 'unsafe-eval',
      description: `"${m[0].replace(/\s+/g, ' ')}" executes arbitrary code — never use with untrusted input.`,
      line,
    })),
  );

  const hasCritical = concerns.some((c) => c.severity === 'critical');
  const hasHigh = concerns.some((c) => c.severity === 'high');
  const hasMedium = concerns.some((c) => c.severity === 'medium');

  const isSafe = !hasCritical && !hasHigh;

  let recommendation: PatternScanResult['recommendation'];
  if (hasCritical) {
    recommendation = 'reject';
  } else if (hasHigh || hasMedium) {
    recommendation = 'review';
  } else {
    recommendation = 'adopt';
  }

  return {
    patternName,
    scannedAt: new Date().toISOString(),
    concerns,
    isSafe,
    recommendation,
  };
}

/**
 * Scans multiple patterns and returns all results.
 */
export function scanPatterns(
  patterns: Array<{ patternName: string; implementationSnippet: string }>,
): PatternScanResult[] {
  return patterns.map((p) => scanPattern(p.patternName, p.implementationSnippet));
}

/**
 * Formats scan results as a markdown report with a summary table.
 */
export function formatScanReport(results: PatternScanResult[]): string {
  if (results.length === 0) {
    return '# Pattern Security Scan Report\n\nNo patterns scanned.\n';
  }

  const lines: string[] = [
    '# Pattern Security Scan Report',
    '',
    `Scanned **${results.length}** pattern(s).`,
    '',
    '## Summary',
    '',
    '| Pattern | Recommendation | Concerns |',
    '|---------|---------------|----------|',
  ];

  for (const r of results) {
    const badge =
      r.recommendation === 'adopt'
        ? 'adopt'
        : r.recommendation === 'review'
          ? 'review'
          : 'reject';
    lines.push(`| ${r.patternName} | ${badge} | ${r.concerns.length} |`);
  }

  lines.push('');

  // Detail section for patterns with concerns
  const withConcerns = results.filter((r) => r.concerns.length > 0);
  if (withConcerns.length > 0) {
    lines.push('## Concern Details', '');
    for (const r of withConcerns) {
      lines.push(`### ${r.patternName}`, '');
      for (const c of r.concerns) {
        const loc = c.line !== undefined ? ` (line ${c.line})` : '';
        lines.push(`- **[${c.severity.toUpperCase()}]** \`${c.type}\`${loc}: ${c.description}`);
      }
      lines.push('');
    }
  }

  const safeCount = results.filter((r) => r.isSafe).length;
  const rejectCount = results.filter((r) => r.recommendation === 'reject').length;
  const reviewCount = results.filter((r) => r.recommendation === 'review').length;

  lines.push(
    '## Statistics',
    '',
    `- Safe to adopt: **${safeCount}**`,
    `- Needs review: **${reviewCount}**`,
    `- Rejected: **${rejectCount}**`,
    '',
    '> This report is advisory only. No patterns were blocked automatically.',
    '',
  );

  return lines.join('\n');
}
