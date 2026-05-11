// Tests for DanteSanitize AST boundary selector (Sprint 2 — Hybrid v2)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSymbolGraph,
  runPageRank,
  selectSplitBoundaries,
  analyzeBoundariesAst,
} from '../src/core/sanitize-boundary.js';

// ── buildSymbolGraph ─────────────────────────────────────────────────────────

describe('buildSymbolGraph', () => {
  it('collects top-level interfaces, types, and enums', () => {
    const content = `
      export interface Foo { x: number; }
      export type Bar = string;
      export enum Baz { A, B }
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    assert.equal(graph.nodes.size, 3);
    assert.equal(graph.nodes.get('Foo')!.kind, 'interface');
    assert.equal(graph.nodes.get('Bar')!.kind, 'type');
    assert.equal(graph.nodes.get('Baz')!.kind, 'enum');
  });

  it('collects classes and functions', () => {
    const content = `
      export class MyClass {}
      export function helper() {}
      function privateHelper() {}
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    assert.equal(graph.nodes.get('MyClass')!.kind, 'class');
    assert.equal(graph.nodes.get('MyClass')!.exported, true);
    assert.equal(graph.nodes.get('helper')!.kind, 'function');
    assert.equal(graph.nodes.get('privateHelper')!.exported, false);
  });

  it('collects const/let/var declarations', () => {
    const content = `
      export const PI = 3.14;
      let counter = 0;
      var legacy = true;
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    assert.equal(graph.nodes.get('PI')!.kind, 'const');
    assert.equal(graph.nodes.get('counter')!.kind, 'let');
    assert.equal(graph.nodes.get('legacy')!.kind, 'var');
  });

  it('builds reference edges between top-level symbols', () => {
    const content = `
      interface Foo { x: number; }
      function useFoo(f: Foo): number { return f.x; }
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    const useFoo = graph.nodes.get('useFoo')!;
    assert.ok(useFoo.references.has('Foo'), 'useFoo should reference Foo');
  });

  it('does not self-reference', () => {
    const content = `function recurse(n: number): number { return n === 0 ? 0 : recurse(n - 1); }`;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    const recurse = graph.nodes.get('recurse')!;
    assert.ok(!recurse.references.has('recurse'), 'should not self-reference');
  });

  it('handles empty file gracefully', () => {
    const graph = buildSymbolGraph('', 'src/empty.ts');
    assert.equal(graph.nodes.size, 0);
  });
});

// ── runPageRank ──────────────────────────────────────────────────────────────

describe('runPageRank', () => {
  it('returns empty map for empty graph', () => {
    const graph = buildSymbolGraph('', 'src/empty.ts');
    const ranks = runPageRank(graph);
    assert.equal(ranks.size, 0);
  });

  it('assigns equal rank to isolated symbols', () => {
    const content = `
      export const A = 1;
      export const B = 2;
      export const C = 3;
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    const ranks = runPageRank(graph);
    const values = [...ranks.values()];
    assert.equal(values.length, 3);
    // All equal, sum to ~1
    const max = Math.max(...values);
    const min = Math.min(...values);
    assert.ok(max - min < 0.01, 'isolated nodes should rank equally');
  });

  it('ranks a hub higher than its references', () => {
    const content = `
      function helper1() {}
      function helper2() {}
      function helper3() {}
      function main() { helper1(); helper2(); helper3(); }
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    const ranks = runPageRank(graph);
    const mainRank = ranks.get('main')!;
    const helperRank = ranks.get('helper1')!;
    // helpers are referenced by main → higher inbound → higher rank
    assert.ok(helperRank > mainRank, `helper rank ${helperRank} should exceed main rank ${mainRank}`);
  });

  it('converges with default tolerance', () => {
    const content = `
      interface A {}
      interface B {}
      function f(a: A, b: B): A { return a; }
    `;
    const graph = buildSymbolGraph(content, 'src/test.ts');
    const ranks = runPageRank(graph, { iterations: 100, tolerance: 1e-6 });
    // sum of ranks should be close to 1.0 (PageRank invariant)
    const sum = [...ranks.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 0.1, `rank sum ${sum} should be ~1.0`);
  });
});

