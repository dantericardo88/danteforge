import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractRequirements,
  matchPatternsToRequirements,
  computeSpecMatch,
  formatCoverageReport,
  type OssPattern,
  type SpecRequirement,
} from '../src/core/spec-matcher.ts';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePattern(
  patternName: string,
  category: string,
  whyItWorks = '',
): OssPattern {
  return { patternName, category, whyItWorks };
}

// ── T1-T4: extractRequirements ────────────────────────────────────────────────

describe('extractRequirements', () => {
  it('T1: parses numbered lines (1. ...)', () => {
    const spec = `1. The system must authenticate users.\n2. Data must be encrypted at rest.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.id, 'REQ-001');
    assert.equal(reqs[0]!.text, 'The system must authenticate users.');
    assert.equal(reqs[1]!.id, 'REQ-002');
  });

  it('T1b: parses numbered lines with ) delimiter (1) ...)', () => {
    const spec = `1) First requirement.\n2) Second requirement.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.id, 'REQ-001');
    assert.equal(reqs[0]!.text, 'First requirement.');
  });

  it('T2: parses checkbox lines (- [ ] ...)', () => {
    const spec = `- [ ] Support multi-tenant isolation.\n- [x] Provide REST API endpoints.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.id, 'REQ-001');
    assert.equal(reqs[0]!.text, 'Support multi-tenant isolation.');
    assert.equal(reqs[1]!.text, 'Provide REST API endpoints.');
  });

  it('T2b: parses REQ-XXX identifier lines', () => {
    const spec = `REQ-042: The system must handle retries.\nREQ-043: Implement circuit breaker.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 2);
    assert.equal(reqs[0]!.id, 'REQ-042');
    assert.equal(reqs[0]!.text, 'The system must handle retries.');
    assert.equal(reqs[1]!.id, 'REQ-043');
  });

  it('T3: infers category "security" from keywords', () => {
    const spec = `1. All API tokens must be encrypted before storage.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0]!.category, 'security');
  });

  it('T4: infers category "performance" from latency keyword', () => {
    const spec = `1. Response latency must be under 200ms at p99.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0]!.category, 'performance');
  });

  it('T3b: infers category "error-handling" from circuit keyword', () => {
    // Use 'circuit' which is unambiguously error-handling (no overlap with api-design)
    const spec = `1. The system must implement a circuit breaker for fault tolerance.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs[0]!.category, 'error-handling');
  });

  it('T3c: infers category "testing" from coverage keyword', () => {
    const spec = `1. Code coverage must be at least 80%.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs[0]!.category, 'testing');
  });

  it('T3d: falls back to "general" when no known keywords match', () => {
    const spec = `1. The UI must display a welcome message.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs[0]!.category, 'general');
  });

  it('T1c: ignores blank lines and non-requirement lines', () => {
    const spec = `# Heading\n\nSome prose.\n\n1. Actual requirement.`;
    const reqs = extractRequirements(spec);
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0]!.text, 'Actual requirement.');
  });

  it('T1d: returns [] on empty spec text', () => {
    const reqs = extractRequirements('');
    assert.deepEqual(reqs, []);
  });
});

// ── T5-T7: matchPatternsToRequirements ───────────────────────────────────────

describe('matchPatternsToRequirements', () => {
  const securityReq: SpecRequirement = {
    id: 'REQ-001',
    text: 'All tokens must be encrypted.',
    category: 'security',
  };

  it('T5: returns coverage=0 when no patterns match', () => {
    const coverage = matchPatternsToRequirements([securityReq], []);
    assert.equal(coverage.length, 1);
    assert.equal(coverage[0]!.coverageScore, 0);
    assert.equal(coverage[0]!.status, 'open');
    assert.deepEqual(coverage[0]!.coveringPatterns, []);
  });

  it('T5b: open status when patterns exist but none match this requirement', () => {
    const patterns = [makePattern('cache-layer', 'performance', 'speeds up reads')];
    const coverage = matchPatternsToRequirements([securityReq], patterns);
    assert.equal(coverage[0]!.status, 'open');
    assert.equal(coverage[0]!.coverageScore, 0);
  });

  it('T6: returns score=0.5 for 1 matching pattern', () => {
    const patterns = [makePattern('jwt-auth', 'security', 'JWT token signing')];
    const coverage = matchPatternsToRequirements([securityReq], patterns);
    assert.equal(coverage[0]!.coverageScore, 0.5);
    assert.equal(coverage[0]!.status, 'partial');
    assert.equal(coverage[0]!.coveringPatterns.length, 1);
    assert.equal(coverage[0]!.coveringPatterns[0], 'jwt-auth');
  });

  it('T7: returns score=1.0 for 2+ matching patterns', () => {
    const patterns = [
      makePattern('jwt-auth', 'security', 'JWT token signing'),
      makePattern('aes-encrypt', 'security', 'AES encryption at rest'),
    ];
    const coverage = matchPatternsToRequirements([securityReq], patterns);
    assert.equal(coverage[0]!.coverageScore, 1.0);
    assert.equal(coverage[0]!.status, 'covered');
    assert.equal(coverage[0]!.coveringPatterns.length, 2);
  });

  it('T6b: keyword match via whyItWorks description containing req text keyword', () => {
    // securityReq text is "All tokens must be encrypted." → keywords include "tokens", "must", "encrypted"
    // "tokens" (6 chars, >3) will match against whyItWorks "JWT token authorization" via substring
    const req: SpecRequirement = { id: 'REQ-001', text: 'tokens must be safe', category: 'general' };
    const patterns = [makePattern('jwt-auth', 'general', 'tokens authorization library')];
    const coverage = matchPatternsToRequirements([req], patterns);
    // 'tokens' from req text matches in whyItWorks "tokens authorization library"
    assert.equal(coverage[0]!.coveringPatterns.length, 1);
  });

  it('T5c: handles multiple requirements correctly', () => {
    const reqs: SpecRequirement[] = [
      { id: 'REQ-001', text: 'Tokens must be encrypted.', category: 'security' },
      { id: 'REQ-002', text: 'Cache database responses.', category: 'performance' },
    ];
    const patterns = [makePattern('redis-cache', 'performance', 'caching layer')];
    const coverage = matchPatternsToRequirements(reqs, patterns);
    assert.equal(coverage.length, 2);
    assert.equal(coverage[0]!.status, 'open');   // security req, no match
    assert.equal(coverage[1]!.status, 'partial'); // performance req, 1 match
  });
});

