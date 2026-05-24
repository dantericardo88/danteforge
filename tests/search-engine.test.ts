// search-engine.test.ts — interface compliance for the Phase L search engines.
//
// Both implementations (RipgrepFallback + MinimalNativeEngine) must satisfy
// the SearchEngine contract and produce equivalent findings on a fixture
// codebase. Where they diverge legitimately (e.g. native is faster because
// it has a symbol index), that's expected; result correctness must match.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { RipgrepFallback } from '../src/matrix/search/ripgrep-fallback.js';
import { MinimalNativeEngine } from '../src/matrix/search/minimal-native-engine.js';
import { createSearchEngine } from '../src/matrix/search/factory.js';

// ── Fixture ──────────────────────────────────────────────────────────────────

let fixtureDir = '';
const origCwd = process.cwd();

before(async () => {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'search-engine-fixture-'));
  const srcDir = path.join(fixtureDir, 'src');
  const testsDir = path.join(fixtureDir, 'tests');
  await fs.mkdir(srcDir, { recursive: true });
  await fs.mkdir(testsDir, { recursive: true });

  // Two production files: foo.ts exports widgetMaker, bar.ts imports it.
  await fs.writeFile(path.join(srcDir, 'foo.ts'),
    `// Production file exporting widgetMaker\n` +
    `export function widgetMaker(): string {\n` +
    `  return 'widget';\n` +
    `}\n` +
    `\n` +
    `export const orphanedSymbol = 'never imported anywhere';\n`,
  );
  await fs.writeFile(path.join(srcDir, 'bar.ts'),
    `// Production file importing widgetMaker\n` +
    `import { widgetMaker } from './foo.js';\n` +
    `\n` +
    `export function caller(): string {\n` +
    `  return widgetMaker();\n` +
    `}\n`,
  );
  // Test file imports widgetMaker too — but findImports excludes tests by default.
  await fs.writeFile(path.join(testsDir, 'foo.test.ts'),
    `import { widgetMaker } from '../src/foo.js';\n` +
    `// TODO: verify\n` +
    `if (widgetMaker() === 'widget') { /* ok */ }\n`,
  );

  // Switch cwd so RipgrepFallback's process.cwd() picks up the fixture.
  process.chdir(fixtureDir);
});

after(async () => {
  process.chdir(origCwd);
  await fs.rm(fixtureDir, { recursive: true, force: true });
});

// ── RipgrepFallback ──────────────────────────────────────────────────────────

describe('RipgrepFallback', () => {
  it('findSymbol finds declaration of widgetMaker in foo.ts', async () => {
    const engine = new RipgrepFallback();
    await engine.index(fixtureDir);
    const matches = await engine.findSymbol('widgetMaker');
    assert.ok(matches.length >= 1, 'should find at least 1 declaration');
    assert.ok(matches.some(m => m.file.endsWith('foo.ts')), 'foo.ts should appear');
  });

  it('findImports finds bar.ts importing widgetMaker (excludes test files)', async () => {
    const engine = new RipgrepFallback();
    await engine.index(fixtureDir);
    const matches = await engine.findImports('widgetMaker');
    assert.ok(matches.length >= 1, 'should find at least 1 import');
    assert.ok(matches.some(m => m.file.endsWith('bar.ts')), 'bar.ts should appear');
    assert.ok(!matches.some(m => m.file.includes('test')), 'test files should be excluded by default');
  });

  it('findImports honors includeTests=true', async () => {
    const engine = new RipgrepFallback();
    await engine.index(fixtureDir);
    const matches = await engine.findImports('widgetMaker', { includeTests: true });
    assert.ok(matches.some(m => m.file.includes('test')), 'test files should appear with includeTests=true');
  });

  it('findPattern matches "TODO" across files', async () => {
    const engine = new RipgrepFallback();
    await engine.index(fixtureDir);
    const matches = await engine.findPattern('TODO', { includeTests: true });
    assert.ok(matches.length >= 1);
    assert.ok(matches.some(m => m.text.includes('TODO')));
  });

  it('findImports returns empty for a never-imported symbol', async () => {
    const engine = new RipgrepFallback();
    await engine.index(fixtureDir);
    const matches = await engine.findImports('orphanedSymbol');
    assert.equal(matches.length, 0);
  });
});

// ── MinimalNativeEngine ──────────────────────────────────────────────────────

describe('MinimalNativeEngine', () => {
  it('index returns an IndexHandle with file count > 0', async () => {
    const engine = new MinimalNativeEngine();
    const handle = await engine.index(fixtureDir);
    assert.equal(handle.engine, 'native');
    assert.ok(handle.fileCount >= 2, `expected >= 2 TS files indexed, got ${handle.fileCount}`);
  });

  it('findSymbol finds widgetMaker via the symbol index', async () => {
    const engine = new MinimalNativeEngine();
    await engine.index(fixtureDir);
    const matches = await engine.findSymbol('widgetMaker');
    assert.ok(matches.length >= 1);
    assert.ok(matches.some(m => m.file.endsWith('foo.ts')));
    assert.equal(matches[0]!.kind, 'function');
    assert.equal(matches[0]!.exported, true);
  });

  it('findSymbol returns empty for an undeclared name', async () => {
    const engine = new MinimalNativeEngine();
    await engine.index(fixtureDir);
    const matches = await engine.findSymbol('nonexistentSymbol');
    assert.equal(matches.length, 0);
  });

  it('findSymbol excludes test files by default', async () => {
    const engine = new MinimalNativeEngine();
    await engine.index(fixtureDir);
    const matches = await engine.findSymbol('widgetMaker');
    assert.ok(!matches.some(m => m.file.includes('test')));
  });

  it('findImports delegates to ripgrep and returns import matches', async () => {
    const engine = new MinimalNativeEngine();
    await engine.index(fixtureDir);
    const matches = await engine.findImports('widgetMaker');
    assert.ok(matches.length >= 1);
    assert.ok(matches.some(m => m.file.endsWith('bar.ts')));
  });
});

// ── Factory ──────────────────────────────────────────────────────────────────

describe('createSearchEngine factory', () => {
  it('returns a SearchEngine instance with all required methods', async () => {
    const engine = createSearchEngine();
    assert.ok(typeof engine.index === 'function');
    assert.ok(typeof engine.findSymbol === 'function');
    assert.ok(typeof engine.findImports === 'function');
    assert.ok(typeof engine.findPattern === 'function');
    assert.ok(typeof engine.close === 'function');
  });

  it('forceRipgrep returns a RipgrepFallback', async () => {
    const engine = createSearchEngine({ forceRipgrep: true });
    assert.ok(engine instanceof RipgrepFallback);
  });

  it('preference=native returns a MinimalNativeEngine', async () => {
    const engine = createSearchEngine({ preference: 'native' });
    assert.ok(engine instanceof MinimalNativeEngine);
  });

  it('default preference (auto) returns the native engine', async () => {
    const engine = createSearchEngine();
    assert.ok(engine instanceof MinimalNativeEngine);
  });
});
