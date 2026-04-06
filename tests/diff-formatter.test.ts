import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff, formatDiffForTerminal, renderVerifyResult } from '../src/core/diff-formatter.js';

describe('diff-formatter', () => {
  it('parseDiff returns empty array for empty string', () => {
    assert.deepEqual(parseDiff(''), []);
  });

  it('classifies + lines as added', () => {
    const lines = parseDiff('+added line\n context');
    assert.equal(lines[0].type, 'added');
  });

  it('classifies - lines as removed', () => {
    const lines = parseDiff('-removed line');
    assert.equal(lines[0].type, 'removed');
  });

  it('classifies @@ lines as hunk-header', () => {
    const lines = parseDiff('@@ -1,3 +1,4 @@');
    assert.equal(lines[0].type, 'hunk-header');
  });

  it('classifies --- and +++ lines as file-header', () => {
    const lines = parseDiff('--- a/file.ts\n+++ b/file.ts');
    assert.equal(lines[0].type, 'file-header');
    assert.equal(lines[1].type, 'file-header');
  });

  it('formatDiffForTerminal applies color markers via _chalk seam', () => {
    const lines = parseDiff('+added\n-removed');
    const output = formatDiffForTerminal(lines, {
      _chalk: {
        green: (s) => `GREEN:${s}`,
        red: (s) => `RED:${s}`,
        cyan: (s) => s,
        gray: (s) => s,
        bold: (s) => s,
        yellow: (s) => s,
      },
    });
    assert.ok(output.includes('GREEN:+added'));
    assert.ok(output.includes('RED:-removed'));
  });

  it('renderVerifyResult produces correct symbol prefixes for each category', () => {
    const output = renderVerifyResult(
      ['test passes'],
      ['minor warning'],
      ['critical failure'],
    );
    assert.ok(output.includes('✓ test passes'));
    assert.ok(output.includes('⚠ minor warning'));
    assert.ok(output.includes('✗ critical failure'));
  });
});
