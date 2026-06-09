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

  it('a TEST RUNNER caps at T4/7.0 even when labeled runtime-exec (harsh-consistent: the kind label gives no +1.0 bonus)', () => {
    const { maxScore } = classifyOutcomeKind(makeRuntimeOutcome('a', 'T5', 'npx tsx --test tests/foo.test.ts'));
    assert.equal(maxScore, 7.0);
  });

  it('a runtime-exec NON-test (real product run) without input_source caps at T5/8.0', () => {
    const { maxScore } = classifyOutcomeKind(makeRuntimeOutcome('a', 'T5', 'node dist/index.js validate --all'));
    assert.equal(maxScore, 8.0);
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

  it('a runtime-exec that spawns the CLI with declared real-user-path keeps its 9.0 ceiling', () => {
    const o = { id: 'a', tier: 'T7', description: 'd', kind: 'runtime-exec', command: 'node dist/index.js validate testing', input_source: { type: 'real-user-path', description: 'user runs validate' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 9.0);
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

// The linchpin: high tiers structurally require declared provenance (input_source).
// This is what stops undeclared/mislabeled evidence from reaching 9.0/9.5 — the level
// where every harsh audit found inflation.
describe('classifyOutcomeKind — input_source provenance gates the frontier', () => {
  function withSource(base: Outcome, source: unknown): Outcome {
    return { ...base, input_source: source } as unknown as Outcome;
  }

  it('runtime-exec + real-user-path → 9.0', () => {
    const o = withSource(makeRuntimeOutcome('a', 'T7', 'node dist/index.js go'), { type: 'real-user-path', description: 'user runs go' });
    assert.equal(classifyOutcomeKind(o).maxScore, 9.0);
  });

  it('runtime-exec + synthetic-fixture → 7.0 (declared agent data caps)', () => {
    const o = withSource(makeRuntimeOutcome('a', 'T7', 'node dist/index.js go'), { type: 'synthetic-fixture', fixture_id: 'f1' });
    assert.equal(classifyOutcomeKind(o).maxScore, 7.0);
  });

  it('e2e-workflow + synthetic-fixture → 7.0 (overrides the e2e ceiling)', () => {
    const o = { id: 'a', tier: 'T7', description: 'd', kind: 'e2e-workflow', command: 'node dist/index.js flow', input_source: { type: 'synthetic-fixture' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 7.0);
  });

  it('external-benchmark kind + registered suite via input_source → 9.5', () => {
    const o = { id: 'a', tier: 'T8', description: 'd', kind: 'external-benchmark', benchmark: 'swe-bench', min_pass_rate: 0.4, command: 'run', input_source: { type: 'external-benchmark', suite: 'swe-bench' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 9.5);
  });

  it('external-benchmark kind + registered `benchmark` field (back-compat) → 9.5', () => {
    const o = { id: 'a', tier: 'T8', description: 'd', kind: 'external-benchmark', benchmark: 'exercism', min_pass_rate: 0.4, command: 'run' } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 9.5);
  });

  it('external-benchmark kind + UNREGISTERED suite does NOT reach 9.5', () => {
    const o = { id: 'a', tier: 'T8', description: 'd', kind: 'external-benchmark', benchmark: 'my-homemade-suite', min_pass_rate: 0.4, command: 'run', input_source: { type: 'external-benchmark', suite: 'my-homemade-suite' } } as unknown as Outcome;
    assert.notEqual(classifyOutcomeKind(o).maxScore, 9.5);
  });

  it('command containing "benchmark --suite" no longer auto-earns 9.5 (regex path removed)', () => {
    const o = makeRuntimeOutcome('a', 'T7', 'node -e "console.log(\'benchmark --suite pass\')"');
    assert.notEqual(classifyOutcomeKind(o).maxScore, 9.5);
  });

  it('a test-runner relabeled runtime-exec + real-user-path caps at T4/7.0 (harsh-consistent — a test is never 8.0+)', () => {
    // A test runner proves isolation, not production behavior — no kind/input_source relabel earns it
    // 8.0+. 8.0 requires a real product run; only a non-test real-user-path run reaches 9.0.
    const o = { id: 'a', tier: 'T7', description: 'd', kind: 'runtime-exec', command: 'npx tsx --test tests/e2e.test.ts', input_source: { type: 'real-user-path', description: 'claims e2e' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 7.0);
  });

  it('running the real product (node dist/index.js) + real-user-path reaches 9.0', () => {
    const o = { id: 'a', tier: 'T7', description: 'd', kind: 'runtime-exec', command: 'node dist/index.js forge --project fixtures/sample', input_source: { type: 'real-user-path', description: 'runs forge on a real sample' } } as unknown as Outcome;
    assert.equal(classifyOutcomeKind(o).maxScore, 9.0);
  });

  it('min_duration_ms is enforced for T5+: a sub-floor duration fails quality', () => {
    const outcome = { ...makeRuntimeOutcome('t5', 'T5', 'node dist/index.js go'), min_duration_ms: 5000, input_source: { type: 'real-user-path', description: 'x' } } as unknown as Outcome;
    const fastEntry = { ...makeEntry('t5', 'T5', true), durationMs: 40 };
    const errs = validateOutcomeQuality(outcome, fastEntry);
    assert.ok(errs.some(e => /min_duration_ms/.test(e.reason)), 'instant T5 receipt must fail the duration floor');
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

  it('T5 runtime-exec npx-tsx-test does NOT unlock T5 — a test caps at T4 regardless of kind (harsh-consistent)', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeRuntimeOutcome('t5', 'T5', 'npx tsx --test tests/foo.test.ts')],
    };
    const evidence = makeEvidenceMap([makeEntry('t5', 'T5', true)]);
    // Quality-excluded at T5 (a test suite only supports T4/7.0) — exactly like the kind:shell case;
    // the runtime-exec label no longer buys a +1.0 bonus.
    assert.ok(computeDerivedScore(dim, evidence) < TIER_SCORE_CAPS.T5);
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

  it('mix: T4 shell passes + T5 runtime-exec TEST passes → T4 cap (the T5 test is quality-excluded regardless of kind)', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [
        makeShellOutcome('t4', 'T4', 'npx tsx --test tests/t4.test.ts'),
        makeRuntimeOutcome('t5', 'T5', 'npx tsx --test tests/t5.test.ts'),
      ],
    };
    const evidence = makeEvidenceMap([makeEntry('t4', 'T4', true), makeEntry('t5', 'T5', true)]);
    // The T5 runtime-exec test is now excluded (a test caps at T4) — same as the shell case above.
    assert.equal(computeDerivedScore(dim, evidence), TIER_SCORE_CAPS.T4);
  });
});
