// dim-triage.test.ts — classify + route competitive dimensions to the loop that can move them.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDimDeterministic,
  extractCommandPaths,
  parseClassifyResponse,
  summarize,
  formatTriageReport,
  ROUTE_BY_CATEGORY,
  type DimSignals,
} from '../src/core/dim-triage.js';
import { dimTriage } from '../src/cli/commands/dim-triage.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

const sig = (over: Partial<DimSignals> = {}): DimSignals => ({ id: 'd', score: 3, ...over });

// ── deterministic classifier ───────────────────────────────────────────────────

describe('classifyDimDeterministic', () => {
  it('market-capped dims are ceilinged with a 5.0 suggested ceiling', () => {
    const c = classifyDimDeterministic(sig({ id: 'community_adoption', isMarketCapped: true }));
    assert.equal(c.category, 'ceilinged');
    assert.equal(c.route, 'none');
    assert.equal(c.suggestedCeiling, 5.0);
    assert.equal(c.needsLLM, false);
  });

  it('closingStrategy=human is ceilinged', () => {
    assert.equal(classifyDimDeterministic(sig({ closingStrategy: 'human' })).category, 'ceilinged');
  });

  it('a dim already at its operator ceiling is ceilinged', () => {
    assert.equal(classifyDimDeterministic(sig({ score: 5, ceiling: 5 })).category, 'ceilinged');
  });

  it('no_capability_test is ceilinged (not machine-verifiable)', () => {
    assert.equal(classifyDimDeterministic(sig({ noCapabilityTest: true })).category, 'ceilinged');
  });

  it('a missing capability_test command is a yardstick_bug → fix-test', () => {
    const c = classifyDimDeterministic(sig({ capabilityTestCommand: undefined }));
    assert.equal(c.category, 'yardstick_bug');
    assert.equal(c.route, 'fix-test');
  });

  it('a command whose script does not exist is a yardstick_bug', () => {
    const c = classifyDimDeterministic(sig({ capabilityTestCommand: 'node scripts/proof.mjs', scriptExists: false }));
    assert.equal(c.category, 'yardstick_bug');
  });

  it('a real, existing capability_test is unknown (needs LLM judgment)', () => {
    const c = classifyDimDeterministic(sig({ capabilityTestCommand: 'node scripts/proof.mjs', scriptExists: true }));
    assert.equal(c.category, 'unknown');
    assert.equal(c.needsLLM, true);
  });
});

// ── helpers ─────────────────────────────────────────────────────────────────────

describe('extractCommandPaths', () => {
  it('pulls path-like + extension tokens, skips flags/executables', () => {
    assert.deepEqual(extractCommandPaths('bash scripts/x.sh --flag a/b.py'), ['scripts/x.sh', 'a/b.py']);
    assert.deepEqual(extractCommandPaths('npm test'), []);
  });
});

describe('parseClassifyResponse', () => {
  it('accepts a valid category and maps the route', () => {
    const c = parseClassifyResponse(sig(), '{"category":"feature_construction","reason":"needs a whole module"}');
    assert.equal(c?.category, 'feature_construction');
    assert.equal(c?.route, ROUTE_BY_CATEGORY.feature_construction);
    assert.equal(c?.route, 'matrixdev');
  });
  it('rejects an invalid category', () => {
    assert.equal(parseClassifyResponse(sig(), '{"category":"banana"}'), null);
  });
  it('rejects non-JSON', () => {
    assert.equal(parseClassifyResponse(sig(), 'no json here'), null);
  });
});

describe('summarize + report', () => {
  it('counts categories and routes', () => {
    const classes = [
      classifyDimDeterministic(sig({ id: 'a', isMarketCapped: true })),
      classifyDimDeterministic(sig({ id: 'b', capabilityTestCommand: undefined })),
    ];
    const s = summarize(classes);
    assert.equal(s.total, 2);
    assert.equal(s.byCategory.ceilinged, 1);
    assert.equal(s.byCategory.yardstick_bug, 1);
    assert.equal(s.byRoute['fix-test'], 1);
  });
  it('renders a markdown report with a row per dim', () => {
    const md = formatTriageReport('proj', [classifyDimDeterministic(sig({ id: 'mydim', isMarketCapped: true }))]);
    assert.match(md, /Dimension Triage — proj/);
    assert.match(md, /mydim/);
  });
});

// ── command-level (seamed; no real FS / LLM) ────────────────────────────────────

const originalExit = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExit; });

function fakeMatrix(): CompeteMatrix {
  return {
    project: 'proj', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: '', overallSelfScore: 5, dimensions: [
      { id: 'community_adoption', label: 'Adoption', scores: { self: 3 } },
      { id: 'broken_test', label: 'Broken', scores: { self: 4 }, capability_test: { command: 'node scripts/missing.mjs' } },
      { id: 'done_dim', label: 'Done', scores: { self: 8 } },
    ] as unknown as CompeteMatrix['dimensions'],
  } as unknown as CompeteMatrix;
}

describe('dimTriage command (seamed)', () => {
  it('classifies sub-target dims and --apply sets a ceiling on the market dim only', async () => {
    let saved: CompeteMatrix | null = null;
    const writes: string[] = [];
    await dimTriage({
      apply: true,
      _loadMatrix: async () => fakeMatrix(),
      _saveMatrix: async (m) => { saved = m; },
      _isLLMAvailable: async () => false, // deterministic-only
      _fileExists: async () => false,     // the broken_test script is "missing"
      _writeFile: async (p) => { writes.push(p); },
      _mkdir: async () => {},
    });
    assert.ok(saved, 'matrix saved because a ceiling was applied');
    const ca = saved!.dimensions.find(d => d.id === 'community_adoption')!;
    assert.equal(ca.ceiling, 5.0, 'market dim got an explicit 5.0 ceiling');
    const bt = saved!.dimensions.find(d => d.id === 'broken_test')!;
    assert.equal(bt.ceiling, undefined, 'a yardstick_bug dim is NOT auto-ceilinged');
    assert.ok(writes.some(p => p.includes('DIM_TRIAGE.md')), 'report written via seam (no real FS)');
  });

  it('skips dims already at/above target', async () => {
    let saved = false;
    await dimTriage({
      _loadMatrix: async () => fakeMatrix(),
      _saveMatrix: async () => { saved = true; },
      _isLLMAvailable: async () => false,
      _fileExists: async () => false,
      _writeFile: async () => {}, _mkdir: async () => {},
    });
    // done_dim (8.0) is above target 7 → never classified; no --apply → no save.
    assert.equal(saved, false);
  });
});
