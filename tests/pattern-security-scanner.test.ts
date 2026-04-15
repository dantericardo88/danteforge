import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  scanPattern,
  scanPatterns,
  formatScanReport,
} from '../src/core/pattern-security-scanner.ts';

// ── T1: hardcoded secrets → critical ─────────────────────────────────────────

describe('scanPattern — hardcoded secrets', () => {
  it('T1: detects hardcoded secret (password=\'abc123...\')', () => {
    const snippet = `const password = 'abc123xyz';`;
    const result = scanPattern('auth-module', snippet);
    const concern = result.concerns.find((c) => c.type === 'hardcoded-secret');
    assert.ok(concern !== undefined, 'Expected a hardcoded-secret concern');
    assert.equal(concern!.severity, 'critical');
  });

  it('T1b: detects secret= pattern with long value', () => {
    const snippet = `const secret = "s3cr3tK3yV4lue";`;
    const result = scanPattern('key-module', snippet);
    assert.ok(result.concerns.some((c) => c.type === 'hardcoded-secret'));
  });

  it('T1c: does NOT flag short values (< 8 chars)', () => {
    // Value shorter than 8 chars should not be flagged
    const snippet = `const password = 'hi';`;
    const result = scanPattern('auth-module', snippet);
    assert.equal(result.concerns.filter((c) => c.type === 'hardcoded-secret').length, 0);
  });
});

// ── T2: eval() → critical ─────────────────────────────────────────────────────

describe('scanPattern — eval detection', () => {
  it('T2: detects eval() as critical', () => {
    const snippet = `eval(userInput);`;
    const result = scanPattern('eval-module', snippet);
    const concern = result.concerns.find((c) => c.type === 'unsafe-eval');
    assert.ok(concern !== undefined, 'Expected unsafe-eval concern');
    assert.equal(concern!.severity, 'critical');
  });

  it('T2b: detects new Function() as critical', () => {
    const snippet = `const fn = new Function('return 1');`;
    const result = scanPattern('func-module', snippet);
    const concern = result.concerns.find((c) => c.type === 'unsafe-eval');
    assert.ok(concern !== undefined, 'Expected unsafe-eval concern for new Function()');
    assert.equal(concern!.severity, 'critical');
  });
});

// ── T3: XSS → high ───────────────────────────────────────────────────────────

describe('scanPattern — XSS detection', () => {
  it('T3: detects innerHTML = as high', () => {
    const snippet = `element.innerHTML = userContent;`;
    const result = scanPattern('xss-module', snippet);
    const concern = result.concerns.find((c) => c.type === 'xss');
    assert.ok(concern !== undefined, 'Expected XSS concern');
    assert.equal(concern!.severity, 'high');
  });

  it('T3b: detects document.write( as high', () => {
    const snippet = `document.write('<p>' + data + '</p>');`;
    const result = scanPattern('write-module', snippet);
    const concern = result.concerns.find((c) => c.type === 'xss');
    assert.ok(concern !== undefined, 'Expected XSS concern for document.write');
    assert.equal(concern!.severity, 'high');
  });
});

// ── T4: insecure randomness → medium ─────────────────────────────────────────

describe('scanPattern — insecure randomness', () => {
  it('T4: detects Math.random() near "token" as medium concern', () => {
    const snippet = `const token = Math.random().toString(36);`;
    const result = scanPattern('token-gen', snippet);
    const concern = result.concerns.find((c) => c.type === 'insecure-randomness');
    assert.ok(concern !== undefined, 'Expected insecure-randomness concern');
    assert.equal(concern!.severity, 'medium');
  });

  it('T4b: does NOT flag Math.random() when no security context word nearby', () => {
    const snippet = `const x = Math.random();`;
    const result = scanPattern('math-module', snippet);
    assert.equal(result.concerns.filter((c) => c.type === 'insecure-randomness').length, 0);
  });

  it('T4c: detects Math.random() near "password" as medium', () => {
    const snippet = `const password = prefix + Math.random();`;
    const result = scanPattern('pass-gen', snippet);
    assert.ok(result.concerns.some((c) => c.type === 'insecure-randomness'));
  });
});

// ── T5: clean snippet → isSafe=true, recommendation='adopt' ──────────────────

describe('scanPattern — clean snippet', () => {
  it('T5: clean snippet returns isSafe=true, recommendation=adopt', () => {
    const snippet = `
      function greet(name: string): string {
        return \`Hello, \${name}\`;
      }
    `;
    const result = scanPattern('greeter', snippet);
    assert.equal(result.isSafe, true);
    assert.equal(result.recommendation, 'adopt');
    assert.equal(result.concerns.length, 0);
  });

  it('T5b: patternName is preserved in result', () => {
    const result = scanPattern('my-pattern', 'const x = 1;');
    assert.equal(result.patternName, 'my-pattern');
  });

  it('T5c: scannedAt is a valid ISO string', () => {
    const result = scanPattern('x', 'const a = 1;');
    const d = new Date(result.scannedAt);
    assert.ok(!isNaN(d.getTime()), 'scannedAt should be a valid ISO date string');
  });
});

