// Tests for classifyOutcomeKind quality caps and derived-score enforcement.
// Doctrine: shell npm/jest test outcomes cap at T4 (7.0), not T5 (8.0).
// Runtime-exec/cli-smoke/e2e-workflow outcomes unlock T5+ normally.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOutcomeKind, validateOutcomeQuality, isStructuralFileCheck } from '../src/matrix/engines/outcome-quality.js';
import { computeDerivedScore, type DimensionForScoring } from '../src/core/derived-score.js';
import { TIER_SCORE_CAPS } from '../src/matrix/types/capability-test.js';
import {
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidence,
  type OutcomeEvidenceEntry,
} from '../src/matrix/types/outcome.js';

function makeShellOutcome(id: string, tier: Outcome['tier'], command: string): Outcome {
  return { id, tier, description: `outcome ${id}`, command, kind: 'shell' };
}

function makeRuntimeOutcome(id: string, tier: Outcome['tier'], command: string): Outcome {
  return { id, tier, description: `outcome ${id}`, command, kind: 'runtime-exec' };
}

function makeEntry(outcomeId: string, tier: Outcome['tier'], passed: boolean): OutcomeEvidenceEntry {
  return {
    dimensionId: 'test', outcomeId, tier, gitSha: 'abc',
    passed, exitCode: passed ? 0 : 1, durationMs: 5000,
    stdoutTail: 'ok', stderrTail: '', ranAt: new Date().toISOString(), evidencePath: '/fake',
  };
}

function makeEvidenceMap(entries: OutcomeEvidenceEntry[]): OutcomeEvidence {
  const map: OutcomeEvidence = new Map();
  for (const e of entries) map.set(makeEvidenceKey(e.dimensionId, e.outcomeId), e);
  return map;
}

describe('classifyOutcomeKind — quality caps', () => {
  it('npx tsx --test shell outcome caps at T4 (7.0)', () => {
    const { maxScore } = classifyOutcomeKind(makeShellOutcome('a', 'T5', 'npx tsx --test tests/foo.test.ts'));
    assert.equal(maxScore, 7.0);
  });

  it('npm test shell outcome caps at T4 (7.0)', () => {
    const { maxScore } = classifyOutcomeKind(makeShellOutcome('a', 'T5', 'npm test'));
    assert.equal(maxScore, 7.0);
  });

  it('npm run test shell outcome caps at T4 (7.0)', () => {
    const { maxScore } = classifyOutcomeKind(makeShellOutcome('a', 'T5', 'npm run test -- --reporter tap'));
    assert.equal(maxScore, 7.0);
  });

  it('jest shell outcome caps at T4 (7.0)', () => {
    const { maxScore } = classifyOutcomeKind(makeShellOutcome('a', 'T5', 'jest --coverage'));
    assert.equal(maxScore, 7.0);
  });

  it('runtime-exec npx-tsx-test unlocks T5 (9.0 cap)', () => {
    const { maxScore } = classifyOutcomeKind(makeRuntimeOutcome('a', 'T5', 'npx tsx --test tests/foo.test.ts'));
    assert.equal(maxScore, 9.0);
  });

  it('cli-smoke caps at T6 (8.5)', () => {
    const outcome: Outcome = { id: 'smoke', tier: 'T5', description: 'smoke', kind: 'cli-smoke', cli_args: ['validate'] };
    assert.equal(classifyOutcomeKind(outcome).maxScore, 8.5);
  });
});

