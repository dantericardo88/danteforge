// CEO Review Engine tests — ambiguity detection, auto-trigger, formatting
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectAmbiguitySignals,
  shouldAutoCEOReview,
  formatCEOReviewSection,
  AMBIGUITY_SIGNALS,
  type CEOReviewResult,
} from '../src/core/ceo-review-engine.js';

describe('detectAmbiguitySignals', () => {
  it('detects common ambiguity words', () => {
    const signals = detectAmbiguitySignals('I maybe want to build something that could work');
    assert.ok(signals.includes('maybe'));
    assert.ok(signals.includes('something'));
    assert.ok(signals.includes('could'));
  });

  it('returns empty array for unambiguous text', () => {
    const signals = detectAmbiguitySignals('Build a REST API with JWT authentication and PostgreSQL');
    assert.strictEqual(signals.length, 0);
  });

  it('is case insensitive', () => {
    const signals = detectAmbiguitySignals('MAYBE we should PROBABLY do SOMETHING');
    assert.ok(signals.length >= 3);
  });

  it('detects TBD', () => {
    const signals = detectAmbiguitySignals('The database choice is TBD');
    assert.ok(signals.includes('TBD'));
  });
});

describe('shouldAutoCEOReview', () => {
  it('returns true for >= 3 ambiguity signals', () => {
    assert.strictEqual(
      shouldAutoCEOReview('I maybe want to build something that could work somehow'),
      true,
    );
  });

  it('returns false for < 3 ambiguity signals', () => {
    assert.strictEqual(
      shouldAutoCEOReview('Build a login system with OAuth'),
      false,
    );
  });

  it('returns false for unambiguous goals', () => {
    assert.strictEqual(
      shouldAutoCEOReview('Implement user registration with email verification'),
      false,
    );
  });
});

describe('AMBIGUITY_SIGNALS', () => {
  it('has at least 10 entries', () => {
    assert.ok(AMBIGUITY_SIGNALS.length >= 10);
  });

  it('includes key terms from PRD', () => {
    const signalSet = new Set(AMBIGUITY_SIGNALS.map(s => s.toLowerCase()));
    assert.ok(signalSet.has('something'));
    assert.ok(signalSet.has('maybe'));
    assert.ok(signalSet.has('probably'));
    assert.ok(signalSet.has('might'));
  });
});

describe('formatCEOReviewSection', () => {
  it('produces markdown with ## CEO Review Notes header', () => {
    const result: CEOReviewResult = {
      originalGoal: 'Build a login page',
      elevatedVision: 'A world-class auth system',
      challengingQuestions: ['Why login and not SSO?', 'What about passwordless?'],
      tenStarVersion: 'Seamless, secure, delightful authentication',
      ambiguitySignalsFound: [],
      wasAutoTriggered: false,
    };
    const md = formatCEOReviewSection(result);
    assert.ok(md.includes('## CEO Review Notes'));
    assert.ok(md.includes('Build a login page'));
    assert.ok(md.includes('world-class auth'));
    assert.ok(md.includes('Why login and not SSO?'));
    assert.ok(md.includes('10-Star Version'));
  });

  it('includes auto-trigger note when applicable', () => {
    const result: CEOReviewResult = {
      originalGoal: 'Maybe build something',
      elevatedVision: 'Elevated',
      challengingQuestions: [],
      tenStarVersion: '10-star',
      ambiguitySignalsFound: ['maybe', 'something'],
      wasAutoTriggered: true,
    };
    const md = formatCEOReviewSection(result);
    assert.ok(md.includes('auto-triggered'));
    assert.ok(md.includes('maybe, something'));
  });

  it('omits ambiguity section when no signals found', () => {
    const result: CEOReviewResult = {
      originalGoal: 'Build X',
      elevatedVision: 'Better X',
      challengingQuestions: [],
      tenStarVersion: '10-star X',
      ambiguitySignalsFound: [],
      wasAutoTriggered: false,
    };
    const md = formatCEOReviewSection(result);
    assert.ok(!md.includes('Ambiguity signals'));
  });
});
