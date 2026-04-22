import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildScoreArc, proof } from '../src/cli/commands/proof.js';
import type { ScoreHistoryEntry } from '../src/core/state.js';

function makeEntry(overrides: Partial<ScoreHistoryEntry>): ScoreHistoryEntry {
  return {
    timestamp: '2026-01-01T00:00:00.000Z',
    displayScore: 7.0,
    gitSha: 'abc123',
    phase: 'forge',
    ...overrides,
  };
}

describe('buildScoreArc', () => {
  it('returns currentScore as before when no history in window', () => {
    const result = buildScoreArc('2026-06-01', [], 8.5);
    assert.equal(result.before, 8.5);
    assert.equal(result.after, 8.5);
    assert.equal(result.gain, 0);
  });

  it('filters entries by date prefix', () => {
    const history = [
      makeEntry({ timestamp: '2026-01-15T00:00:00.000Z', displayScore: 5.0 }),
      makeEntry({ timestamp: '2026-03-01T00:00:00.000Z', displayScore: 7.0 }),
    ];
    const result = buildScoreArc('2026-02-01', history, 8.0);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].displayScore, 7.0);
  });

  it('computes gain from last entry in window to current', () => {
    const history = [
      makeEntry({ timestamp: '2026-01-01T00:00:00.000Z', displayScore: 6.0 }),
    ];
    const result = buildScoreArc('2026-01-01', history, 8.0);
    assert.equal(result.before, 6.0);
    assert.equal(result.after, 8.0);
    assert.equal(result.gain, 2.0);
  });

  it('produces positive gain label in markdown', () => {
    const history = [makeEntry({ displayScore: 5.0 })];
    const result = buildScoreArc('2026-01-01', history, 9.0);
    assert.ok(result.markdown.includes('+4.0'));
  });

  it('produces negative gain label when score dropped', () => {
    const history = [makeEntry({ displayScore: 9.0 })];
    const result = buildScoreArc('2026-01-01', history, 7.0);
    assert.ok(result.gain < 0);
  });

  it('matches by gitSha when since is long string', () => {
    const history = [
      makeEntry({ gitSha: 'abc123def456', timestamp: '2026-01-01T00:00:00.000Z', displayScore: 6.0 }),
      makeEntry({ gitSha: 'xyz999', timestamp: '2026-02-01T00:00:00.000Z', displayScore: 8.0 }),
    ];
    const result = buildScoreArc('abc123def456', history, 9.0);
    assert.equal(result.entries.length, 1);
  });

  it('includes html content', () => {
    const result = buildScoreArc('2026-01-01', [], 7.5);
    assert.ok(result.html.includes('<!DOCTYPE html>'));
    assert.ok(result.html.includes('Score Arc'));
  });

  it('includes markdown content', () => {
    const result = buildScoreArc('2026-01-01', [], 7.5);
    assert.ok(result.markdown.includes('## Score Arc'));
  });

  it('rounds gain to 2 decimal places', () => {
    const history = [makeEntry({ displayScore: 5.333 })];
    const result = buildScoreArc('2026-01-01', history, 8.666);
    const str = result.gain.toString();
    const decimals = str.includes('.') ? str.split('.')[1].length : 0;
    assert.ok(decimals <= 2);
  });
});

describe('proof command injection', () => {
  it('prints usage when no prompt or flags', async () => {
    const lines: string[] = [];
    await proof({ _stdout: (l) => lines.push(l) });
    assert.ok(lines.some(l => l.includes('Usage')));
  });

  it('runs proof with injected runner', async () => {
    const lines: string[] = [];
    const mockReport = {
      rawPrompt: 'test',
      rawScore: { total: 50, specificity: 8, measurability: 8, testability: 8, ambiguity: 8, dcoupling: 8, toolability: 10 },
      pdseScore: 75,
      improvementPercent: 50,
      artifactSummary: 'Found 2/5 artifacts',
      verdict: 'moderate' as const,
      recommendation: 'Good prompt',
    };
    await proof({
      prompt: 'test prompt',
      _runProof: async () => mockReport as any,
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.length > 0);
  });

  it('uses injected score arc loader for --since flag', async () => {
    const lines: string[] = [];
    await proof({
      since: '2026-01-01',
      _loadScoreHistory: async () => ({ history: [], currentScore: 8.0 }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('Score Arc')));
  });
});
