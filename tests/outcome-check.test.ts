import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOutcomeCheck,
  type OutcomeCheckOptions,
} from '../src/cli/commands/outcome-check.js';
import type { AttributionLog } from '../src/core/causal-attribution.js';
import type { ConvergenceState } from '../src/core/convergence.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function makeLog(overrides: Partial<AttributionLog['records'][number]>[] = []): AttributionLog {
  const records = overrides.map(o => ({
    patternName: 'circuit-breaker',
    sourceRepo: 'github.com/example/repo',
    adoptedAt: pastDate(10),
    preAdoptionScore: 5.0,
    postAdoptionScore: 6.5,
    scoreDelta: 1.5,
    verifyStatus: 'pass' as const,
    filesModified: ['src/main.ts'],
    ...o,
  }));
  return { version: '1.0.0', records, updatedAt: new Date().toISOString() };
}

function makeConvergence(avgScore = 7.0): ConvergenceState {
  return {
    version: '1.0.0',
    targetScore: 9.0,
    dimensions: [{ dimension: 'error-handling', score: avgScore, evidence: [], scoreHistory: [], converged: false }],
    cycleHistory: [],
    lastCycle: 0,
    totalCostUsd: 0,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    adoptedPatternsSummary: [],
  };
}

function makeSavedLog(): { log: AttributionLog; savedLog: () => AttributionLog | null } {
  let saved: AttributionLog | null = null;
  return {
    log: makeLog(),
    savedLog: () => saved,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runOutcomeCheck', () => {
  it('T1: returns empty result when no eligible patterns', async () => {
    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => makeLog(), // records have adoptedAt=10 days ago
      _loadConvergence: async () => makeConvergence(7.0),
      _saveAttributionLog: async () => {},
      daysThreshold: 30, // 10 days < 30-day threshold → not eligible
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.patternsChecked, 0);
    assert.equal(result.improved, 0);
  });

  it('T2: marks patterns as improved when laggingDelta > 0.1', async () => {
    let savedLog: AttributionLog | null = null;
    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => makeLog([{ adoptedAt: pastDate(10), postAdoptionScore: 5.0 }]),
      _loadConvergence: async () => makeConvergence(7.0), // avg 7.0 > postAdoption 5.0 → delta +2.0
      _saveAttributionLog: async (log) => { savedLog = log; },
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.patternsChecked, 1);
    assert.equal(result.improved, 1);
    assert.equal(result.regressed, 0);
    assert.ok(result.avgDelta7Day > 0.1);
    // Verify record was mutated with outcomeCheckedAt
    assert.ok(savedLog !== null);
    const record = (savedLog as AttributionLog).records[0] as any;
    assert.ok(record.outcomeCheckedAt);
    assert.ok(typeof record.laggingDelta === 'number');
  });

  it('T3: marks patterns as regressed when laggingDelta < -0.1', async () => {
    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => makeLog([{ adoptedAt: pastDate(10), postAdoptionScore: 8.0 }]),
      _loadConvergence: async () => makeConvergence(5.0), // avg 5.0 < postAdoption 8.0 → delta -3.0
      _saveAttributionLog: async () => {},
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.patternsChecked, 1);
    assert.equal(result.regressed, 1);
    assert.equal(result.improved, 0);
  });

  it('T4: skips patterns already checked (outcomeCheckedAt set)', async () => {
    const log = makeLog([{
      adoptedAt: pastDate(10),
      outcomeCheckedAt: pastDate(5), // already checked
    } as any]);

    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => log,
      _loadConvergence: async () => makeConvergence(7.0),
      _saveAttributionLog: async () => {},
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.patternsChecked, 0, 'already-checked patterns should be skipped');
  });

  it('T5: validates outcomeHypothesis when laggingDelta > 0 → hypothesisValidated=true', async () => {
    let savedLog: AttributionLog | null = null;
    const log = makeLog([{
      adoptedAt: pastDate(10),
      postAdoptionScore: 5.0,
      outcomeHypothesis: 'Expected error-handling score to increase',
    } as any]);

    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => log,
      _loadConvergence: async () => makeConvergence(8.0), // avg 8.0 > 5.0 → validated
      _saveAttributionLog: async (l) => { savedLog = l; },
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.hypothesesValidated, 1);
    assert.equal(result.hypothesesFalsified, 0);
    assert.ok(savedLog !== null);
    const record = (savedLog as AttributionLog).records[0] as any;
    assert.equal(record.hypothesisValidated, true);
  });

  it('T6: falsifies outcomeHypothesis when laggingDelta <= 0 → hypothesisValidated=false', async () => {
    let savedLog: AttributionLog | null = null;
    const log = makeLog([{
      adoptedAt: pastDate(10),
      postAdoptionScore: 8.0,
      outcomeHypothesis: 'Expected score to keep rising but it did not',
    } as any]);

    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => log,
      _loadConvergence: async () => makeConvergence(5.0), // avg 5.0 < 8.0 → falsified
      _saveAttributionLog: async (l) => { savedLog = l; },
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.hypothesesFalsified, 1);
    assert.equal(result.hypothesesValidated, 0);
    const record = (savedLog as AttributionLog).records[0] as any;
    assert.equal(record.hypothesisValidated, false);
  });

  it('T7: records without outcomeHypothesis do not increment hypothesis counters', async () => {
    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => makeLog([{ adoptedAt: pastDate(10), postAdoptionScore: 5.0 }]),
      _loadConvergence: async () => makeConvergence(7.0),
      _saveAttributionLog: async () => {},
      daysThreshold: 7,
    };

    const result = await runOutcomeCheck(opts);
    assert.equal(result.hypothesesValidated, 0);
    assert.equal(result.hypothesesFalsified, 0);
    assert.equal(result.patternsChecked, 1); // still counted in main tally
  });

  it('T8: handles loadConvergence failure gracefully (no currentScores)', async () => {
    const opts: OutcomeCheckOptions = {
      _loadAttributionLog: async () => makeLog([{ adoptedAt: pastDate(10), postAdoptionScore: 6.0 }]),
      _loadConvergence: async () => { throw new Error('convergence.json not found'); },
      _saveAttributionLog: async () => {},
      daysThreshold: 7,
    };

    // Should not throw — convergence is loaded with .catch(() => null)
    const result = await runOutcomeCheck(opts);
    assert.ok(typeof result.patternsChecked === 'number');
  });
});
