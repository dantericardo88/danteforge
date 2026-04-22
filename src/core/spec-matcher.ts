// Spec-to-pattern matcher — reads the project spec and identifies which
// requirements have OSS pattern coverage and which are still open.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecRequirement {
  id: string;       // e.g. "REQ-001"
  text: string;     // requirement text
  category: string; // inferred from text
}

export interface PatternCoverage {
  requirement: SpecRequirement;
  coveringPatterns: string[];  // pattern names that address this requirement
  coverageScore: number;       // 0=none, 0.5=partial, 1.0=full
  status: 'covered' | 'partial' | 'open';
}

export interface SpecMatchResult {
  totalRequirements: number;
  coveredCount: number;
  partialCount: number;
  openCount: number;
  coverage: PatternCoverage[];
  overallCoveragePercent: number;
}

export interface OssPattern {
  patternName: string;
  category: string;
  whyItWorks: string;
}

// ---------------------------------------------------------------------------
// Category inference
// ---------------------------------------------------------------------------

const CATEGORY_KEYWORDS: Array<{ keywords: string[]; category: string }> = [
  {
    keywords: ['security', 'auth', 'permission', 'encrypt', 'secret', 'token', 'credential', 'rbac', 'acl'],
    category: 'security',
  },
  {
    keywords: ['performance', 'speed', 'latency', 'throughput', 'cache', 'fast', 'slow', 'benchmark', 'optimize'],
    category: 'performance',
  },
  {
    keywords: ['test', 'coverage', 'spec', 'assertion', 'mock', 'stub', 'fixture', 'tdd', 'bdd'],
    category: 'testing',
  },
  {
    keywords: ['api', 'endpoint', 'rest', 'graphql', 'http', 'route', 'request', 'response', 'openapi'],
    category: 'api-design',
  },
  {
    keywords: ['error', 'fault', 'resilience', 'retry', 'circuit', 'fallback', 'recover', 'exception', 'failure'],
    category: 'error-handling',
  },
];

/** Infer the category of a requirement from its text. */
function inferCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const { keywords, category } of CATEGORY_KEYWORDS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return category;
    }
  }
  return 'general';
}

// ---------------------------------------------------------------------------
// Requirement extraction
// ---------------------------------------------------------------------------

// Patterns that identify requirement lines (numbered, identifier-prefixed, or checkbox):
const REQ_NUMBERED = /^(\d+)[.)]\s+(.+)/;
const REQ_ID = /^(REQ-\d+)[:\s]+(.+)/i;
const REQ_CHECKBOX = /^-\s+\[[ xX]\]\s+(.+)/;

/**
 * Parses spec text for requirement lines and returns SpecRequirement[].
 * Assigns sequential IDs where the source does not supply one.
 */
export function extractRequirements(specText: string): SpecRequirement[] {
  const lines = specText.split('\n');
  const requirements: SpecRequirement[] = [];
  let seq = 1;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    let id: string | undefined;
    let text: string | undefined;

    const numberedMatch = REQ_NUMBERED.exec(line);
    const reqIdMatch = REQ_ID.exec(line);
    const checkboxMatch = REQ_CHECKBOX.exec(line);

    if (reqIdMatch) {
      id = reqIdMatch[1].toUpperCase();
      text = reqIdMatch[2].trim();
    } else if (numberedMatch) {
      id = `REQ-${String(seq).padStart(3, '0')}`;
      text = numberedMatch[2].trim();
      seq++;
    } else if (checkboxMatch) {
      id = `REQ-${String(seq).padStart(3, '0')}`;
      text = checkboxMatch[1].trim();
      seq++;
    }

    if (id !== undefined && text !== undefined && text.length > 0) {
      requirements.push({
        id,
        text,
        category: inferCategory(text),
      });
    }
  }

  return requirements;
}

// ---------------------------------------------------------------------------
// Pattern matching
// ---------------------------------------------------------------------------

/**
 * Extracts meaningful keywords from a requirement's text for keyword-based
 * matching against pattern names and whyItWorks descriptions.
 */
function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3); // skip very short words
}

/**
 * For each requirement, finds patterns whose category matches OR whose
 * patternName / whyItWorks contains a keyword from the requirement text.
 *
 * Coverage rules:
 *   0 covering patterns → status='open',    score=0
 *   1 covering pattern  → status='partial', score=0.5
 *   2+ covering patterns → status='covered', score=1.0
 */
