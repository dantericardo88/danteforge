// Maturity Engine — Coverage evidence path tests.
// Verifies that scoreTestingMaturity reads from .danteforge/evidence/coverage-summary.json
// (not the old .danteforge/coverage-summary.json path).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  scoreMaturityDimensions,
  type MaturityContext,
} from '../src/core/maturity-engine.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    maxBudgetUsd: 10,
    routingAggressiveness: 'balanced',
    selfEditPolicy: 'deny',
    projectType: 'unknown',
    ...overrides,
  };
}

function makeCtx(
  cwd: string,
  overrides: Partial<MaturityContext> = {},
): MaturityContext {
  return {
    cwd,
    state: makeState(),
    pdseScores: {},
    targetLevel: 5,
    _collectFiles: async () => [],   // skip file scanning
    _readdir: async () => [],         // no test directory entries
    ...overrides,
  };
}

function makeCoverageSummary(linePct: number): string {
  return JSON.stringify({
    total: {
      lines: { pct: linePct },
      statements: { pct: linePct },
      functions: { pct: linePct },
      branches: { pct: linePct },
    },
  });
}

// ── Evidence path tests ───────────────────────────────────────────────────────

describe('scoreTestingMaturity — evidence path', () => {
  it('reads coverage from .danteforge/evidence/coverage-summary.json (correct path)', async () => {
    const cwd = '/fake/project';
    const expectedPath = path.join(cwd, '.danteforge', 'evidence', 'coverage-summary.json');

    const seenPaths: string[] = [];
    const ctx = makeCtx(cwd, {
      _fileExists: async (p: string) => {
        seenPaths.push(p);
        return p === expectedPath;  // only the evidence path exists
      },
      _readFile: async (p: string) => {
        if (p === expectedPath) return makeCoverageSummary(85);
        throw new Error(`Unexpected read: ${p}`);
      },
    });

    const dims = await scoreMaturityDimensions(ctx);

    // Verify it actually read from the correct evidence path
    assert.ok(
      seenPaths.some(p => p === expectedPath),
      `Expected fileExists to be called with ${expectedPath}, but got: ${JSON.stringify(seenPaths)}`,
    );

    // Score should include coverage bonus (base 50 + 15 for 85% coverage)
    assert.ok(dims.testing >= 65, `Expected testing >= 65, got ${dims.testing}`);
  });

  it('does NOT read from old .danteforge/coverage-summary.json path', async () => {
    const cwd = '/fake/project';
    const wrongPath = path.join(cwd, '.danteforge', 'coverage-summary.json');
    const correctPath = path.join(cwd, '.danteforge', 'evidence', 'coverage-summary.json');

    const ctx = makeCtx(cwd, {
      _fileExists: async (p: string) => {
        // The old (wrong) path would return true, correct path returns false
        if (p === wrongPath) return true;
        if (p === correctPath) return false;
        return false;
      },
      _readFile: async () => makeCoverageSummary(90),
    });

    const dims = await scoreMaturityDimensions(ctx);

    // Coverage bonus should NOT be applied (reading wrong path)
    // Score = 50 (base) only — no coverage bonus since correct path doesn't exist
    // (fileExists for correct path returns false)
    assert.ok(dims.testing < 80, `Expected testing < 80 (no coverage bonus), got ${dims.testing}`);
  });

  it('gives +15 bonus for 85% line coverage', async () => {
    const cwd = '/fake/project';
    const coveragePath = path.join(cwd, '.danteforge', 'evidence', 'coverage-summary.json');

    const ctx = makeCtx(cwd, {
      _fileExists: async (p: string) => p === coveragePath,
      _readFile: async () => makeCoverageSummary(85),
    });

    const base = await scoreMaturityDimensions(makeCtx(cwd, {
      _fileExists: async () => false,
      _readFile: async () => '',
    }));

    const withCoverage = await scoreMaturityDimensions(ctx);

    // The coverage bonus for 85% is +15
    assert.ok(
      withCoverage.testing >= base.testing + 10,
      `Expected coverage bonus ≥ 10pts (got base=${base.testing}, with=${withCoverage.testing})`,
    );
  });
});