// ── selectSplitBoundaries ────────────────────────────────────────────────────

describe('selectSplitBoundaries', () => {
  it('extracts interfaces into -types.ts when 3+ exist', () => {
    const content = `
      export interface A { x: number; }
      export interface B { y: number; }
      export interface C { z: number; }
      export interface D { w: number; }
      export function main() { return 0; }
    `;
    const graph = buildSymbolGraph(content, 'src/foo.ts');
    const ranks = runPageRank(graph);
    const plan = selectSplitBoundaries(graph, ranks, { minLocPerFile: 1 });
    const typesFile = plan.newFiles.find(f => f.name === 'foo-types.ts');
    assert.ok(typesFile, 'should propose foo-types.ts');
    assert.equal(typesFile!.exports.length, 4);
  });

  it('returns valid:false when no extraction possible', () => {
    const content = `export function lonely() { return 1; }`;
    const graph = buildSymbolGraph(content, 'src/foo.ts');
    const ranks = runPageRank(graph);
    const plan = selectSplitBoundaries(graph, ranks);
    assert.equal(plan.valid, false, 'no extraction possible from a single function');
  });

  it('keeps top-ranked hubs in original', () => {
    const content = `
      interface A {}
      interface B {}
      interface C {}
      function helper() {}
      function utility() {}
      function pureUtil() {}
      function main() { helper(); utility(); pureUtil(); }
    `;
    const graph = buildSymbolGraph(content, 'src/foo.ts');
    const ranks = runPageRank(graph);
    const plan = selectSplitBoundaries(graph, ranks, { minLocPerFile: 1 });
    // 'helper', 'utility', 'pureUtil' all referenced by main → high rank → hubs
    // 'main' references them but has 0 inbound → low rank → NOT a hub
    // So retainInOriginal should contain some helper functions
    assert.ok(plan.retainInOriginal.length > 0, 'should retain at least one hub');
  });

  it('respects minSymbolsPerFile', () => {
    const content = `
      export interface A {}
      export interface B {}
      export function main() {}
    `;
    const graph = buildSymbolGraph(content, 'src/foo.ts');
    const ranks = runPageRank(graph);
    const plan = selectSplitBoundaries(graph, ranks, { minSymbolsPerFile: 3, minLocPerFile: 1 });
    // Only 2 interfaces — under minSymbolsPerFile=3
    const typesFile = plan.newFiles.find(f => f.name === 'foo-types.ts');
    assert.equal(typesFile, undefined, 'should not emit types file with < minSymbols');
  });
});

// ── analyzeBoundariesAst (one-shot) ──────────────────────────────────────────

describe('analyzeBoundariesAst', () => {
  it('returns a valid plan for a file with extractable types', () => {
    const content = `
      export interface A { x: number; }
      export interface B { y: number; }
      export interface C { z: number; }
      export interface D { w: number; }
      export class MainClass {
        method1() { return 1; }
        method2() { return 2; }
      }
    `;
    const plan = analyzeBoundariesAst(content, 'src/big.ts', { minLocPerFile: 1 });
    assert.equal(plan.valid, true);
    assert.ok(plan.newFiles.length >= 1);
  });

  it('returns valid:false for a small uncoupled file', () => {
    const content = `export function tiny() { return 42; }`;
    const plan = analyzeBoundariesAst(content, 'src/tiny.ts');
    assert.equal(plan.valid, false);
    assert.ok(plan.reason);
  });

  it('handles syntactically invalid input gracefully', () => {
    const content = `this is not valid typescript {{{{`;
    const plan = analyzeBoundariesAst(content, 'src/broken.ts');
    // Either valid:false or empty — both acceptable; just shouldn't throw
    assert.ok(plan.newFiles.length === 0 || plan.valid === true);
  });
});