export function matchPatternsToRequirements(
  requirements: SpecRequirement[],
  patterns: OssPattern[],
): PatternCoverage[] {
  return requirements.map((req) => {
    const keywords = extractKeywords(req.text);

    const coveringPatterns = patterns
      .filter((p) => {
        // Category match
        if (p.category === req.category) return true;

        // Keyword match against patternName or whyItWorks
        const searchable = `${p.patternName} ${p.whyItWorks}`.toLowerCase();
        return keywords.some((kw) => searchable.includes(kw));
      })
      .map((p) => p.patternName);

    let status: PatternCoverage['status'];
    let coverageScore: number;

    if (coveringPatterns.length === 0) {
      status = 'open';
      coverageScore = 0;
    } else if (coveringPatterns.length === 1) {
      status = 'partial';
      coverageScore = 0.5;
    } else {
      status = 'covered';
      coverageScore = 1.0;
    }

    return { requirement: req, coveringPatterns, coverageScore, status };
  });
}

// ---------------------------------------------------------------------------
// Compute spec match
// ---------------------------------------------------------------------------

/** Combines extract + match into a single SpecMatchResult. */
export function computeSpecMatch(
  specText: string,
  patterns: OssPattern[],
): SpecMatchResult {
  const requirements = extractRequirements(specText);
  const coverage = matchPatternsToRequirements(requirements, patterns);

  const coveredCount = coverage.filter((c) => c.status === 'covered').length;
  const partialCount = coverage.filter((c) => c.status === 'partial').length;
  const openCount = coverage.filter((c) => c.status === 'open').length;
  const totalRequirements = requirements.length;

  const overallCoveragePercent =
    totalRequirements === 0
      ? 0
      : Math.round(
          (coverage.reduce((sum, c) => sum + c.coverageScore, 0) /
            totalRequirements) *
            100,
        );

  return {
    totalRequirements,
    coveredCount,
    partialCount,
    openCount,
    coverage,
    overallCoveragePercent,
  };
}

// ---------------------------------------------------------------------------
// Report formatting
// ---------------------------------------------------------------------------

/** Returns markdown content for PATTERN_COVERAGE.md. */
export function formatCoverageReport(result: SpecMatchResult): string {
  const lines: string[] = [];

  lines.push('# Pattern Coverage Report');
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Total requirements | ${result.totalRequirements} |`);
  lines.push(`| Covered | ${result.coveredCount} |`);
  lines.push(`| Partial | ${result.partialCount} |`);
  lines.push(`| Open | ${result.openCount} |`);
  lines.push(`| Overall coverage | ${result.overallCoveragePercent}% |`);
  lines.push('');

  const grouped: Record<PatternCoverage['status'], PatternCoverage[]> = {
    covered: [],
    partial: [],
    open: [],
  };

  for (const c of result.coverage) {
    grouped[c.status].push(c);
  }

  for (const status of ['covered', 'partial', 'open'] as const) {
    const items = grouped[status];
    if (items.length === 0) continue;

    const heading =
      status === 'covered'
        ? '## Covered Requirements'
        : status === 'partial'
          ? '## Partially Covered Requirements'
          : '## Open Requirements';

    lines.push(heading);
    lines.push('');
    lines.push('| ID | Category | Requirement | Covering Patterns |');
    lines.push('|----|----------|-------------|-------------------|');

    for (const item of items) {
      const { id, category, text } = item.requirement;
      const patternsCell =
        item.coveringPatterns.length > 0
          ? item.coveringPatterns.join(', ')
          : '—';
      lines.push(`| ${id} | ${category} | ${text} | ${patternsCell} |`);
    }

    lines.push('');
  }

  lines.push(
    `*Generated by DanteForge spec-matcher on ${new Date().toISOString()}*`,
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Write report
// ---------------------------------------------------------------------------

const COVERAGE_REPORT_FILENAME = 'PATTERN_COVERAGE.md';

/** Writes the coverage report to .danteforge/PATTERN_COVERAGE.md. */
export async function writeCoverageReport(
  result: SpecMatchResult,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const dir = path.join(cwd ?? process.cwd(), '.danteforge');
  const filePath = path.join(dir, COVERAGE_REPORT_FILENAME);
  const content = formatCoverageReport(result);
  const writer = _fsWrite ?? ((p, d) => writeFile(p, d, 'utf8'));

  if (!_fsWrite) {
    await mkdir(dir, { recursive: true });
  }

  await writer(filePath, content);
}

// ---------------------------------------------------------------------------
// Load spec text
// ---------------------------------------------------------------------------

const SPEC_CANDIDATES = [
  path.join('.danteforge', 'SPEC.md'),
  'SPEC.md',
  'AGENTS.md',
];

/**
 * Tries to load spec text from .danteforge/SPEC.md → SPEC.md → AGENTS.md.
 * Returns '' if none is found.
 */
export async function loadSpecText(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<string> {
  const base = cwd ?? process.cwd();
  const reader = _fsRead ?? ((p) => readFile(p, 'utf8'));

  for (const candidate of SPEC_CANDIDATES) {
    try {
      const full = path.join(base, candidate);
      const text = await reader(full);
      return text;
    } catch {
      // try next candidate
    }
  }

  return '';
}
