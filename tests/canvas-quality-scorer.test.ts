import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCanvasQuality, type CanvasQualityResult } from '../src/core/canvas-quality-scorer.js';
import type { OPDocument, OPNode } from '../src/harvested/openpencil/op-codec.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeDoc(nodes: OPNode[], extra: Partial<OPDocument> = {}): OPDocument {
  return {
    formatVersion: '1.0.0',
    generator: 'test',
    created: new Date().toISOString(),
    document: { name: 'Test', pages: [] },
    nodes,
    ...extra,
  };
}

function makeFrame(overrides: Partial<OPNode> = {}): OPNode {
  return { id: `f-${Math.random()}`, type: 'frame', name: 'Frame', width: 1440, height: 900, ...overrides };
}

function makeText(text: string, overrides: Partial<OPNode> = {}): OPNode {
  return { id: `t-${Math.random()}`, type: 'text', name: 'Text', characters: text, fontSize: 16, fontFamily: 'Syne', ...overrides };
}

function makeRect(overrides: Partial<OPNode> = {}): OPNode {
  return { id: `r-${Math.random()}`, type: 'rectangle', name: 'Rect', width: 100, height: 100, ...overrides };
}

// A well-crafted design: distinctive colors, two fonts, responsive layout, tokens
const GOOD_DOC: OPDocument = makeDoc(
  [makeFrame({
    layoutMode: 'vertical', layoutGap: 24, padding: { top: 32, right: 32, bottom: 32, left: 32 },
    fills: [{ type: 'solid', color: '#1A0B3B' }],
    constraints: { horizontal: 'stretch', vertical: 'min' },
    children: [
      makeText('Dashboard', { fontSize: 36, fontFamily: 'Playfair Display', fontWeight: 700, fills: [{ type: 'solid', color: '#F5E642' }] }),
      makeText('Analytics overview for Q4', { fontSize: 16, fontFamily: 'Syne', fontWeight: 400, fills: [{ type: 'solid', color: '#E8E0F0' }] }),
      makeText('Revenue', { fontSize: 12, fontFamily: 'Syne', fontWeight: 500, fills: [{ type: 'solid', color: '#B8A8D0' }] }),
      makeText('$2.4M', { fontSize: 48, fontFamily: 'Playfair Display', fontWeight: 700, fills: [{ type: 'solid', color: '#F5E642' }] }),
      makeFrame({
        layoutMode: 'horizontal', layoutGap: 16,
        fills: [{ type: 'gradient-linear', color: '#6B2FBD' }],
        children: [
          makeRect({ width: 60, height: 60, name: 'btn-primary', fills: [{ type: 'solid', color: '#F5E642' }], cornerRadius: 8 }),
          makeRect({ width: 60, height: 60, name: 'icon', fills: [{ type: 'solid', color: '#B8A8D0' }], cornerRadius: 30 }),
        ],
      }),
    ],
  })],
  {
    variableCollections: [{
      id: 'vc1', name: 'Brand',
      variables: [
        { id: 'v1', name: 'brand-purple', collection: 'vc1', type: 'color', value: '#1A0B3B' },
        { id: 'v2', name: 'brand-yellow', collection: 'vc1', type: 'color', value: '#F5E642' },
        { id: 'v3', name: 'accent-violet', collection: 'vc1', type: 'color', value: '#6B2FBD' },
        { id: 'v4', name: 'text-muted', collection: 'vc1', type: 'color', value: '#B8A8D0' },
        { id: 'v5', name: 'text-light', collection: 'vc1', type: 'color', value: '#E8E0F0' },
        { id: 'v6', name: 'space-sm', collection: 'vc1', type: 'number', value: 8 },
        { id: 'v7', name: 'space-md', collection: 'vc1', type: 'number', value: 16 },
        { id: 'v8', name: 'space-lg', collection: 'vc1', type: 'number', value: 32 },
      ],
    }],
  },
);

