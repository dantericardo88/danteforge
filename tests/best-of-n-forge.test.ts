import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectBestForgeCandidate, opsToChangedFiles, defaultForgeReward, forgeSelectionReward,
  type ParsedOp, type ForgeCandidate,
} from '../src/core/best-of-n-forge.js';

// Injected parser so tests need no code-writer: map a marker string to ops.
function parserFor(map: Record<string, ParsedOp[]>) {
  return (result: string): ParsedOp[] => map[result] ?? [];
}

describe('best-of-n-forge — Layer-1 candidate selection (no clobbering)', () => {
  test('selects the CLEAN candidate over a stub-bearing one', async () => {
    const map: Record<string, ParsedOp[]> = {
      A: [{ filePath: 'src/a.ts', replaceBlock: 'export const a = 1;' }],
      B: [{ filePath: 'src/b.ts', replaceBlock: 'export function f() { throw new Error("not implemented"); }' }],
    };
    const sel = await selectBestForgeCandidate(['A', 'B'], { parse: parserFor(map), log: () => {} });
    assert.equal(sel.chosen!.result, 'A', 'the clean candidate is chosen, the stub one rejected');
  });

  test('rejects a candidate that touches the trust surface', async () => {
    const map: Record<string, ParsedOp[]> = {
      GOOD: [{ filePath: 'src/x.ts', replaceBlock: 'export const x = 1;' }],
      EVIL: [{ filePath: '.danteforge/compete/matrix.json', replaceBlock: '{}' }],
    };
    const sel = await selectBestForgeCandidate(['EVIL', 'GOOD'], { parse: parserFor(map) });
    assert.equal(sel.chosen!.result, 'GOOD');
  });

  test('prefers the clean candidate with MORE real ops', async () => {
    const map: Record<string, ParsedOp[]> = {
      SMALL: [{ filePath: 'src/a.ts', replaceBlock: 'const a=1;' }],
      BIG: [
        { filePath: 'src/a.ts', replaceBlock: 'const a=1;' },
        { filePath: 'src/b.ts', replaceBlock: 'const b=2;' },
      ],
    };
    const sel = await selectBestForgeCandidate(['SMALL', 'BIG'], { parse: parserFor(map) });
    assert.equal(sel.chosen!.result, 'BIG');
  });

  test('falls back to least-bad when ALL candidates are dirty (forge still progresses)', async () => {
    const stub = 'export function f() { throw new Error("not implemented"); }';
    const map: Record<string, ParsedOp[]> = {
      ONEBAD: [{ filePath: 'src/a.ts', replaceBlock: stub }],
      TWOBAD: [{ filePath: 'src/a.ts', replaceBlock: stub }, { filePath: 'src/b.ts', replaceBlock: stub }],
    };
    const sel = await selectBestForgeCandidate(['ONEBAD', 'TWOBAD'], { parse: parserFor(map) });
    assert.ok(sel.chosen, 'still returns a candidate so the loop is not stuck');
  });

  test('returns null only when no candidate proposes any operation', async () => {
    const sel = await selectBestForgeCandidate(['', ''], { parse: () => [] });
    assert.equal(sel.chosen, null);
    assert.equal(sel.emptyCandidates, 2);
  });

  test('opsToChangedFiles normalizes path separators and pulls replaceBlock as content', () => {
    const files = opsToChangedFiles([{ filePath: 'src\\a.ts', replaceBlock: 'x' }]);
    assert.deepEqual(files, [{ path: 'src/a.ts', content: 'x' }]);
  });
});

describe('best-of-n-forge — scaffold reward signal (Ornith feedback)', () => {
  test('clean selection rewards by op count; dirty fallback is negative; empty is -1', () => {
    const clean = { chosen: { index: 0, result: 'A', files: [], opCount: 3 } as ForgeCandidate,
      ranked: [{ candidate: { index: 0, result: 'A', files: [], opCount: 3 } as ForgeCandidate, reward: 3, clean: true, findings: 0 }], emptyCandidates: 0 };
    assert.equal(forgeSelectionReward(clean), 3);

    const dirty = { chosen: { index: 0, result: 'A', files: [], opCount: 1 } as ForgeCandidate,
      ranked: [{ candidate: { index: 0, result: 'A', files: [], opCount: 1 } as ForgeCandidate, reward: -200, clean: false, findings: 2 }], emptyCandidates: 0 };
    assert.equal(forgeSelectionReward(dirty), -2);

    assert.equal(forgeSelectionReward({ chosen: null, ranked: [], emptyCandidates: 1 }), -1);
  });

  test('defaultForgeReward penalizes pre-filter findings hard', () => {
    const c = { index: 0, result: '', files: [], opCount: 2 } as ForgeCandidate;
    assert.equal(defaultForgeReward(c, { pass: true, findings: [] }), 2);
    assert.ok(defaultForgeReward(c, { pass: false, findings: [{ check: 'stub', path: 'p', detail: 'd' }] }) < 0);
  });
});
