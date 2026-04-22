import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeAnalyzeColors,
  executeAnalyzeTypography,
  executeAnalyzeSpacing,
  executeAnalyzeClusters,
  executeDiffCreate,
  executeDiffShow,
} from '../src/harvested/openpencil/executors/analysis-executors.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
import type { OPDocument, OPNode } from '../src/harvested/openpencil/op-codec.js';

function makeNode(id: string, overrides: Partial<OPNode> = {}): OPNode {
  return { id, type: 'rectangle', name: `Node ${id}`, ...overrides };
}

function makeDoc(nodes: OPNode[] = []): OPDocument {
  return {
    formatVersion: '1.0',
    generator: 'test',
    created: '2026-01-01T00:00:00.000Z',
    document: { name: 'Test Doc', pages: [{ id: 'page-1', type: 'page', name: 'Page 1' }] },
    nodes,
  };
}

describe('executeAnalyzeColors', () => {
  it('returns zero colors for empty doc', () => {
    const ctx = createContext(makeDoc());
    const result = executeAnalyzeColors({}, ctx) as any;
    assert.equal(result.totalUniqueColors, 0);
    assert.deepEqual(result.colors, []);
  });

  it('counts fill colors', () => {
    const node = makeNode('n1', { fills: [{ type: 'solid', color: '#FF0000', opacity: 1 }] });
    const ctx = createContext(makeDoc([node]));
    const result = executeAnalyzeColors({}, ctx) as any;
    assert.equal(result.totalUniqueColors, 1);
    assert.equal(result.colors[0].color, '#FF0000');
    assert.equal(result.colors[0].usageCount, 1);
  });

  it('counts stroke colors separately', () => {
    const node = makeNode('n1', { strokes: [{ type: 'solid', color: '#0000FF', weight: 1 }] });
    const ctx = createContext(makeDoc([node]));
    const result = executeAnalyzeColors({}, ctx) as any;
    assert.equal(result.totalUniqueColors, 1);
    assert.ok(result.colors[0].nodeNames[0].includes('stroke'));
  });

  it('deduplicates same color across multiple nodes', () => {
    const n1 = makeNode('n1', { fills: [{ type: 'solid', color: '#ff0000', opacity: 1 }] });
    const n2 = makeNode('n2', { fills: [{ type: 'solid', color: '#FF0000', opacity: 1 }] });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeAnalyzeColors({}, ctx) as any;
    assert.equal(result.totalUniqueColors, 1);
    assert.equal(result.colors[0].usageCount, 2);
  });

  it('gives recommendation when palette > 12 colors', () => {
    const nodes = Array.from({ length: 13 }, (_, i) =>
      makeNode(`n${i}`, { fills: [{ type: 'solid', color: `#${String(i).padStart(6, '0')}`, opacity: 1 }] })
    );
    const ctx = createContext(makeDoc(nodes));
    const result = executeAnalyzeColors({}, ctx) as any;
    assert.ok(result.recommendation.includes('consolidating'));
  });
});

describe('executeAnalyzeTypography', () => {
  it('returns zero for doc with no text nodes', () => {
    const ctx = createContext(makeDoc());
    const result = executeAnalyzeTypography({}, ctx) as any;
    assert.equal(result.totalTextNodes, 0);
    assert.equal(result.uniqueFontFamilies, 0);
  });

  it('groups by font family', () => {
    const t1 = makeNode('t1', { type: 'text', fontFamily: 'Inter', fontSize: 16 });
    const t2 = makeNode('t2', { type: 'text', fontFamily: 'Inter', fontSize: 24 });
    const ctx = createContext(makeDoc([t1, t2]));
    const result = executeAnalyzeTypography({}, ctx) as any;
    assert.equal(result.totalTextNodes, 2);
    assert.equal(result.uniqueFontFamilies, 1);
    assert.equal(result.fonts[0].family, 'Inter');
    assert.equal(result.fonts[0].usageCount, 2);
    assert.deepEqual(result.fonts[0].sizes, [16, 24]);
  });

  it('warns when more than 3 font families', () => {
    const nodes = ['A', 'B', 'C', 'D'].map((f, i) =>
      makeNode(`t${i}`, { type: 'text', fontFamily: f })
    );
    const ctx = createContext(makeDoc(nodes));
    const result = executeAnalyzeTypography({}, ctx) as any;
    assert.ok(result.recommendation.includes('3 font families'));
  });
});

describe('executeAnalyzeSpacing', () => {
  it('returns empty spacing for doc with no spaced nodes', () => {
    const ctx = createContext(makeDoc());
    const result = executeAnalyzeSpacing({}, ctx) as any;
    assert.equal(result.uniqueSpacingValues, 0);
    assert.deepEqual(result.gridViolations, []);
  });

  it('detects grid violations for non-4px-aligned padding', () => {
    const node = makeNode('n1', { padding: { top: 5, right: 5, bottom: 5, left: 5 } });
    const ctx = createContext(makeDoc([node]));
    const result = executeAnalyzeSpacing({}, ctx) as any;
    assert.ok(result.gridViolations.length > 0);
    assert.ok(result.recommendation.includes('violate'));
  });

  it('no violations for 4px-aligned spacing', () => {
    const node = makeNode('n1', { layoutGap: 8 });
    const ctx = createContext(makeDoc([node]));
    const result = executeAnalyzeSpacing({}, ctx) as any;
    assert.equal(result.gridViolations.length, 0);
    assert.ok(result.recommendation.includes('align to'));
  });
});

describe('executeAnalyzeClusters', () => {
  it('returns note when fewer than 2 nodes', () => {
    const ctx = createContext(makeDoc());
    const result = executeAnalyzeClusters({}, ctx) as any;
    assert.ok(result.note.includes('Not enough nodes'));
  });

  it('returns cluster info for proximate nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 10, height: 10 });
    const n2 = makeNode('n2', { x: 5, y: 5, width: 10, height: 10 });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeAnalyzeClusters({}, ctx) as any;
    assert.ok(typeof result.totalClusters === 'number');
  });
});

describe('executeDiffCreate', () => {
  it('returns error for invalid JSON', () => {
    const ctx = createContext(makeDoc());
    const result = executeDiffCreate({ beforeSnapshot: 'not-json', afterSnapshot: 'also-not-json' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns diff summary for valid snapshots', () => {
    const doc = makeDoc();
    const json = JSON.stringify(doc);
    const ctx = createContext(doc);
    const result = executeDiffCreate({ beforeSnapshot: json, afterSnapshot: json }, ctx) as any;
    assert.ok('diffId' in result);
    assert.ok('summary' in result);
    assert.equal(result.summary.addedNodes, 0);
    assert.equal(result.summary.removedNodes, 0);
  });
});

describe('executeDiffShow', () => {
  it('returns diffId and current doc name', () => {
    const ctx = createContext(makeDoc());
    const result = executeDiffShow({ diffId: 'diff-123' }, ctx) as any;
    assert.equal(result.diffId, 'diff-123');
    assert.equal(result.currentDocumentName, 'Test Doc');
  });
});
