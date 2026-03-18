// Engine Contract Validation — ensures DanteForge <-> DanteForgeEngine <-> DanteCode
// contract stays in sync: required exports, PDSE config coverage, scoring thresholds.
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DIMENSION_WEIGHTS,
  ANTI_STUB_PATTERNS,
  SCORE_THRESHOLDS,
  ARTIFACT_COMMAND_MAP,
  UPSTREAM_DEPENDENCY_MAP,
  SECTION_CHECKLISTS,
  type ScoredArtifact,
} from '../src/core/pdse-config.js';

// All five artifact keys that ScoredArtifact can take
const ALL_ARTIFACTS: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

// Parse the requiredExports array from sync-dantecode.mjs at test time
function parseRequiredExports(): string[] {
  const syncScript = readFileSync(
    resolve('scripts/sync-dantecode.mjs'),
    'utf-8',
  );
  // Extract the array literal between `requiredExports = [` and `];`
  const match = syncScript.match(/requiredExports\s*=\s*\[([\s\S]*?)\];/);
  assert.ok(match, 'Could not find requiredExports array in sync-dantecode.mjs');
  const entries = match![1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => s.length > 0);
  return entries;
}

describe('Engine Contract', () => {
  // ── Test 1: sync-dantecode required exports list is complete ──────────
  describe('sync-dantecode required exports', () => {
    it('contains all expected engine exports', () => {
      const exports = parseRequiredExports();

      // These are the canonical engine exports that DanteCode relies on
      const expectedMinimum = [
        'runAntiStubScanner',
        'runConstitutionCheck',
        'runLocalPDSEScorer',
        'recordSuccessPattern',
        'queryLessons',
        'formatLessonsForPrompt',
        'recordLesson',
        'recordPreference',
      ];

      for (const name of expectedMinimum) {
        assert.ok(
          exports.includes(name),
          `Missing required export "${name}" in sync-dantecode.mjs requiredExports`,
        );
      }
    });

    it('has at least 8 required exports', () => {
      const exports = parseRequiredExports();
      assert.ok(
        exports.length >= 8,
        `Expected at least 8 required exports, found ${exports.length}`,
      );
    });
  });

  // ── Test 2: PDSE dimension weights sum to exactly 100 ─────────────────
  describe('PDSE dimension weights', () => {
    it('sum to exactly 100', () => {
      const sum = Object.values(DIMENSION_WEIGHTS).reduce(
        (acc: number, v: number) => acc + v,
        0,
      );
      assert.strictEqual(
        sum,
        100,
        `Dimension weights sum to ${sum}, expected 100`,
      );
    });
  });

  // ── Test 3: Anti-stub patterns include critical markers ───────────────
  describe('anti-stub patterns', () => {
    it('includes critical markers (TODO, FIXME, stub, placeholder, tbd)', () => {
      const critical = ['TODO', 'FIXME', 'stub', 'placeholder', 'tbd'];
      for (const marker of critical) {
        assert.ok(
          ANTI_STUB_PATTERNS.includes(marker),
          `ANTI_STUB_PATTERNS is missing critical marker "${marker}"`,
        );
      }
    });
  });

  // ── Test 4: If Engine dist exists, validate actual exports match ──────
  describe('DanteForgeEngine dist contract', () => {
    const engineDtsPath = resolve('C:/Projects/DanteForgeEngine/dist/index.d.ts');
    const engineExists = existsSync(engineDtsPath);

    it(`validates actual exports match contract (engine ${engineExists ? 'found' : 'not found — skip'})`, { skip: !engineExists }, () => {
      const dtsContent = readFileSync(engineDtsPath, 'utf-8');
      const requiredExports = parseRequiredExports();

      const missing: string[] = [];
      for (const name of requiredExports) {
        if (!dtsContent.includes(name)) {
          missing.push(name);
        }
      }

      assert.strictEqual(
        missing.length,
        0,
        `Engine .d.ts is missing exports: ${missing.join(', ')}`,
      );
    });
  });

  // ── Test 5: ARTIFACT_COMMAND_MAP covers all ScoredArtifact values ─────
  describe('ARTIFACT_COMMAND_MAP coverage', () => {
    it('has a non-empty command for every ScoredArtifact', () => {
      for (const artifact of ALL_ARTIFACTS) {
        const cmd = ARTIFACT_COMMAND_MAP[artifact];
        assert.ok(
          typeof cmd === 'string' && cmd.length > 0,
          `ARTIFACT_COMMAND_MAP is missing or empty for "${artifact}"`,
        );
      }
    });
  });

  // ── Test 6: UPSTREAM_DEPENDENCY_MAP covers all ScoredArtifact values ──
  describe('UPSTREAM_DEPENDENCY_MAP coverage', () => {
    it('has an entry for every ScoredArtifact', () => {
      for (const artifact of ALL_ARTIFACTS) {
        const deps = UPSTREAM_DEPENDENCY_MAP[artifact];
        assert.ok(
          Array.isArray(deps),
          `UPSTREAM_DEPENDENCY_MAP is missing entry for "${artifact}"`,
        );
      }
    });

    it('only references valid ScoredArtifact values as dependencies', () => {
      for (const artifact of ALL_ARTIFACTS) {
        for (const dep of UPSTREAM_DEPENDENCY_MAP[artifact]) {
          assert.ok(
            ALL_ARTIFACTS.includes(dep),
            `UPSTREAM_DEPENDENCY_MAP["${artifact}"] references unknown artifact "${dep}"`,
          );
        }
      }
    });
  });

  // ── Test 7: SECTION_CHECKLISTS covers all ScoredArtifact values ───────
  describe('SECTION_CHECKLISTS coverage', () => {
    it('has a non-empty checklist for every ScoredArtifact', () => {
      for (const artifact of ALL_ARTIFACTS) {
        const checklist = SECTION_CHECKLISTS[artifact];
        assert.ok(
          Array.isArray(checklist) && checklist.length > 0,
          `SECTION_CHECKLISTS is missing or empty for "${artifact}"`,
        );
      }
    });
  });

  // ── Test 8: Scoring thresholds are ordered correctly ──────────────────
  describe('scoring thresholds ordering', () => {
    it('EXCELLENT > ACCEPTABLE > NEEDS_WORK > 0', () => {
      assert.ok(
        SCORE_THRESHOLDS.EXCELLENT > SCORE_THRESHOLDS.ACCEPTABLE,
        `EXCELLENT (${SCORE_THRESHOLDS.EXCELLENT}) must be > ACCEPTABLE (${SCORE_THRESHOLDS.ACCEPTABLE})`,
      );
      assert.ok(
        SCORE_THRESHOLDS.ACCEPTABLE > SCORE_THRESHOLDS.NEEDS_WORK,
        `ACCEPTABLE (${SCORE_THRESHOLDS.ACCEPTABLE}) must be > NEEDS_WORK (${SCORE_THRESHOLDS.NEEDS_WORK})`,
      );
      assert.ok(
        SCORE_THRESHOLDS.NEEDS_WORK > 0,
        `NEEDS_WORK (${SCORE_THRESHOLDS.NEEDS_WORK}) must be > 0`,
      );
    });

    it('all thresholds are within valid score range (0-100)', () => {
      for (const [name, value] of Object.entries(SCORE_THRESHOLDS)) {
        assert.ok(value > 0 && value <= 100, `Threshold ${name} = ${value} is outside valid range (0, 100]`);
      }
    });
  });
});
