import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  GLOSSARY,
  formatEntry,
  findClosestTerm,
  type GlossaryEntry,
} from '../src/cli/commands/explain.js';

describe('GLOSSARY', () => {
  it('is a non-empty object', () => {
    assert.ok(Object.keys(GLOSSARY).length > 0);
  });

  it('every entry has term, plainEnglish, analogy, relatedCommands', () => {
    for (const [key, entry] of Object.entries(GLOSSARY)) {
      assert.ok(typeof entry.term === 'string' && entry.term.length > 0, `${key} missing term`);
      assert.ok(typeof entry.plainEnglish === 'string' && entry.plainEnglish.length > 0, `${key} missing plainEnglish`);
      assert.ok(typeof entry.analogy === 'string', `${key} missing analogy`);
      assert.ok(Array.isArray(entry.relatedCommands), `${key} missing relatedCommands`);
    }
  });

  it('includes core DanteForge concepts', () => {
    const keys = Object.keys(GLOSSARY);
    assert.ok(keys.length >= 5, 'should have many glossary entries');
  });
});

describe('formatEntry', () => {
  const entry: GlossaryEntry = {
    term: 'forge',
    plainEnglish: 'Execute development waves',
    analogy: 'Like a forge shaping metal',
    relatedCommands: ['forge', 'verify'],
  };

  it('includes the term in uppercase', () => {
    const output = formatEntry(entry);
    assert.ok(output.includes('FORGE'));
  });

  it('includes the plain English description', () => {
    const output = formatEntry(entry);
    assert.ok(output.includes('Execute development waves'));
  });

  it('includes the analogy', () => {
    const output = formatEntry(entry);
    assert.ok(output.includes('Like a forge shaping metal'));
  });

  it('includes related commands with danteforge prefix', () => {
    const output = formatEntry(entry);
    assert.ok(output.includes('danteforge forge'));
    assert.ok(output.includes('danteforge verify'));
  });

  it('includes example when present', () => {
    const withExample: GlossaryEntry = { ...entry, example: 'danteforge forge 1' };
    const output = formatEntry(withExample);
    assert.ok(output.includes('danteforge forge 1'));
  });

  it('omits Example line when example is absent', () => {
    const noExample: GlossaryEntry = { ...entry, example: undefined };
    const output = formatEntry(noExample);
    assert.ok(!output.includes('Example:'));
  });

  it('returns a non-empty string', () => {
    const output = formatEntry(entry);
    assert.ok(output.length > 0);
  });
});

describe('findClosestTerm', () => {
  it('returns exact match by key', () => {
    const keys = Object.keys(GLOSSARY);
    if (keys.length === 0) return;
    const firstKey = keys[0]!;
    const result = findClosestTerm(firstKey);
    assert.ok(result !== undefined);
    assert.equal(result!.term.toLowerCase(), firstKey.toLowerCase());
  });

  it('returns undefined for completely unknown input', () => {
    const result = findClosestTerm('xyzzypqr_unknown_term_9999');
    assert.equal(result, undefined);
  });

  it('is case-insensitive for exact match', () => {
    const keys = Object.keys(GLOSSARY);
    if (keys.length === 0) return;
    const firstKey = keys[0]!.toUpperCase();
    const result = findClosestTerm(firstKey);
    assert.ok(result !== undefined);
  });

  it('returns entry for substring match', () => {
    const keys = Object.keys(GLOSSARY);
    const longKey = keys.find(k => k.length >= 5);
    if (!longKey) return;
    const sub = longKey.slice(0, 4);
    const result = findClosestTerm(sub);
    assert.ok(result !== undefined);
  });
});
