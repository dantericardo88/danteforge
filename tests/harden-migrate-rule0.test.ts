// harden-migrate-rule0.test.ts — Phase M.3 Rule 0 (SearchEngine-based callsite inference).
//
// Verifies the SearchEngine seam fires before Rules 1-4 and yields a `high`
// confidence callsite when findSymbol returns a unique exported declaration.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferCallsite } from '../src/matrix/engines/harden-migrate.js';
import type { SearchEngine, SymbolMatch } from '../src/matrix/search/types.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';

function makeFakeEngine(symbolMap: Record<string, SymbolMatch[]>): SearchEngine {
  return {
    index: async () => ({ engine: 'native' as const, repoRoot: '/x', gitSha: null, indexedMs: 0, fileCount: 0 }),
    findSymbol: async (name: string) => symbolMap[name] ?? [],
    findImports: async () => [],
    findPattern: async () => [],
    close: async () => {},
  };
}

function makeDim(overrides: Partial<MatrixDimension> & { id: string; capability_test?: { command?: string; no_capability_test?: boolean } }): MatrixDimension {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    weight: overrides.weight ?? 0.05,
    rubric: overrides.rubric ?? 'fake',
    target: overrides.target ?? 9,
    ...(overrides as object),
  } as MatrixDimension;
}

describe('harden-migrate Rule 0 (SearchEngine.findSymbol)', () => {
  it('uses SearchEngine when caller supplies one and a unique exported match exists', async () => {
    const engine = makeFakeEngine({
      runSecurityScan: [{
        file: 'src/core/security-scan.ts',
        line: 42,
        symbol: 'runSecurityScan',
        kind: 'function',
        exported: true,
      }],
    });
    const dim = makeDim({
      id: 'security',
      capability_test: { command: 'echo ignored' },
    });
    const result = await inferCallsite(dim, '/fake-cwd', {
      exists: async () => false,
      readFile: async () => '',
      searchEngine: engine,
    });
    assert.ok(result.inferred);
    assert.equal(result.inferred!.file, 'src/core/security-scan.ts');
    assert.equal(result.inferred!.symbol, 'runSecurityScan');
    assert.equal(result.confidence, 'high');
    assert.match(result.reason, /SearchEngine\.findSymbol/);
  });

  it('falls through to Rule 1-4 when SearchEngine returns no exported hits', async () => {
    const engine = makeFakeEngine({});
    const dim = makeDim({
      id: 'fictional',
      capability_test: { command: 'node dist/index.js src/cli/commands/foo.ts' },
    });
    const result = await inferCallsite(dim, '/fake-cwd', {
      exists: async (p: string) => p.replace(/\\/g, '/').endsWith('src/cli/commands/foo.ts'),
      readFile: async () => '',
      searchEngine: engine,
    });
    assert.ok(result.inferred);
    assert.match(result.reason, /command references/);
  });

  it('skips Rule 0 entirely when searchEngine is null', async () => {
    const dim = makeDim({
      id: 'security',
      capability_test: { command: 'node dist/index.js src/cli/commands/security.ts' },
    });
    const result = await inferCallsite(dim, '/fake-cwd', {
      exists: async (p: string) => p.replace(/\\/g, '/').endsWith('src/cli/commands/security.ts'),
      readFile: async () => '',
      searchEngine: null,
    });
    assert.ok(result.inferred);
    // Reason should NOT mention SearchEngine — Rule 0 was disabled.
    assert.doesNotMatch(result.reason, /SearchEngine/);
  });

  it('does not pick non-exported or non-src hits', async () => {
    const engine = makeFakeEngine({
      runSecurityScan: [{
        file: 'tests/scratch.ts',  // outside src/
        line: 1,
        symbol: 'runSecurityScan',
        kind: 'function',
        exported: true,
      }],
    });
    const dim = makeDim({
      id: 'security',
      capability_test: { command: 'something-without-paths' },
    });
    const result = await inferCallsite(dim, '/fake-cwd', {
      exists: async () => false,
      readFile: async () => '',
      searchEngine: engine,
    });
    // No src/ match → falls through, eventually fails to infer.
    assert.doesNotMatch(result.reason ?? '', /SearchEngine\.findSymbol/);
  });
});
