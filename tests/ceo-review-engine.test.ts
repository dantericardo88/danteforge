import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAmbiguitySignals,
  shouldAutoCEOReview,
  AMBIGUITY_SIGNALS,
} from '../src/core/ceo-review-engine.js';

describe('detectAmbiguitySignals', () => {
  it('finds known ambiguity signal in text', () => {
    const result = detectAmbiguitySignals('maybe we should do something here');
    assert.ok(result.includes('maybe'));
    assert.ok(result.includes('something'));
  });

  it('returns empty array for clear goal text', () => {
    const result = detectAmbiguitySignals('Build a REST API with JWT authentication and rate limiting');
    assert.deepEqual(result, []);
  });

  it('is case-insensitive', () => {
    const result = detectAmbiguitySignals('MAYBE we could do this');
    assert.ok(result.includes('maybe'));
  });

  it('finds TBD signal', () => {
    const result = detectAmbiguitySignals('The auth flow is TBD');
    assert.ok(result.includes('TBD'));
  });

  it('finds kind-of signal', () => {
    const result = detectAmbiguitySignals('it should kind of work like a dashboard');
    assert.ok(result.includes('kind of'));
  });

  it('finds not-sure signal', () => {
    const result = detectAmbiguitySignals("I am not sure about the architecture");
    assert.ok(result.includes('not sure'));
  });

  it('AMBIGUITY_SIGNALS constant is non-empty', () => {
    assert.ok(AMBIGUITY_SIGNALS.length > 0);
  });

  it('returns each matched signal only once', () => {
    const result = detectAmbiguitySignals('maybe maybe maybe');
    const unique = new Set(result);
    assert.equal(unique.size, result.length);
  });
});

describe('shouldAutoCEOReview', () => {
  it('returns true when 3+ ambiguity signals found', () => {
    const goal = 'maybe we could somehow do something kind of like a dashboard';
    assert.equal(shouldAutoCEOReview(goal), true);
  });

  it('returns false for unambiguous goal', () => {
    assert.equal(shouldAutoCEOReview('Add OAuth2 login with Google and GitHub providers'), false);
  });

  it('returns true for maximally ambiguous goal', () => {
    const vague = 'I kind of want something that might probably work, not sure how, maybe TBD';
    assert.equal(shouldAutoCEOReview(vague), true);
  });
});
