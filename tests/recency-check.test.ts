// recency-check.test.ts — Three Pillars Pillar 3 unit tests.
//
// Verifies the recency-check harden engine's behavior with injected SearchEngine
// + filesystem mocks. We do not hit git here — the timestamp comparison is
// driven by the importer list and the test fixture controls what "fresh" means.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkRecencyCheck } from '../src/matrix/engines/hardener.js';
import type { SearchEngine, ImportMatch } from '../src/matrix/search/types.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

function makeFakeEngine(imports: Record<string, ImportMatch[]>): SearchEngine {
  return {
    index: async () => ({ engine: 'native' as const, repoRoot: '/x', gitSha: null, indexedMs: 0, fileCount: 0 }),
    findSymbol: async () => [],
    findImports: async (symbol: string) => imports[symbol] ?? [],
    findPattern: async () => [],
    close: async () => {},
  };
}

function makeDim(overrides: Partial<MatrixDimension> & { id: string }): MatrixDimension {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    weight: overrides.weight ?? 0.05,
    rubric: overrides.rubric ?? 'fake',
    target: overrides.target ?? 9,
    scores: overrides.scores ?? { self: 0 },
    ...(overrides as object),
  } as MatrixDimension;
}

function makeIO(files: Record<string, string>) {
  return {
    readFile: async (p: string) => {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    exists: async (p: string) => p in files,
    listFiles: async () => [],
  };
}

describe('checkRecencyCheck (Three Pillars P3)', () => {
  it('passes (skipped) when dim has no capability_callsite', async () => {
    const dim = makeDim({ id: 'no_callsite' });
    const result = await checkRecencyCheck(dim, '/fake-cwd', makeIO({}), makeFakeEngine({}));
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
    assert.match(result.skipReason ?? '', /no capability_callsite/);
  });

  it('passes (skipped) when the dim has no production importers (orphan-audit territory)', async () => {
    const dim = makeDim({
      id: 'lonely',
      capability_callsite: { file: 'src/core/lonely.ts', symbol: 'doLonelyThing' },
    } as unknown as Partial<MatrixDimension> & { id: string });
    const result = await checkRecencyCheck(dim, '/fake-cwd', makeIO({}), makeFakeEngine({ doLonelyThing: [] }));
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
    assert.match(result.skipReason ?? '', /orphan-audit territory/);
  });

  it('passes (skipped) when audit_exempt is recency-by-design', async () => {
    const dim = makeDim({
      id: 'meta',
      capability_callsite: { file: 'src/core/meta.ts', symbol: 'metaSym' },
      audit_exempt: 'recency-by-design',
    } as unknown as Partial<MatrixDimension> & { id: string });
    const result = await checkRecencyCheck(dim, '/fake-cwd', makeIO({}), makeFakeEngine({}));
    assert.equal(result.passed, true);
    assert.equal(result.skipped, true);
    assert.match(result.skipReason ?? '', /audit_exempt/);
  });

  it('fails when no importer matches an entry-point pattern (no git history available)', async () => {
    const dim = makeDim({
      id: 'stale',
      capability_callsite: { file: 'src/core/stale.ts', symbol: 'staleSym' },
    } as unknown as Partial<MatrixDimension> & { id: string });
    const importers = {
      staleSym: [{
        file: 'src/internal/wrapper.ts',
        line: 1,
        importStatement: "import { staleSym } from '../core/stale.js';",
        moduleSpecifier: '../core/stale.js',
      }],
    };
    // The fake importer doesn't match any entry-point pattern, AND git log fails
    // on /fake-cwd, so the loop never finds a fresh+traceable file.
    const result = await checkRecencyCheck(dim, '/fake-cwd', makeIO({}), makeFakeEngine(importers));
    assert.equal(result.passed, false);
    assert.equal(result.scoreCap, 7.0);
    assert.match(result.findings[0]!.reason, /recency:/);
  });

  it('returns cap 7.0 when failed (regression check on the constant)', async () => {
    const dim = makeDim({
      id: 'whatever',
      capability_callsite: { file: 'src/x.ts', symbol: 'whateverSym' },
    } as unknown as Partial<MatrixDimension> & { id: string });
    const result = await checkRecencyCheck(dim, '/fake-cwd', makeIO({}), makeFakeEngine({ whateverSym: [{ file: 'src/zzz/whatever.ts', line: 1, importStatement: '', moduleSpecifier: '' }] }));
    assert.equal(result.scoreCap, 7.0);
  });
});
