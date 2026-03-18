// PDSE Config tests — validate scoring constants, checklists, weights
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  SECTION_CHECKLISTS,
  AMBIGUITY_WORDS,
  ANTI_STUB_PATTERNS,
  DIMENSION_WEIGHTS,
  SCORE_THRESHOLDS,
  CONSTITUTION_KEYWORDS,
  UPSTREAM_DEPENDENCY_MAP,
  ARTIFACT_COMMAND_MAP,
  type ScoredArtifact,
} from '../src/core/pdse-config.js';

describe('PDSE Config', () => {
  describe('SECTION_CHECKLISTS', () => {
    it('has entries for all 5 artifacts', () => {
      const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
      for (const a of artifacts) {
        assert.ok(Array.isArray(SECTION_CHECKLISTS[a]), `Missing checklist for ${a}`);
        assert.ok(SECTION_CHECKLISTS[a].length > 0, `Empty checklist for ${a}`);
      }
    });

    it('SPEC has at least 4 required sections', () => {
      assert.ok(SECTION_CHECKLISTS.SPEC.length >= 4);
    });
  });

  describe('DIMENSION_WEIGHTS', () => {
    it('sum to exactly 100', () => {
      const sum = DIMENSION_WEIGHTS.completeness +
        DIMENSION_WEIGHTS.clarity +
        DIMENSION_WEIGHTS.testability +
        DIMENSION_WEIGHTS.constitutionAlignment +
        DIMENSION_WEIGHTS.integrationFitness +
        DIMENSION_WEIGHTS.freshness;
      assert.strictEqual(sum, 100);
    });
  });

  describe('AMBIGUITY_WORDS', () => {
    it('has at least 10 entries', () => {
      assert.ok(AMBIGUITY_WORDS.length >= 10, `Only ${AMBIGUITY_WORDS.length} entries`);
    });

    it('includes common ambiguity signals', () => {
      assert.ok(AMBIGUITY_WORDS.includes('should'));
      assert.ok(AMBIGUITY_WORDS.includes('maybe'));
      assert.ok(AMBIGUITY_WORDS.includes('TBD'));
    });
  });

  describe('ANTI_STUB_PATTERNS', () => {
    it('has at least 25 entries', () => {
      assert.ok(ANTI_STUB_PATTERNS.length >= 25, `Only ${ANTI_STUB_PATTERNS.length} entries`);
    });

    it('includes critical anti-stub string markers', () => {
      const strings = ANTI_STUB_PATTERNS.filter((p): p is string => typeof p === 'string');
      const hasPattern = (target: string) => strings.some(s => s.toLowerCase() === target.toLowerCase());
      assert.ok(hasPattern('TODO'), 'Missing TODO');
      assert.ok(hasPattern('FIXME'), 'Missing FIXME');
      assert.ok(hasPattern('stub'), 'Missing stub');
      assert.ok(hasPattern('placeholder'), 'Missing placeholder');
    });

    it('all string patterns are lowercase-safe (no runtime crash on .toLowerCase())', () => {
      const strings = ANTI_STUB_PATTERNS.filter((p): p is string => typeof p === 'string');
      for (const s of strings) {
        assert.strictEqual(typeof s.toLowerCase(), 'string', `Pattern "${s}" fails toLowerCase()`);
      }
    });

    it('all RegExp patterns are valid', () => {
      const regexps = ANTI_STUB_PATTERNS.filter((p): p is RegExp => p instanceof RegExp);
      assert.ok(regexps.length > 0, 'Expected at least one RegExp pattern');
      for (const r of regexps) {
        assert.ok(r instanceof RegExp, `Pattern ${r} is not a valid RegExp`);
        // Verify the regex can execute without throwing
        assert.strictEqual(typeof r.test('sample text'), 'boolean');
      }
    });

    it('contains both strings and RegExps', () => {
      const strings = ANTI_STUB_PATTERNS.filter((p): p is string => typeof p === 'string');
      const regexps = ANTI_STUB_PATTERNS.filter((p): p is RegExp => p instanceof RegExp);
      assert.ok(strings.length > 0, 'Expected at least one string pattern');
      assert.ok(regexps.length > 0, 'Expected at least one RegExp pattern');
    });

    it('regex patterns detect expected code smells', () => {
      const regexps = ANTI_STUB_PATTERNS.filter((p): p is RegExp => p instanceof RegExp);
      const matchesAny = (text: string) => regexps.some(r => r.test(text));

      assert.ok(matchesAny('const x = value as any;'), 'Should detect "as any"');
      assert.ok(matchesAny('// @ts-ignore'), 'Should detect @ts-ignore');
      assert.ok(matchesAny('// @ts-expect-error'), 'Should detect @ts-expect-error');
      assert.ok(matchesAny('throw new NotImplementedError()'), 'Should detect NotImplementedError');
      assert.ok(matchesAny('// not implemented yet'), 'Should detect "not implemented"');
      assert.ok(matchesAny('Coming Soon!'), 'Should detect "coming soon"');
      assert.ok(matchesAny("throw new Error('TODO: finish this')"), 'Should detect TODO errors');
      assert.ok(matchesAny('// XXX fix later'), 'Should detect xxx marker');
      assert.ok(matchesAny('// HACK: workaround for bug'), 'Should detect hack');
      assert.ok(matchesAny('// temporary fix'), 'Should detect temporary');
      assert.ok(matchesAny('console.log("debug payload")'), 'Should detect debug logging');
    });
  });

  describe('SCORE_THRESHOLDS', () => {
    it('has thresholds in correct order', () => {
      assert.ok(SCORE_THRESHOLDS.EXCELLENT > SCORE_THRESHOLDS.ACCEPTABLE);
      assert.ok(SCORE_THRESHOLDS.ACCEPTABLE > SCORE_THRESHOLDS.NEEDS_WORK);
      assert.ok(SCORE_THRESHOLDS.NEEDS_WORK > 0);
    });
  });

  describe('CONSTITUTION_KEYWORDS', () => {
    it('has at least 5 entries', () => {
      assert.ok(CONSTITUTION_KEYWORDS.length >= 5, `Only ${CONSTITUTION_KEYWORDS.length} entries`);
    });
  });

  describe('UPSTREAM_DEPENDENCY_MAP', () => {
    it('CONSTITUTION has no upstream dependencies', () => {
      assert.strictEqual(UPSTREAM_DEPENDENCY_MAP.CONSTITUTION.length, 0);
    });

    it('SPEC depends on CONSTITUTION', () => {
      assert.ok(UPSTREAM_DEPENDENCY_MAP.SPEC.includes('CONSTITUTION'));
    });

    it('PLAN depends on SPEC and CLARIFY', () => {
      assert.ok(UPSTREAM_DEPENDENCY_MAP.PLAN.includes('SPEC'));
      assert.ok(UPSTREAM_DEPENDENCY_MAP.PLAN.includes('CLARIFY'));
    });

    it('TASKS depends on PLAN', () => {
      assert.ok(UPSTREAM_DEPENDENCY_MAP.TASKS.includes('PLAN'));
    });
  });

  describe('ARTIFACT_COMMAND_MAP', () => {
    it('has commands for all 5 artifacts', () => {
      const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
      for (const a of artifacts) {
        assert.ok(typeof ARTIFACT_COMMAND_MAP[a] === 'string', `Missing command for ${a}`);
        assert.ok(ARTIFACT_COMMAND_MAP[a].length > 0, `Empty command for ${a}`);
      }
    });
  });
});
