import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkContextRot,
  truncateContext,
  CONTEXT_WARN_THRESHOLD,
  CONTEXT_CRITICAL_THRESHOLD,
  CONTEXT_TRUNCATE_TARGET,
} from '../src/harvested/gsd/hooks/context-rot.js';

describe('checkContextRot — pure function tests', () => {
  it('returns ok for small context (50K)', () => {
    const result = checkContextRot(50_000);
    assert.equal(result.level, 'ok');
    assert.equal(result.contextSize, 50_000);
    assert.equal(result.shouldTruncate, false);
    assert.equal(result.recommendation, 'Context size is healthy');
    assert.equal(result.truncateTarget, undefined);
  });

  it('returns warning when above warn threshold but below critical (150K)', () => {
    const result = checkContextRot(150_000);
    assert.equal(result.level, 'warning');
    assert.equal(result.contextSize, 150_000);
    assert.equal(result.shouldTruncate, false);
    assert.ok(result.recommendation.includes('wrapping up'));
    assert.equal(result.truncateTarget, undefined);
  });

  it('returns critical when above critical threshold (200K)', () => {
    const result = checkContextRot(200_000);
    assert.equal(result.level, 'critical');
    assert.equal(result.contextSize, 200_000);
    assert.equal(result.shouldTruncate, true);
    assert.equal(result.truncateTarget, CONTEXT_TRUNCATE_TARGET);
    assert.equal(result.truncateTarget, 100_000);
  });

  it('returns ok at exactly 120_000 (uses > not >=)', () => {
    const result = checkContextRot(CONTEXT_WARN_THRESHOLD);
    assert.equal(result.level, 'ok');
    assert.equal(result.contextSize, 120_000);
    assert.equal(result.shouldTruncate, false);
  });
});

describe('truncateContext — pure function tests', () => {
  it('returns content unchanged when shorter than target', () => {
    const short = 'Hello, world!';
    const result = truncateContext(short, 1000);
    assert.equal(result, short);
  });

  it('truncates long content to approximately the target length', () => {
    const long = 'A'.repeat(10_000);
    const target = 5_000;
    const result = truncateContext(long, target);
    const marker = '\n\n[...context truncated to preserve recent signal...]\n\n';
    // Result = 20% head (1000) + marker + 80% tail (4000)
    const expectedLength = target + marker.length;
    assert.equal(result.length, expectedLength);
  });

  it('includes the truncation marker in the output', () => {
    const long = 'X'.repeat(10_000);
    const result = truncateContext(long, 5_000);
    assert.ok(
      result.includes('[...context truncated to preserve recent signal...]'),
      'Truncated output must contain the marker text',
    );
  });

  it('preserves head from start and tail from end of original content', () => {
    // Build a string where head and tail are easily identifiable
    const head = 'HEAD_'.repeat(500);   // 2500 chars
    const middle = 'M'.repeat(10_000);
    const tail = '_TAIL'.repeat(500);    // 2500 chars
    const content = head + middle + tail; // 15000 chars
    const target = 5_000;

    const result = truncateContext(content, target);

    const keepStart = Math.floor(target * 0.2); // 1000
    const keepEnd = target - keepStart;          // 4000

    // Head portion should be the first keepStart chars of the original
    assert.ok(result.startsWith(content.slice(0, keepStart)));

    // Tail portion should be the last keepEnd chars of the original
    assert.ok(result.endsWith(content.slice(content.length - keepEnd)));
  });
});