// A generic Bootstrap-like design
const GENERIC_DOC: OPDocument = makeDoc([
  makeFrame({
    fills: [{ type: 'solid', color: '#f8f9fa' }],
    children: [
      makeText('Title', { fontSize: 16, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#343a40' }] }),
      makeText('Body text', { fontSize: 16, fontFamily: 'Arial', fills: [{ type: 'solid', color: '#6c757d' }] }),
      makeRect({ width: 120, height: 40, name: 'btn', fills: [{ type: 'solid', color: '#007bff' }] }),
    ],
  }),
]);

// An empty document
const EMPTY_DOC: OPDocument = makeDoc([]);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('scoreCanvasQuality', () => {
  it('returns all 7 dimensions for a good design', () => {
    const result = scoreCanvasQuality(GOOD_DOC);
    assert.equal(Object.keys(result.dimensions).length, 7);
    assert.ok(result.composite >= 0 && result.composite <= 100);
    assert.ok(result.passingCount >= 0 && result.passingCount <= 7);
  });

  it('good design scores higher composite than generic design', () => {
    const good = scoreCanvasQuality(GOOD_DOC);
    const generic = scoreCanvasQuality(GENERIC_DOC);
    assert.ok(good.composite > generic.composite, `good=${good.composite} should exceed generic=${generic.composite}`);
  });

  it('empty document returns artifactQuality = 0', () => {
    const result = scoreCanvasQuality(EMPTY_DOC);
    assert.equal(result.dimensions.artifactQuality, 0);
    assert.equal(result.gapFromTarget, 7);
  });

  it('good design passes more dimensions than generic', () => {
    const good = scoreCanvasQuality(GOOD_DOC);
    const generic = scoreCanvasQuality(GENERIC_DOC);
    assert.ok(good.passingCount > generic.passingCount, `good=${good.passingCount} dims passing vs generic=${generic.passingCount}`);
  });

  it('generic design penalised on antiGeneric dimension', () => {
    const result = scoreCanvasQuality(GENERIC_DOC);
    assert.ok(result.dimensions.antiGeneric < 70, `antiGeneric=${result.dimensions.antiGeneric} should be below 70 for generic UI`);
  });

  it('good design rewards colorDistinctiveness with non-Bootstrap palette', () => {
    const result = scoreCanvasQuality(GOOD_DOC);
    assert.ok(result.dimensions.colorDistinctiveness >= 70, `colorDistinctiveness=${result.dimensions.colorDistinctiveness}`);
  });

  it('two-font design scores typographyQuality higher than single-font', () => {
    const singleFont = makeDoc([makeFrame({ children: [
      makeText('Heading', { fontFamily: 'Arial', fontSize: 32 }),
      makeText('Body', { fontFamily: 'Arial', fontSize: 16 }),
    ] })]);
    const twoFont = makeDoc([makeFrame({ children: [
      makeText('Heading', { fontFamily: 'Playfair Display', fontSize: 32 }),
      makeText('Body', { fontFamily: 'Syne', fontSize: 16 }),
    ] })]);
    const s1 = scoreCanvasQuality(singleFont).dimensions.typographyQuality;
    const s2 = scoreCanvasQuality(twoFont).dimensions.typographyQuality;
    assert.ok(s2 > s1, `two-font=${s2} should exceed single-font=${s1}`);
  });

  it('document with variable collections scores higher tokenCoherence', () => {
    const withTokens = scoreCanvasQuality(GOOD_DOC).dimensions.tokenCoherence;
    const noTokens = scoreCanvasQuality(GENERIC_DOC).dimensions.tokenCoherence;
    assert.ok(withTokens > noTokens, `with-tokens=${withTokens} vs no-tokens=${noTokens}`);
  });

  it('frame with layoutMode scores responsiveness higher than no-layout frame', () => {
    const withLayout = makeDoc([makeFrame({ layoutMode: 'vertical', constraints: { horizontal: 'stretch', vertical: 'min' }, layoutGap: 16 })]);
    const noLayout = makeDoc([makeFrame({ layoutMode: 'none' })]);
    const s1 = scoreCanvasQuality(withLayout).dimensions.responsiveness;
    const s2 = scoreCanvasQuality(noLayout).dimensions.responsiveness;
    assert.ok(s1 > s2, `with-layout=${s1} should exceed no-layout=${s2}`);
  });

  it('tiny interactive elements (< 44px) penalise accessibility', () => {
    const withSmall = makeDoc([makeFrame({ children: [
      { id: 'b1', type: 'frame', name: 'btn-submit', width: 20, height: 20 },
    ] })]);
    const withLarge = makeDoc([makeFrame({ children: [
      { id: 'b2', type: 'frame', name: 'btn-submit', width: 48, height: 48 },
    ] })]);
    const s1 = scoreCanvasQuality(withSmall).dimensions.accessibility;
    const s2 = scoreCanvasQuality(withLarge).dimensions.accessibility;
    assert.ok(s2 > s1, `large-targets=${s2} should exceed small-targets=${s1}`);
  });

  it('gapFromTarget equals 7 minus passingCount', () => {
    for (const doc of [GOOD_DOC, GENERIC_DOC, EMPTY_DOC]) {
      const r = scoreCanvasQuality(doc);
      assert.equal(r.gapFromTarget, 7 - r.passingCount);
    }
  });

  it('gradient fills increase colorDistinctiveness score', () => {
    const withGradient = makeDoc([makeFrame({ fills: [{ type: 'gradient-linear', color: '#6B2FBD' }] })]);
    const withFlat = makeDoc([makeFrame({ fills: [{ type: 'solid', color: '#6B2FBD' }] })]);
    const s1 = scoreCanvasQuality(withGradient).dimensions.colorDistinctiveness;
    const s2 = scoreCanvasQuality(withFlat).dimensions.colorDistinctiveness;
    assert.ok(s1 >= s2, `gradient=${s1} should be >= flat=${s2}`);
  });
});
