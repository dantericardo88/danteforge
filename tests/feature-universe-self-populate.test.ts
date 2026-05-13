// Tests for self-populating feature universe + canonical DanteForge competitor seed.
//
// Covers the four wiring changes:
//   1. resolveCompetitorNames() in universe.ts reads .danteforge/compete/matrix.json
//      and falls back to the canonical seed.
//   2. ensureUniverseReady() is idempotent (skip when fresh, rebuild when stale).
//   3. defineUniverse() builds the feature universe after saving the matrix.
//   4. The canonical seed is non-empty and includes the four expected categories.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  getCanonicalDanteForgeCompetitors,
  ensureUniverseReady,
  type FeatureUniverse,
  type FeatureItem,
} from '../src/core/feature-universe.js';
import { universe as universeCommand } from '../src/cli/commands/universe.js';
import { defineUniverse } from '../src/core/universe-definer.js';

// Canned FEATURE| lines simulating an LLM response, so tests run offline.
function mockLLM(): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    if (prompt.includes('SCORE|')) {
      // Score prompt — score every feature 5/10 partial
      return Array.from({ length: 30 }).map((_, i) =>
        `SCORE|feat-${String(i + 1).padStart(3, '0')}|5|partial|mock evidence`,
      ).join('\n');
    }
    // Feature-extraction prompt — return 12 fake features
    return Array.from({ length: 12 }).map((_, i) =>
      `FEATURE|execution|Feature ${i + 1} for mock competitor|Mock description ${i + 1}|Mock implementation hint ${i + 1}`,
    ).join('\n');
  };
}

function mkTmpProject(prefix = 'dante-universe-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, '.danteforge'), { recursive: true });
  return dir;
}

test('canonical seed includes 16 DanteForge peers across four categories', () => {
  const seed = getCanonicalDanteForgeCompetitors();
  assert.ok(seed.length >= 14, `expected >= 14 peers, got ${seed.length}`);
  // Spec-driven dev kits
  assert.ok(seed.some(s => /spec-kit/i.test(s)), 'expected spec-kit in canonical seed');
  assert.ok(seed.some(s => /BMad/i.test(s)), 'expected BMad-METHOD in canonical seed');
  // Skill consolidators
  assert.ok(seed.some(s => /claude-skills/i.test(s)), 'expected claude-skills in canonical seed');
  // Autonomous research loops
  assert.ok(seed.some(s => /Karpathy/i.test(s) || /autoresearch/i.test(s)), 'expected Karpathy autoresearch in seed');
  // Orchestration peers
  assert.ok(seed.some(s => /MetaGPT/i.test(s)), 'expected MetaGPT in canonical seed');
  // Anti-test: must NOT contain platforms DanteForge sits on top of
  assert.ok(!seed.some(s => /^Devin/i.test(s)), 'canonical seed should NOT include Devin');
  assert.ok(!seed.some(s => /^Cursor$/i.test(s)), 'canonical seed should NOT include Cursor');
});

test('universe() falls back to project-preset competitors when state/matrix are empty', async () => {
  // Seed a package.json so the preset resolver picks dev-tool-optimizer
  const dir = mkTmpProject();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'danteforge' }));
  const fakeBuilder = async (competitors: string[]): Promise<FeatureUniverse> => {
    return {
      features: competitors.slice(0, 3).map((_c, i) => ({
        id: `feat-${i}`,
        name: `Mock ${i}`,
        description: 'Mock feature',
        category: 'execution' as const,
        competitorsThatHaveIt: [competitors[0] ?? ''],
      } satisfies FeatureItem)),
      competitors,
      generatedAt: new Date().toISOString(),
      version: 1,
      sourceDescription: `Derived from ${competitors.length} competitors`,
    };
  };
  const result = await universeCommand({
    cwd: dir,
    _buildUniverse: fakeBuilder,
    _scoreUniverse: async (u) => ({
      universe: u,
      scores: u.features.map(f => ({
        featureId: f.id, featureName: f.name, score: 5,
        evidence: 'mock', verdict: 'partial' as const,
      })),
      overallScore: 5, implementedCount: 0, partialCount: u.features.length,
      missingCount: 0, coveragePercent: 100, timestamp: new Date().toISOString(),
    }),
    _getTarget: async () => ({ minScore: 9, featureCoverage: 90 }),
  });
  assert.ok(result, 'universe() should return a non-null assessment');
  assert.ok(result.universe.competitors.length >= 14, 'should use dev-tool-optimizer preset when project is danteforge');
  // dev-tool-optimizer should include spec-kit
  assert.ok(result.universe.competitors.some(c => /spec-kit/i.test(c)),
    'expected spec-kit in dev-tool-optimizer-derived universe');
  assert.ok(result.universe.features.length > 0, 'should produce some features from preset');
});

test('universe() reads competitors from matrix.json when state.competitors is empty', async () => {
  const dir = mkTmpProject();
  // Seed compete/matrix.json with a custom competitor list
  mkdirSync(join(dir, '.danteforge', 'compete'), { recursive: true });
  writeFileSync(join(dir, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
    project: 'test',
    competitors: ['SpecialPeerA', 'SpecialPeerB'],
    dimensions: [],
    overallSelfScore: 5,
  }));
  let capturedCompetitors: string[] = [];
  const fakeBuilder = async (competitors: string[]): Promise<FeatureUniverse> => {
    capturedCompetitors = competitors;
    return {
      features: [{
        id: 'feat-001', name: 'X', description: 'Y',
        category: 'execution' as const, competitorsThatHaveIt: competitors,
      }],
      competitors,
      generatedAt: new Date().toISOString(),
      version: 1,
      sourceDescription: 'mock',
    };
  };
  await universeCommand({
    cwd: dir,
    _buildUniverse: fakeBuilder,
    _scoreUniverse: async (u) => ({
      universe: u, scores: [], overallScore: 0,
      implementedCount: 0, partialCount: 0, missingCount: 0,
      coveragePercent: 0, timestamp: new Date().toISOString(),
    }),
    _getTarget: async () => ({ minScore: 9, featureCoverage: 90 }),
  });
  assert.deepEqual(capturedCompetitors, ['SpecialPeerA', 'SpecialPeerB'],
    'should read competitors from matrix.json before falling back to canonical seed');
});

