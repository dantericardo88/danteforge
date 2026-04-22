import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAmbiguitySignals,
  shouldAutoCEOReview,
  formatCEOReviewSection,
  AMBIGUITY_SIGNALS,
  type CEOReviewResult,
} from '../src/core/ceo-review-engine.js';

function makeResult(overrides: Partial<CEOReviewResult> = {}): CEOReviewResult {
  return {
    originalGoal: 'Build a thing',
    elevatedVision: 'A revolutionary platform',
    challengingQuestions: ['Why this?', 'Who benefits?'],
    tenStarVersion: 'The ideal version changes everything',
    ambiguitySignalsFound: [],
    wasAutoTriggered: false,
    ...overrides,
  };
}

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

describe('formatCEOReviewSection', () => {
  it('includes original goal', () => {
    const md = formatCEOReviewSection(makeResult({ originalGoal: 'my-unique-goal' }));
    assert.ok(md.includes('my-unique-goal'));
  });

  it('includes elevated vision', () => {
    const md = formatCEOReviewSection(makeResult({ elevatedVision: 'Elevated platform vision' }));
    assert.ok(md.includes('Elevated platform vision'));
  });

  it('includes challenging questions', () => {
    const md = formatCEOReviewSection(makeResult({ challengingQuestions: ['Why build this?'] }));
    assert.ok(md.includes('Why build this?'));
  });

  it('includes ten star version', () => {
    const md = formatCEOReviewSection(makeResult({ tenStarVersion: 'Perfect 10-star product' }));
    assert.ok(md.includes('Perfect 10-star product'));
  });

  it('shows ambiguity signals when present', () => {
    const md = formatCEOReviewSection(makeResult({ ambiguitySignalsFound: ['maybe', 'TBD'] }));
    assert.ok(md.includes('maybe') || md.includes('TBD'));
  });

  it('mentions auto-triggered when true', () => {
    const md = formatCEOReviewSection(makeResult({ wasAutoTriggered: true }));
    assert.ok(md.toLowerCase().includes('auto'));
  });

  it('returns non-empty string', () => {
    const md = formatCEOReviewSection(makeResult());
    assert.ok(md.length > 0);
  });
});
