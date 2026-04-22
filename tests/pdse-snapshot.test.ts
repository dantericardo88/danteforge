// PDSE Snapshot tests — writePdseSnapshot

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ScoreResult } from '../src/core/pdse.js';
import type { ScoredArtifact } from '../src/core/pdse-config.js';
import { writePdseSnapshot, PDSE_SNAPSHOT_FILE, type PdseSnapshot } from '../src/core/pdse-snapshot.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeScoreResult(score: number): ScoreResult {
  return {
    score,
    autoforgeDecision: score >= 90 ? 'advance' : score >= 75 ? 'warn' : score >= 50 ? 'pause' : 'blocked',
    dimensions: { completeness: 20, freshness: 20, clarity: 20, testability: 20, integration: score - 80 },
    gaps: [],
  };
}

function makeScores(scores: Partial<Record<ScoredArtifact, number>> = {}): Record<ScoredArtifact, ScoreResult> {
  const defaults: Record<ScoredArtifact, number> = {
    CONSTITUTION: 90,
    SPEC: 85,
    CLARIFY: 80,
    PLAN: 75,
    TASKS: 95,
  };
  const merged = { ...defaults, ...scores };
  const result = {} as Record<ScoredArtifact, ScoreResult>;
  for (const [k, v] of Object.entries(merged)) {
    result[k as ScoredArtifact] = makeScoreResult(v);
  }
  return result;
}

// ── writePdseSnapshot ─────────────────────────────────────────────────────────

describe('writePdseSnapshot', () => {
  it('writes a snapshot file with correct shape', async () => {
    let writtenPath = '';
    let writtenContent = '';

    await writePdseSnapshot(makeScores(), '/fake/cwd', {
      _writeFile: async (p, c) => { writtenPath = p; writtenContent = c; },
      _mkdir: async () => {},
    });

    assert.ok(writtenPath.endsWith('latest-pdse.json'));
    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.ok(typeof snap.timestamp === 'string');
    assert.ok(typeof snap.avgScore === 'number');
    assert.ok(typeof snap.scores === 'object');
  });

  it('computes avgScore as rounded average of all artifact scores', async () => {
    let writtenContent = '';
    const scores = makeScores({ CONSTITUTION: 80, SPEC: 80, CLARIFY: 80, PLAN: 80, TASKS: 80 });

    await writePdseSnapshot(scores, '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.equal(snap.avgScore, 80);
  });

  it('includes per-artifact score and decision', async () => {
    let writtenContent = '';

    await writePdseSnapshot(makeScores(), '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.ok('CONSTITUTION' in snap.scores);
    assert.ok(typeof snap.scores.CONSTITUTION.score === 'number');
    assert.ok(typeof snap.scores.CONSTITUTION.decision === 'string');
  });

  it('includes toolchainMetrics when provided', async () => {
    let writtenContent = '';

    const metrics = {
      tscErrors: 0, testsPassing: 100, testsFailing: 0,
      lintErrors: 0, coveragePct: 80, gatherDurationMs: 50,
    };

    await writePdseSnapshot(makeScores(), '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
      toolchainMetrics: metrics,
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.ok(snap.toolchainMetrics !== undefined);
    assert.equal(snap.toolchainMetrics?.tscErrors, 0);
  });

  it('omits toolchainMetrics when not provided', async () => {
    let writtenContent = '';

    await writePdseSnapshot(makeScores(), '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.equal(snap.toolchainMetrics, undefined);
  });

  it('never throws when writeFile fails', async () => {
    // Should swallow the error silently
    await assert.doesNotReject(() =>
      writePdseSnapshot(makeScores(), '/fake/cwd', {
        _writeFile: async () => { throw new Error('disk full'); },
        _mkdir: async () => {},
      })
    );
  });

  it('never throws when mkdir fails', async () => {
    await assert.doesNotReject(() =>
      writePdseSnapshot(makeScores(), '/fake/cwd', {
        _writeFile: async () => {},
        _mkdir: async () => { throw new Error('permission denied'); },
      })
    );
  });

  it('produces a valid ISO timestamp', async () => {
    let writtenContent = '';

    await writePdseSnapshot(makeScores(), '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.ok(!isNaN(Date.parse(snap.timestamp)));
  });

  it('avgScore is 0 when scores is empty', async () => {
    let writtenContent = '';

    await writePdseSnapshot({} as Record<ScoredArtifact, ScoreResult>, '/fake/cwd', {
      _writeFile: async (_, c) => { writtenContent = c; },
      _mkdir: async () => {},
    });

    const snap = JSON.parse(writtenContent) as PdseSnapshot;
    assert.equal(snap.avgScore, 0);
  });

  it('PDSE_SNAPSHOT_FILE constant is the expected path', () => {
    assert.equal(PDSE_SNAPSHOT_FILE, '.danteforge/latest-pdse.json');
  });
});