test('ensureUniverseReady() skips rebuild when universe is fresh and large enough', async () => {
  const dir = mkTmpProject();
  // Write a fresh universe with > 20 features
  const fresh: FeatureUniverse = {
    features: Array.from({ length: 25 }).map((_, i) => ({
      id: `feat-${i}`, name: `Fresh ${i}`, description: 'd',
      category: 'execution' as const, competitorsThatHaveIt: ['A'],
    })),
    competitors: ['A'],
    generatedAt: new Date().toISOString(),
    version: 1,
    sourceDescription: 'fresh',
  };
  writeFileSync(join(dir, '.danteforge', 'feature-universe.json'), JSON.stringify(fresh));
  let buildCalled = false;
  const result = await ensureUniverseReady(dir, {
    _buildUniverse: async () => { buildCalled = true; return fresh; },
  });
  assert.equal(buildCalled, false, 'should NOT rebuild a fresh universe');
  assert.equal(result?.features.length, 25);
});

test('ensureUniverseReady() rebuilds when universe is older than maxAgeDays', async () => {
  const dir = mkTmpProject();
  const stale: FeatureUniverse = {
    features: Array.from({ length: 25 }).map((_, i) => ({
      id: `feat-${i}`, name: `Stale ${i}`, description: 'd',
      category: 'execution' as const, competitorsThatHaveIt: ['A'],
    })),
    competitors: ['A'],
    generatedAt: '2020-01-01T00:00:00.000Z', // very old
    version: 1,
    sourceDescription: 'stale',
  };
  writeFileSync(join(dir, '.danteforge', 'feature-universe.json'), JSON.stringify(stale));
  let buildCalled = false;
  const fresh: FeatureUniverse = {
    ...stale,
    generatedAt: new Date().toISOString(),
    sourceDescription: 'rebuilt',
  };
  // loadOnly: false to opt in to rebuilding via the injected fake builder.
  // Engine wiring keeps loadOnly: true (default) so it never blocks on LLM.
  const result = await ensureUniverseReady(dir, {
    maxAgeDays: 14,
    loadOnly: false,
    _buildUniverse: async () => { buildCalled = true; return fresh; },
    _resolveCompetitors: async () => ['A'],
  });
  assert.equal(buildCalled, true, 'should rebuild a stale universe when loadOnly:false');
  assert.equal(result?.sourceDescription, 'rebuilt');
});

test('ensureUniverseReady() respects loadOnly:true default — never calls builder', async () => {
  const dir = mkTmpProject();
  // No universe on disk; with the default loadOnly:true we should NOT build
  let buildCalled = false;
  const result = await ensureUniverseReady(dir, {
    _buildUniverse: async () => { buildCalled = true; throw new Error('should not be called'); },
    _resolveCompetitors: async () => ['A'],
  });
  assert.equal(buildCalled, false, 'engine wiring (default loadOnly:true) must never invoke LLM');
  assert.equal(result, null, 'returns null when nothing on disk');
});

test('defineUniverse() builds feature universe after saving compete matrix', async () => {
  const dir = mkTmpProject();
  let universeBuilt = false;
  let savedFeatures: FeatureUniverse | null = null;
  // Mock scanCompetitors result inline via the injection chain.
  // defineUniverse uses _scanCompetitors and _saveMatrix as seams; we also pass _buildFeatureUniverse.
  const fakeScan = async () => ({
    ourDimensions: {} as Record<import('../src/core/harsh-scorer.js').ScoringDimension, number>,
    projectName: 'test',
    competitors: [{
      name: 'PeerA', url: '', description: '', source: 'hardcoded' as const,
      scores: {} as Record<import('../src/core/harsh-scorer.js').ScoringDimension, number>,
    }],
    leaderboard: [],
    gapReport: [],
    overallGap: 0,
    competitorSource: 'dev-tool-default' as const,
    analysisTimestamp: new Date().toISOString(),
  });
  await defineUniverse({
    cwd: dir,
    interactive: false,
    _scanCompetitors: fakeScan,
    _loadState: async () => ({ project: 'test', competitors: [] }) as ReturnType<typeof import('../src/core/state.js').loadState> extends Promise<infer T> ? T : never,
    _saveMatrix: async () => { /* no-op */ },
    _buildFeatureUniverse: async (competitors) => {
      universeBuilt = true;
      return {
        features: [{
          id: 'feat-001', name: 'Auto-built', description: 'd',
          category: 'execution' as const, competitorsThatHaveIt: competitors,
        }],
        competitors,
        generatedAt: new Date().toISOString(),
        version: 1,
        sourceDescription: 'auto-built by defineUniverse',
      };
    },
    _saveFeatureUniverse: async (u) => { savedFeatures = u; },
  });
  assert.equal(universeBuilt, true, 'defineUniverse should build the feature universe after saveMatrix');
  assert.ok(savedFeatures, 'defineUniverse should persist the feature universe');
});