// ── T8: computeSpecMatch ──────────────────────────────────────────────────────

describe('computeSpecMatch', () => {
  it('T8: computes overallCoveragePercent correctly', () => {
    // 3 requirements: 1 covered (score=1.0), 1 partial (score=0.5), 1 open (score=0)
    const spec = [
      '1. Encrypt all user tokens and secrets.',      // security → 2 patterns → covered
      '2. Cache database responses for performance.',  // performance → 1 pattern → partial
      '3. Display a welcome splash screen.',          // general → 0 patterns → open
    ].join('\n');
    const patterns: OssPattern[] = [
      makePattern('jwt-auth', 'security', 'token signing'),
      makePattern('aes-util', 'security', 'encryption utilities'),
      makePattern('redis-cache', 'performance', 'redis caching layer'),
    ];
    const result = computeSpecMatch(spec, patterns);
    assert.equal(result.totalRequirements, 3);
    assert.equal(result.coveredCount, 1);
    assert.equal(result.partialCount, 1);
    assert.equal(result.openCount, 1);
    // overallCoveragePercent = round((1.0 + 0.5 + 0) / 3 * 100) = round(50) = 50
    assert.equal(result.overallCoveragePercent, 50);
  });

  it('T8b: returns 0% coverage when spec has no requirements', () => {
    const result = computeSpecMatch('', []);
    assert.equal(result.totalRequirements, 0);
    assert.equal(result.overallCoveragePercent, 0);
  });

  it('T8c: returns 100% when all requirements are fully covered', () => {
    const spec = '1. Encrypt tokens.\n2. Cache responses.';
    const patterns: OssPattern[] = [
      makePattern('jwt-auth', 'security', 'token auth'),
      makePattern('jwt-util', 'security', 'utility'),
      makePattern('redis-cache', 'performance', 'cache layer'),
      makePattern('mem-cache', 'performance', 'memory cache'),
    ];
    const result = computeSpecMatch(spec, patterns);
    assert.equal(result.overallCoveragePercent, 100);
    assert.equal(result.openCount, 0);
  });
});

// ── T9: formatCoverageReport ──────────────────────────────────────────────────

describe('formatCoverageReport', () => {
  function buildReport(): string {
    const spec = [
      '1. Encrypt all user tokens.',
      '2. Cache database responses for speed.',
      '3. Display a welcome screen.',
    ].join('\n');
    const patterns: OssPattern[] = [
      makePattern('jwt-auth', 'security', 'token auth'),
      makePattern('jwt-util', 'security', 'jwt utility'),
      makePattern('redis-cache', 'performance', 'cache layer'),
    ];
    const result = computeSpecMatch(spec, patterns);
    return formatCoverageReport(result);
  }

  it('T9: generates markdown with summary table', () => {
    const report = buildReport();
    assert.ok(typeof report === 'string');
    assert.ok(report.includes('# Pattern Coverage Report'), 'Should have heading');
    assert.ok(report.includes('## Summary'), 'Should have Summary section');
    // Table headers
    assert.ok(report.includes('| Metric | Value |'), 'Should have table headers');
    assert.ok(report.includes('Total requirements'), 'Should list total requirements');
    assert.ok(report.includes('Overall coverage'), 'Should list overall coverage');
  });

  it('T9b: includes covered/partial/open counts in table', () => {
    const report = buildReport();
    // Covered: 1, Partial: 1, Open: 1
    assert.ok(report.includes('| Covered |'), 'Should include Covered row');
    assert.ok(report.includes('| Partial |'), 'Should include Partial row');
    assert.ok(report.includes('| Open |'), 'Should include Open row');
  });

  it('T9c: includes section headings for requirement statuses', () => {
    const report = buildReport();
    assert.ok(report.includes('## Covered Requirements'), 'Should have Covered section');
    assert.ok(report.includes('## Partially Covered Requirements'), 'Should have Partial section');
    assert.ok(report.includes('## Open Requirements'), 'Should have Open section');
  });

  it('T9d: requirement IDs appear in the report', () => {
    const report = buildReport();
    assert.ok(report.includes('REQ-001'), 'Should include REQ-001');
    assert.ok(report.includes('REQ-002'), 'Should include REQ-002');
    assert.ok(report.includes('REQ-003'), 'Should include REQ-003');
  });

  it('T9e: pattern names appear in covering-patterns column', () => {
    const report = buildReport();
    assert.ok(report.includes('jwt-auth'), 'Should list pattern jwt-auth');
    assert.ok(report.includes('redis-cache'), 'Should list pattern redis-cache');
  });

  it('T9f: does not include empty status sections', () => {
    // All open (no patterns) → only Open section
    const spec = '1. Do something unusual.';
    const result = computeSpecMatch(spec, []);
    const report = formatCoverageReport(result);
    assert.ok(!report.includes('## Covered Requirements'), 'Should NOT have Covered section');
    assert.ok(!report.includes('## Partially Covered Requirements'), 'Should NOT have Partial section');
    assert.ok(report.includes('## Open Requirements'), 'Should have Open section');
  });
});
