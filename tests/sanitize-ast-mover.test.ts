// Tests for DanteSanitize AST mover (Sprint 3 — Tier 1)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moveSymbolsViaAst } from '../src/core/sanitize-ast-mover.js';

describe('moveSymbolsViaAst', () => {
  it('moves a single interface to a new file', () => {
    const content = `
export interface Foo { x: number; }
export function main() { return 1; }
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Foo'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes('export interface Foo'), 'new file should contain Foo');
    assert.ok(!result.rewrittenOriginal!.includes('export interface Foo'), 'original should not contain Foo');
    assert.ok(result.rewrittenOriginal!.includes('import'), 'original should have new import');
    assert.ok(result.rewrittenOriginal!.includes('./test-types.js'), 'import should reference new file');
  });

  it('moves multiple interfaces in one call', () => {
    const content = `
export interface A { x: number; }
export interface B { y: number; }
export interface C { z: number; }
export function main() { return 1; }
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['A', 'B', 'C'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    for (const sym of ['A', 'B', 'C']) {
      assert.ok(result.newFileContent!.includes(`interface ${sym}`), `new file should contain ${sym}`);
      assert.ok(!result.rewrittenOriginal!.includes(`interface ${sym}`), `original should not contain ${sym}`);
    }
    assert.ok(result.rewrittenOriginal!.includes('A, B, C'), 'import should list all three');
  });

  it('moves a type alias', () => {
    const content = `export type Bar = string | number;\nexport function main() {}`;
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Bar'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes('type Bar'));
  });

  it('moves an enum', () => {
    const content = `export enum Status { A = 1, B = 2 }\nexport function main() {}`;
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Status'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes('enum Status'));
  });

  it('moves a function with single declaration', () => {
    const content = `
export function add(a: number, b: number): number { return a + b; }
export class MainClass {}
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['add'],
      newFileName: 'test-utils.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes('function add'));
  });

  it('preserves JSDoc comments when moving', () => {
    const content = `
/**
 * Calculates something important.
 */
export function calculate(): number { return 42; }
export class Main {}
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['calculate'],
      newFileName: 'test-utils.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes('Calculates something important'), 'JSDoc should move with symbol');
    assert.ok(!result.rewrittenOriginal!.includes('Calculates something important'), 'JSDoc should not remain');
  });

  it('returns success:false when symbol not found', () => {
    const content = `export function known() {}`;
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['nonexistent'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, false);
    assert.ok(result.reason);
  });

  it('refuses to move a class with decorators', () => {
    const content = `
function Decorator(): ClassDecorator { return () => {}; }
@Decorator()
export class Decorated {}
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Decorated'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, false);
    assert.ok(result.reason?.includes('unsupported'));
  });

  it('refuses multi-declaration variable statements', () => {
    const content = `export const A = 1, B = 2;\nexport function main() {}`;
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['A'],
      newFileName: 'test-config.ts',
    });
    assert.equal(result.success, false);
  });

  it('adds import after existing imports', () => {
    const content = `
import { existing } from './other.js';

export interface Foo { x: number; }
export function main() { existing(); }
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Foo'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    const lines = result.rewrittenOriginal!.split('\n');
    const existingImportIdx = lines.findIndex(l => l.includes("from './other.js'"));
    const newImportIdx = lines.findIndex(l => l.includes("from './test-types.js'"));
    assert.ok(newImportIdx > existingImportIdx, 'new import should come after existing imports');
  });

  it('includes relevant imports in the new file', () => {
    const content = `
import { Helper } from './helper.js';
import { Unused } from './unused.js';

export interface Foo extends Helper { x: number; }
export function main() { return 1; }
`.trimStart();
    const result = moveSymbolsViaAst({
      content,
      filePath: 'src/test.ts',
      symbols: ['Foo'],
      newFileName: 'test-types.ts',
    });
    assert.equal(result.success, true);
    assert.ok(result.newFileContent!.includes("from './helper.js'"), 'should include Helper import');
    assert.ok(!result.newFileContent!.includes("from './unused.js'"), 'should NOT include unused import');
  });
});
