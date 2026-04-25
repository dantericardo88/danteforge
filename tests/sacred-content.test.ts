// Tests for sacred-content detector (PRD-26 / Article XIV)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectSacredSpans,
  containsSacredContent,
  injectSacredSpans,
} from '../src/core/context-economy/sacred-content.js';

// ── containsSacredContent ────────────────────────────────────────────────────

describe('containsSacredContent', () => {
  it('detects "error:" lines', () => {
    assert.ok(containsSacredContent('src/foo.ts:10: error: Type X is not assignable'));
  });

  it('detects "FAILED" test lines', () => {
    assert.ok(containsSacredContent('FAILED test_login -- AssertionError'));
  });

  it('detects stack frames', () => {
    assert.ok(containsSacredContent('  at Object.<anonymous> (src/foo.ts:10:5)'));
  });

  it('detects merge conflict markers', () => {
    assert.ok(containsSacredContent('<<<<<<< HEAD'));
    assert.ok(containsSacredContent('======='));
    assert.ok(containsSacredContent('>>>>>>> feature-branch'));
  });

  it('detects panic output', () => {
    assert.ok(containsSacredContent('panic: runtime error: index out of range'));
  });

  it('detects security findings', () => {
    assert.ok(containsSacredContent('SECURITY: SQL injection vulnerability found'));
    assert.ok(containsSacredContent('CVE-2024-1234 detected in dependency'));
  });

  it('returns false for clean output', () => {
    assert.ok(!containsSacredContent('Build successful\n3 packages added'));
  });

  it('returns false for empty string', () => {
    assert.ok(!containsSacredContent(''));
  });

  it('detects warning lines', () => {
    assert.ok(containsSacredContent('warning: unused variable'));
  });

  it('detects assertion errors', () => {
    assert.ok(containsSacredContent('AssertionError: expected 1 to equal 2'));
  });
});

// ── detectSacredSpans ────────────────────────────────────────────────────────

describe('detectSacredSpans', () => {
  it('returns empty array for clean output', () => {
    const spans = detectSacredSpans('Build successful\nAll tests passed');
    assert.equal(spans.length, 0);
  });

  it('extracts a single error block', () => {
    const output = 'Compiling...\nerror: Type X is not assignable\n  at foo.ts:10\nDone';
    const spans = detectSacredSpans(output);
    assert.ok(spans.length >= 1);
    assert.ok(spans[0].includes('error'));
  });

  it('includes indented continuation lines in the block', () => {
    const output = 'error: unexpected token\n  expected one of: +, -, *\n  found: ???\nNext line';
    const spans = detectSacredSpans(output);
    assert.ok(spans.length >= 1);
    assert.ok(spans[0].includes('expected one of'));
  });

  it('extracts Python traceback block', () => {
    const output = [
      'Collecting results...',
      'Traceback (most recent call last):',
      '  File "test.py", line 5, in <module>',
      '    raise ValueError("bad input")',
      'ValueError: bad input',
      'Done',
    ].join('\n');
    const spans = detectSacredSpans(output);
    assert.ok(spans.length >= 1);
    assert.ok(spans[0].includes('Traceback'));
  });

  it('handles multiple disjoint error blocks', () => {
    const output = [
      'Test 1: FAILED',
      '  AssertionError: 1 !== 2',
      'Test 2: ok',
      'Test 3: FAILED',
      '  AssertionError: null !== object',
    ].join('\n');
    const spans = detectSacredSpans(output);
    assert.ok(spans.length >= 2);
  });
});

// ── injectSacredSpans ────────────────────────────────────────────────────────

describe('injectSacredSpans', () => {
  it('returns compressed string unchanged when no sacred spans', () => {
    const result = injectSacredSpans('compressed output', []);
    assert.equal(result, 'compressed output');
  });

  it('appends sacred spans with delimiter when spans present', () => {
    const result = injectSacredSpans('compressed', ['error: foo', 'panic: bar']);
    assert.ok(result.includes('compressed'));
    assert.ok(result.includes('sacred content'));
    assert.ok(result.includes('error: foo'));
    assert.ok(result.includes('panic: bar'));
  });

  it('preserves order: compressed text first, sacred block after', () => {
    const result = injectSacredSpans('summary line', ['error: X']);
    const idx1 = result.indexOf('summary line');
    const idx2 = result.indexOf('error: X');
    assert.ok(idx1 < idx2);
  });
});
