// tests/dossier-scorer.test.ts — Tests for src/dossier/scorer.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scoreDimension, buildScoringPrompt, parseScoreResult } from '../src/dossier/scorer.js';
import type { EvidenceItem, RubricDimension } from '../src/dossier/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDimDef(): RubricDimension {
  return {
    name: 'Ghost text completions',
    scoreCriteria: {
      '9': ['Sub-100ms P50 TTFB', 'Multi-line Tab'],
      '7': ['Inline completions present'],
      '5': ['Single token only'],
      '3': ['Manual trigger'],
      '1': ['No completions'],
    },
  };
}

function makeEvidence(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: 'Fast completions',
    quote: 'median latency 47ms',
    source: 'https://cursor.com',
    dim: 1,
    ...overrides,
  };
}

// ── Tests: parseScoreResult() ─────────────────────────────────────────────────

describe('parseScoreResult()', () => {
  it('parses valid score result', () => {
    const result = parseScoreResult('{"score":8.5,"justification":"Evidence shows good latency"}');
    assert.ok(result !== null);
    assert.equal(result.score, 8.5);
    assert.equal(result.justification, 'Evidence shows good latency');
  });

  it('returns null on invalid JSON', () => {
    assert.equal(parseScoreResult('not json'), null);
  });

  it('returns null when score is NaN', () => {
    const result = parseScoreResult('{"score":"bad","justification":"x"}');
    assert.equal(result, null);
  });

  it('clamps score to [1, 10]', () => {
    const tooHigh = parseScoreResult('{"score":15,"justification":"x"}');
    assert.ok(tooHigh !== null);
    assert.equal(tooHigh.score, 10);

    const tooLow = parseScoreResult('{"score":-5,"justification":"x"}');
    assert.ok(tooLow !== null);
    assert.equal(tooLow.score, 1);
  });

  it('strips markdown code fences', () => {
    const result = parseScoreResult('```json\n{"score":7,"justification":"ok"}\n```');
    assert.ok(result !== null);
    assert.equal(result.score, 7);
  });
});

// ── Tests: buildScoringPrompt() ───────────────────────────────────────────────

describe('buildScoringPrompt()', () => {
  it('includes competitor name and dim name', () => {
    const prompt = buildScoringPrompt('cursor', 1, makeDimDef(), [makeEvidence()]);
    assert.ok(prompt.includes('cursor'));
    assert.ok(prompt.includes('Ghost text completions'));
  });

  it('includes evidence items', () => {
    const prompt = buildScoringPrompt('cursor', 1, makeDimDef(), [makeEvidence()]);
    assert.ok(prompt.includes('median latency 47ms'));
  });

  it('shows "No evidence found" when empty array', () => {
    const prompt = buildScoringPrompt('cursor', 1, makeDimDef(), []);
    assert.ok(prompt.includes('No evidence found'));
  });
});

// ── Tests: scoreDimension() ───────────────────────────────────────────────────

describe('scoreDimension()', () => {
  it('returns score 1 with no evidence', async () => {
    const result = await scoreDimension([], 1, makeDimDef(), 'cursor');
    assert.equal(result.score, 1);
    assert.equal(result.justification, 'no evidence found');
  });

  it('returns LLM-derived score when evidence present', async () => {
    const result = await scoreDimension(
      [makeEvidence()],
      1,
      makeDimDef(),
      'cursor',
      { _callLLM: async () => '{"score":8,"justification":"Evidence shows 47ms latency"}' },
    );
    assert.equal(result.score, 8);
    assert.ok(result.justification.includes('47ms'));
  });

  it('falls back to score 1 when LLM fails', async () => {
    const result = await scoreDimension(
      [makeEvidence()],
      1,
      makeDimDef(),
      'cursor',
      { _callLLM: async () => { throw new Error('LLM down'); } },
    );
    assert.equal(result.score, 1);
    assert.equal(result.justification, 'no evidence found');
  });

  it('falls back to score 1 when LLM returns invalid JSON', async () => {
    const result = await scoreDimension(
      [makeEvidence()],
      1,
      makeDimDef(),
      'cursor',
      { _callLLM: async () => 'not valid json' },
    );
    assert.equal(result.score, 1);
  });

  it('rounds score to 1 decimal place', async () => {
    const result = await scoreDimension(
      [makeEvidence()],
      1,
      makeDimDef(),
      'cursor',
      { _callLLM: async () => '{"score":7.333,"justification":"ok"}' },
    );
    assert.equal(result.score, 7.3);
  });

  it('handles score exactly at boundary 10', async () => {
    const result = await scoreDimension(
      [makeEvidence()],
      1,
      makeDimDef(),
      'cursor',
      { _callLLM: async () => '{"score":10,"justification":"perfect"}' },
    );
    assert.equal(result.score, 10);
  });
});
