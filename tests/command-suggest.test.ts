// command-suggest.test.ts — Node built-in test runner
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  levenshteinDistance,
  findClosestCommand,
  formatCommandSuggestion,
} from '../src/core/command-suggest.js';

// ---------------------------------------------------------------------------
// levenshteinDistance
// ---------------------------------------------------------------------------

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    assert.equal(levenshteinDistance('forge', 'forge'), 0);
  });

  it('returns full length when one string is empty', () => {
    assert.equal(levenshteinDistance('', 'forge'), 5);
    assert.equal(levenshteinDistance('forge', ''), 5);
  });

  it('returns 1 for a single character insertion', () => {
    assert.equal(levenshteinDistance('forge', 'forges'), 1);
  });

  it('returns 1 for a single character deletion', () => {
    assert.equal(levenshteinDistance('forges', 'forge'), 1);
  });

  it('returns 1 for a single character substitution', () => {
    assert.equal(levenshteinDistance('forge', 'gorge'), 1);
  });

  it('is symmetric', () => {
    assert.equal(
      levenshteinDistance('abc', 'xyz'),
      levenshteinDistance('xyz', 'abc'),
    );
  });

  it('handles completely different strings', () => {
    const d = levenshteinDistance('forge', 'xyzzy');
    assert.ok(d > 0, 'distance should be positive for dissimilar strings');
  });

  it('handles single-character strings', () => {
    assert.equal(levenshteinDistance('a', 'b'), 1);
    assert.equal(levenshteinDistance('a', 'a'), 0);
  });
});

// ---------------------------------------------------------------------------
// findClosestCommand
// ---------------------------------------------------------------------------

describe('findClosestCommand', () => {
  const COMMANDS = ['forge', 'verify', 'plan', 'specify', 'score', 'compete', 'ascend', 'init', 'retro', 'lessons'];

  it('returns null for an exact match (no suggestion needed)', () => {
    assert.equal(findClosestCommand('forge', COMMANDS), null);
    assert.equal(findClosestCommand('verify', COMMANDS), null);
  });

  it('finds a close match for a one-character typo', () => {
    const result = findClosestCommand('foreg', COMMANDS);
    assert.equal(result, 'forge');
  });

  it('finds a close match for a missing letter', () => {
    const result = findClosestCommand('veryfy', COMMANDS);
    assert.equal(result, 'verify');
  });

  it('finds a close match for a transposition', () => {
    // "pla" is 2 chars, distance to "plan" is 1, ratio 1/4 = 0.25 ≤ 0.4
    const result = findClosestCommand('pla', COMMANDS);
    assert.equal(result, 'plan');
  });

  it('returns null for a completely different input', () => {
    // "xyzzy" is far from all known commands
    const result = findClosestCommand('xyzzy', COMMANDS);
    assert.equal(result, null);
  });

  it('returns null when the command list is empty', () => {
    assert.equal(findClosestCommand('forge', []), null);
  });

  it('is case-insensitive in comparison', () => {
    // "FORGE" should still find 'forge'
    const result = findClosestCommand('FORGE', COMMANDS);
    // exact case-insensitive match → null
    assert.equal(result, null);
  });

  it('returns null when distance ratio > 0.4 (not helpful enough)', () => {
    // "zzzzzzz" (7 chars) vs any short command
    const result = findClosestCommand('zzzzzzz', COMMANDS);
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// formatCommandSuggestion
// ---------------------------------------------------------------------------

describe('formatCommandSuggestion', () => {
  it('uses the expected message format', () => {
    const msg = formatCommandSuggestion('foreg', 'forge');
    assert.equal(msg, 'Unknown command "foreg". Did you mean "forge"?');
  });

  it('includes both the input and the suggestion', () => {
    const msg = formatCommandSuggestion('veryfy', 'verify');
    assert.ok(msg.includes('veryfy'), 'should include the user input');
    assert.ok(msg.includes('verify'), 'should include the suggested command');
  });

  it('ends with a question mark', () => {
    const msg = formatCommandSuggestion('scor', 'score');
    assert.ok(msg.endsWith('?'), 'message should end with ?');
  });

  it('wraps both terms in double quotes', () => {
    const msg = formatCommandSuggestion('foo', 'forge');
    const quoteCount = (msg.match(/"/g) ?? []).length;
    assert.equal(quoteCount, 4, 'should have 4 double-quote characters');
  });
});