// ── T6: critical concern → recommendation='reject', isSafe=false ─────────────

describe('scanPattern — reject on critical', () => {
  it('T6: critical concern → recommendation=reject, isSafe=false', () => {
    const snippet = `eval(document.cookie);`;
    const result = scanPattern('bad-module', snippet);
    assert.equal(result.recommendation, 'reject');
    assert.equal(result.isSafe, false);
  });

  it('T6b: high severity alone (XSS) → recommendation=review, isSafe=false', () => {
    const snippet = `div.innerHTML = data;`;
    const result = scanPattern('high-module', snippet);
    assert.equal(result.recommendation, 'review');
    assert.equal(result.isSafe, false);
  });
});

// ── T7: only medium concern → recommendation='review', isSafe=true ───────────

describe('scanPattern — review on medium only', () => {
  it('T7: only medium concern → recommendation=review, isSafe=true', () => {
    // Math.random() in security context is medium only
    const snippet = `const token = Math.random().toString(36);`;
    const result = scanPattern('token-gen', snippet);
    // Ensure no critical/high concerns (so isSafe=true)
    assert.ok(!result.concerns.some((c) => c.severity === 'critical' || c.severity === 'high'));
    assert.equal(result.isSafe, true);
    assert.equal(result.recommendation, 'review');
  });
});

// ── T8: scanPatterns — batch scanning ────────────────────────────────────────

describe('scanPatterns', () => {
  it('T8: batch scans multiple patterns and returns all results', () => {
    const patterns = [
      { patternName: 'clean-fn', implementationSnippet: 'const x = 1;' },
      { patternName: 'eval-fn', implementationSnippet: 'eval(userInput);' },
      { patternName: 'xss-fn', implementationSnippet: 'el.innerHTML = data;' },
    ];
    const results = scanPatterns(patterns);
    assert.equal(results.length, 3);
    assert.equal(results[0]!.patternName, 'clean-fn');
    assert.equal(results[0]!.recommendation, 'adopt');
    assert.equal(results[1]!.patternName, 'eval-fn');
    assert.equal(results[1]!.recommendation, 'reject');
    assert.equal(results[2]!.patternName, 'xss-fn');
    assert.equal(results[2]!.recommendation, 'review');
  });

  it('T8b: returns empty array when given empty input', () => {
    const results = scanPatterns([]);
    assert.deepEqual(results, []);
  });
});

// ── T9: formatScanReport ──────────────────────────────────────────────────────

describe('formatScanReport', () => {
  it('T9: includes pattern names and summary stats in output', () => {
    const results = scanPatterns([
      { patternName: 'clean-fn', implementationSnippet: 'const x = 1;' },
      { patternName: 'eval-fn', implementationSnippet: 'eval(userInput);' },
    ]);
    const report = formatScanReport(results);
    assert.ok(typeof report === 'string');
    assert.ok(report.includes('clean-fn'), 'Report should include "clean-fn"');
    assert.ok(report.includes('eval-fn'), 'Report should include "eval-fn"');
    assert.ok(report.includes('Pattern Security Scan Report'), 'Report should have heading');
    // Summary table header
    assert.ok(report.includes('Summary'), 'Report should contain Summary section');
    // Statistics section
    assert.ok(report.includes('Statistics'), 'Report should contain Statistics section');
  });

  it('T9b: handles empty results gracefully', () => {
    const report = formatScanReport([]);
    assert.ok(report.includes('No patterns scanned'));
  });

  it('T9c: statistics counts are correct', () => {
    const results = scanPatterns([
      { patternName: 'safe', implementationSnippet: 'const a = 1;' },
      { patternName: 'risky', implementationSnippet: 'eval(x);' },
    ]);
    const report = formatScanReport(results);
    // safe=1, rejected=1
    assert.ok(report.includes('Safe to adopt: **1**'), `Expected safe count 1 in: ${report}`);
    assert.ok(report.includes('Rejected: **1**'), `Expected rejected count 1 in: ${report}`);
  });

  it('T9d: concern detail section appears when there are concerns', () => {
    const results = scanPatterns([
      { patternName: 'eval-fn', implementationSnippet: 'eval(x);' },
    ]);
    const report = formatScanReport(results);
    assert.ok(report.includes('Concern Details'), 'Should include Concern Details section');
  });

  it('T9e: includes line numbers for concerns that have them', () => {
    const results = scanPatterns([
      { patternName: 'eval-fn', implementationSnippet: 'eval(x);' },
    ]);
    const report = formatScanReport(results);
    // Should contain "(line 1)"
    assert.ok(report.includes('line 1'), 'Should include line number reference');
  });
});
