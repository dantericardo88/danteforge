// Tests for src/matrix/util/glob.ts — the shared glob matcher used by every
// Matrix Kernel engine and court.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegex, matchesGlob, matchesAnyGlob } from '../../src/matrix/util/glob.js';

describe('globToRegex', () => {
  it('anchors the pattern with ^ and $', () => {
    const re = globToRegex('src/foo.ts');
    assert.equal(re.test('src/foo.ts'), true);
    assert.equal(re.test('aaa/src/foo.ts'), false);
    assert.equal(re.test('src/foo.ts/bbb'), false);
  });

  it('escapes regex metacharacters in literal segments', () => {
    const re = globToRegex('src/foo.ts');
    // The literal . should not match arbitrary chars
    assert.equal(re.test('src/foo.ts'), true);
    assert.equal(re.test('src/fooxts'), false);
  });

  it('single * matches non-separator characters', () => {
    const re = globToRegex('src/*.ts');
    assert.equal(re.test('src/foo.ts'), true);
    assert.equal(re.test('src/bar.ts'), true);
    // Should NOT match across path separators
    assert.equal(re.test('src/sub/foo.ts'), false);
  });

  it('middle /**/ matches one or more intermediate segments', () => {
    // Behavior of the current impl: /**/ requires at least one intermediate
    // segment. Standard-glob "match zero or more" is intentionally NOT supported
    // here — every caller uses trailing ** patterns instead.
    const re = globToRegex('src/**/foo.ts');
    assert.equal(re.test('src/sub/foo.ts'), true);
    assert.equal(re.test('src/deep/sub/foo.ts'), true);
    assert.equal(re.test('lib/foo.ts'), false);
  });

  it('trailing ** matches everything in a subtree', () => {
    const re = globToRegex('src/**');
    assert.equal(re.test('src/a.ts'), true);
    assert.equal(re.test('src/sub/a.ts'), true);
    assert.equal(re.test('src/deep/sub/dir/file.ts'), true);
  });

  it('normalizes Windows backslashes to forward slashes', () => {
    const re = globToRegex('src\\foo.ts');
    assert.equal(re.test('src/foo.ts'), true);
  });
});

describe('matchesGlob', () => {
  it('returns true for exact-string match', () => {
    assert.equal(matchesGlob('src/foo.ts', 'src/foo.ts'), true);
  });

  it('returns false for non-matching path', () => {
    assert.equal(matchesGlob('src/foo.ts', 'src/bar.ts'), false);
  });

  it('handles Windows-style paths in the input', () => {
    assert.equal(matchesGlob('src\\foo.ts', 'src/foo.ts'), true);
    assert.equal(matchesGlob('src\\foo.ts', 'src/**'), true);
  });

  it('respects single-* path-segment boundary', () => {
    assert.equal(matchesGlob('src/foo.ts', 'src/*'), true);
    assert.equal(matchesGlob('src/sub/foo.ts', 'src/*'), false);
  });

  it('respects double-** for recursive match', () => {
    assert.equal(matchesGlob('src/sub/foo.ts', 'src/**'), true);
    assert.equal(matchesGlob('src/foo.ts', 'src/**'), true);
  });
});

describe('matchesAnyGlob', () => {
  it('returns false for empty glob list', () => {
    assert.equal(matchesAnyGlob('src/foo.ts', []), false);
  });

  it('returns true if any glob matches', () => {
    assert.equal(matchesAnyGlob('src/foo.ts', ['src/bar.ts', 'src/*.ts']), true);
  });

  it('returns false if no glob matches', () => {
    assert.equal(matchesAnyGlob('src/foo.ts', ['lib/**', 'tests/**']), false);
  });

  it('short-circuits on first match (semantic)', () => {
    // Behavioral assertion only — first matching glob wins
    assert.equal(matchesAnyGlob('src/foo.ts', ['src/**', 'src/foo.ts']), true);
  });

  it('handles mixed Windows + POSIX paths in both filePath and globs', () => {
    assert.equal(matchesAnyGlob('src\\matrix\\engines\\foo.ts', ['src/matrix/**']), true);
  });
});