// Regression: the build loop mislabels a `readFileSync(...).includes(...)` file-existence
// check as kind:'runtime-exec' to escape the structural-check cap and reach 9.0. This is
// the exact mechanism behind the recurring "inflated 9s collapse to 6s" audit finding.
// The cap must follow the COMMAND, not the trusted declared kind.
describe('classifyOutcomeKind — runtime-exec/e2e cannot launder a structural file check', () => {
  const fileCheck = `node -e "const c=require('fs').readFileSync('src/foo.ts','utf8');if(!c.includes('bar'))process.exit(1)"`;

  it('isStructuralFileCheck flags a bare readFileSync one-liner', () => {
    assert.equal(isStructuralFileCheck(fileCheck), true);
  });

  it('isStructuralFileCheck exempts a command that also spawns the built CLI', () => {
    assert.equal(isStructuralFileCheck(`node dist/index.js validate && node -e "require('fs').readFileSync('out.json')"`), false);
  });

  it('runtime-exec readFileSync one-liner is capped at 7.0 (was 9.0 — the bypass)', () => {
    const { maxScore, evidenceTier } = classifyOutcomeKind(makeRuntimeOutcome('a', 'T5', fileCheck));
    assert.equal(maxScore, 7.0);
    assert.equal(evidenceTier, 'file-existence');
  });

  it('e2e-workflow readFileSync one-liner is also capped at 7.0', () => {
    const outcome: Outcome = { id: 'a', tier: 'T7', description: 'd', kind: 'e2e-workflow', command: fileCheck } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(outcome).maxScore, 7.0);
  });

  it('a genuine runtime-exec that spawns the CLI keeps its 9.0 ceiling', () => {
    const { maxScore } = classifyOutcomeKind(makeRuntimeOutcome('a', 'T5', 'node dist/index.js validate testing'));
    assert.equal(maxScore, 9.0);
  });

  it('T5 runtime-exec readFileSync one-liner does NOT unlock T5 (derived score 0)', () => {
    const dim: DimensionForScoring = { id: 'test', outcomes: [makeRuntimeOutcome('t5', 'T5', fileCheck)] };
    const evidence = makeEvidenceMap([makeEntry('t5', 'T5', true)]);
    assert.equal(computeDerivedScore(dim, evidence), 0, 'mislabeled structural check is quality-capped → 0');
  });

  it('validateOutcomeQuality rejects a T5 runtime-exec structural check', () => {
    const errs = validateOutcomeQuality(makeRuntimeOutcome('t5', 'T5', fileCheck), makeEntry('t5', 'T5', true));
    assert.ok(errs.some(e => /structural file check/.test(e.reason)), 'must flag the mislabeled structural check at T5+');
  });
});

describe('derived score — quality cap enforcement', () => {
  it('T5 shell npx-tsx-test does NOT unlock T5 cap', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeShellOutcome('t5', 'T5', 'npx tsx --test tests/foo.test.ts')],
    };
    const evidence = makeEvidenceMap([makeEntry('t5', 'T5', true)]);
    assert.equal(computeDerivedScore(dim, evidence), 0, 'shell npm-test at T5 is quality-capped → 0');
  });

  it('T5 runtime-exec npx-tsx-test DOES unlock T5 cap', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeRuntimeOutcome('t5', 'T5', 'npx tsx --test tests/foo.test.ts')],
    };
    const evidence = makeEvidenceMap([makeEntry('t5', 'T5', true)]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T5);
  });

  it('shell npm-test at T4 is allowed (cap equals T4)', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeShellOutcome('t4', 'T4', 'npx tsx --test tests/foo.test.ts')],
    };
    const evidence = makeEvidenceMap([makeEntry('t4', 'T4', true)]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T4);
  });

  it('mix: T4 shell passes + T5 shell blocked → T4 cap', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [
        makeShellOutcome('t4', 'T4', 'npx tsx --test tests/t4.test.ts'),
        makeShellOutcome('t5', 'T5', 'npx tsx --test tests/t5.test.ts'),
      ],
    };
    const evidence = makeEvidenceMap([makeEntry('t4', 'T4', true), makeEntry('t5', 'T5', true)]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T4);
  });

  it('mix: T4 shell passes + T5 runtime-exec passes → T5 cap', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [
        makeShellOutcome('t4', 'T4', 'npx tsx --test tests/t4.test.ts'),
        makeRuntimeOutcome('t5', 'T5', 'npx tsx --test tests/t5.test.ts'),
      ],
    };
    const evidence = makeEvidenceMap([makeEntry('t4', 'T4', true), makeEntry('t5', 'T5', true)]);
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T5);
  });
});
