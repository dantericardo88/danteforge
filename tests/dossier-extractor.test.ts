// tests/dossier-extractor.test.ts — Tests for src/dossier/extractor.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkContent,
  formatRubricCriteria,
  buildExtractionPrompt,
  parseEvidenceItems,
  extractEvidence,
} from '../src/dossier/extractor.js';
import type { RubricDimension } from '../src/dossier/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDimDef(): RubricDimension {
  return {
    name: 'Ghost text completions',
    scoreCriteria: {
      '9': ['Sub-100ms P50 TTFB'],
      '7': ['Inline completions present'],
      '5': ['Single token only'],
      '3': ['Manual trigger'],
      '1': ['No completions'],
    },
  };
}

function makeLLMCaller(response: string) {
  return async (_prompt: string) => response;
}

function makeFailingLLMCaller() {
  return async (_prompt: string): Promise<string> => {
    throw new Error('LLM unavailable');
  };
}

// ── Tests: chunkContent() ─────────────────────────────────────────────────────

describe('chunkContent()', () => {
  it('returns single chunk for short content', () => {
    const chunks = chunkContent('hello world');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], 'hello world');
  });

  it('splits long content into 3000-char chunks', () => {
    const long = 'x'.repeat(7500);
    const chunks = chunkContent(long);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0]!.length, 3000);
    assert.equal(chunks[1]!.length, 3000);
    assert.equal(chunks[2]!.length, 1500);
  });

  it('returns single empty chunk for empty string', () => {
    const chunks = chunkContent('');
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0], '');
  });
});

// ── Tests: formatRubricCriteria() ─────────────────────────────────────────────

describe('formatRubricCriteria()', () => {
  it('includes all 5 score tiers', () => {
    const result = formatRubricCriteria(makeDimDef());
    assert.ok(result.includes('Score 9'));
    assert.ok(result.includes('Score 7'));
    assert.ok(result.includes('Score 5'));
    assert.ok(result.includes('Score 3'));
    assert.ok(result.includes('Score 1'));
  });

  it('lists criteria text', () => {
    const result = formatRubricCriteria(makeDimDef());
    assert.ok(result.includes('Sub-100ms P50 TTFB'));
  });
});

// ── Tests: buildExtractionPrompt() ───────────────────────────────────────────

describe('buildExtractionPrompt()', () => {
  it('includes competitor name, dim name, and source url', () => {
    const prompt = buildExtractionPrompt(
      'cursor', 1, makeDimDef(), 'https://cursor.com/docs', 'some content',
    );
    assert.ok(prompt.includes('cursor'));
    assert.ok(prompt.includes('Ghost text completions'));
    assert.ok(prompt.includes('https://cursor.com/docs'));
  });

  it('includes source content in prompt', () => {
    const prompt = buildExtractionPrompt(
      'cursor', 1, makeDimDef(), 'https://cursor.com', 'my source content',
    );
    assert.ok(prompt.includes('my source content'));
  });
});

// ── Tests: parseEvidenceItems() ──────────────────────────────────────────────

describe('parseEvidenceItems()', () => {
  it('parses valid evidence array', () => {
    const raw = JSON.stringify([
      { claim: 'Cursor is fast', quote: 'median latency 47ms', source: 'https://cursor.com' },
    ]);
    const items = parseEvidenceItems(raw, 1, 'https://cursor.com');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.claim, 'Cursor is fast');
    assert.equal(items[0]!.dim, 1);
  });

  it('returns empty array on invalid JSON', () => {
    const items = parseEvidenceItems('not json', 1, 'https://cursor.com');
    assert.deepEqual(items, []);
  });

  it('returns empty array on non-array JSON', () => {
    const items = parseEvidenceItems('{"foo":"bar"}', 1, 'https://cursor.com');
    assert.deepEqual(items, []);
  });

  it('filters out items missing required fields', () => {
    const raw = JSON.stringify([
      { claim: 'ok', quote: 'yes', source: 'https://x.com' },   // valid
      { claim: 'no quote' },                                       // missing quote + source
    ]);
    const items = parseEvidenceItems(raw, 1, 'https://x.com');
    assert.equal(items.length, 1);
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n[{"claim":"x","quote":"y","source":"z"}]\n```';
    const items = parseEvidenceItems(raw, 1, 'z');
    assert.equal(items.length, 1);
  });
});

// ── Tests: extractEvidence() ─────────────────────────────────────────────────

describe('extractEvidence()', () => {
  it('returns evidence items from successful LLM call', async () => {
    const llmResponse = JSON.stringify([
      { claim: 'Cursor streams completions', quote: 'median 47ms', source: 'https://cursor.com' },
    ]);
    const items = await extractEvidence(
      'cursor ships fast completions',
      'https://cursor.com',
      'cursor', 1, makeDimDef(),
      { _callLLM: makeLLMCaller(llmResponse) },
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]!.dim, 1);
  });

  it('returns empty array when LLM fails', async () => {
    const items = await extractEvidence(
      'content', 'https://cursor.com', 'cursor', 1, makeDimDef(),
      { _callLLM: makeFailingLLMCaller() },
    );
    assert.deepEqual(items, []);
  });

  it('returns empty array when LLM returns empty array', async () => {
    const items = await extractEvidence(
      'no relevant content',
      'https://cursor.com',
      'cursor', 1, makeDimDef(),
      { _callLLM: makeLLMCaller('[]') },
    );
    assert.deepEqual(items, []);
  });
});
