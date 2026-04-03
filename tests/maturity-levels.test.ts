// Maturity Levels — 15 tests for level definitions and lookup functions

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  type MaturityLevel,
  MATURITY_NAMES,
  MATURITY_USE_CASES,
  MATURITY_PLAIN_LANG,
  MATURITY_CRITERIA,
  scoreToMaturityLevel,
  describeLevelForFounders,
  getMaturityLevelName,
  getMaturityUseCase,
  getMaturityCriteria,
} from '../src/core/maturity-levels.js';

describe('maturity-levels', () => {
  describe('scoreToMaturityLevel', () => {
    it('returns 1 (Sketch) for score 0', () => {
      assert.equal(scoreToMaturityLevel(0), 1);
    });

    it('returns 1 (Sketch) for score 20', () => {
      assert.equal(scoreToMaturityLevel(20), 1);
    });

    it('returns 2 (Prototype) for score 21', () => {
      assert.equal(scoreToMaturityLevel(21), 2);
    });

    it('returns 2 (Prototype) for score 40', () => {
      assert.equal(scoreToMaturityLevel(40), 2);
    });

    it('returns 3 (Alpha) for score 41', () => {
      assert.equal(scoreToMaturityLevel(41), 3);
    });

    it('returns 3 (Alpha) for score 60', () => {
      assert.equal(scoreToMaturityLevel(60), 3);
    });

    it('returns 4 (Beta) for score 61', () => {
      assert.equal(scoreToMaturityLevel(61), 4);
    });

    it('returns 4 (Beta) for score 75', () => {
      assert.equal(scoreToMaturityLevel(75), 4);
    });

    it('returns 5 (Customer-Ready) for score 76', () => {
      assert.equal(scoreToMaturityLevel(76), 5);
    });

    it('returns 5 (Customer-Ready) for score 88', () => {
      assert.equal(scoreToMaturityLevel(88), 5);
    });

    it('returns 6 (Enterprise-Grade) for score 89', () => {
      assert.equal(scoreToMaturityLevel(89), 6);
    });

    it('returns 6 (Enterprise-Grade) for score 100', () => {
      assert.equal(scoreToMaturityLevel(100), 6);
    });
  });

  describe('describeLevelForFounders', () => {
    it('returns plain language description for all 6 levels', () => {
      const level1 = describeLevelForFounders(1);
      assert.ok(level1.includes('proves the idea works'));

      const level2 = describeLevelForFounders(2);
      assert.ok(level2.includes('show investors'));

      const level3 = describeLevelForFounders(3);
      assert.ok(level3.includes('team to use daily'));

      const level4 = describeLevelForFounders(4);
      assert.ok(level4.includes('early customers'));

      const level5 = describeLevelForFounders(5);
      assert.ok(level5.includes('paying customers'));

      const level6 = describeLevelForFounders(6);
      assert.ok(level6.includes('Fortune 500'));
    });
  });

  describe('lookup functions', () => {
    it('getMaturityLevelName returns correct names', () => {
      assert.equal(getMaturityLevelName(1), 'Sketch');
      assert.equal(getMaturityLevelName(2), 'Prototype');
      assert.equal(getMaturityLevelName(3), 'Alpha');
      assert.equal(getMaturityLevelName(4), 'Beta');
      assert.equal(getMaturityLevelName(5), 'Customer-Ready');
      assert.equal(getMaturityLevelName(6), 'Enterprise-Grade');
    });

    it('getMaturityUseCase returns correct use cases', () => {
      assert.equal(getMaturityUseCase(1), 'Demo to co-founder');
      assert.equal(getMaturityUseCase(2), 'Show investors');
      assert.equal(getMaturityUseCase(3), 'Internal team use');
      assert.equal(getMaturityUseCase(4), 'Paid beta customers');
      assert.equal(getMaturityUseCase(5), 'Production launch');
      assert.equal(getMaturityUseCase(6), 'Fortune 500 contracts');
    });

    it('getMaturityCriteria returns full criteria object', () => {
      const criteria = getMaturityCriteria(4);
      assert.equal(criteria.level, 4);
      assert.equal(criteria.name, 'Beta');
      assert.equal(criteria.minScore, 61);
      assert.equal(criteria.maxScore, 75);
      assert.ok(criteria.functionality.includes('Graceful degradation'));
      assert.ok(criteria.testing.includes('80%'));
      assert.ok(criteria.security.includes('HTTPS'));
    });
  });
});
