// effective-evidence-tier.test.ts
//
// Pins the fix for the "passing dimension collapses one day after validate" bug:
// an over-declared outcome (e.g. a test-suite command declared T6) was SCORED at
// its demoted tier T4 (14-day freshness window, derived-score.ts) but its receipt
// was stamped with the DECLARED tier, so loadOutcomeEvidence dropped it after the
// declared T6's 24-hour window. Result: `danteforge gap testing` read
// "Tier T4: 1/3 passing (2 failing)" with every test green and no code change.
//
// The fix: receipts are stamped with effectiveEvidenceTier (the same demotion
// derived-score applies), with the declared tier preserved as declaredTier
// provenance — load-time decay and scoring-time decay now use the SAME window.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveEvidenceTier,
  highestTierWithinCap,
} from '../src/matrix/engines/outcome-quality.js';
import { runOneOutcome, loadOutcomeEvidence } from '../src/matrix/engines/outcome-runner.js';
import { computeDerivedScoreWithBreakdown } from '../src/core/derived-score.js';
import {
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidenceEntry,
  type RuntimeExecOutcome,
} from '../src/matrix/types/outcome.js';
import type { CapabilityTier } from '../src/matrix/types/capability-test.js';

const SHA = 'f'.repeat(40);
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function testSuiteOutcome(id: string, tier: CapabilityTier, file: string): RuntimeExecOutcome {
  return {
    id,
    tier,
    kind: 'runtime-exec',
    description: `test-suite outcome at declared ${tier}`,
    command: `npx tsx --test ${file}`,
    expected_exit: 0,
    timeout_ms: 60000,
  };
}

describe('effectiveEvidenceTier — demotion target shared with derived-score', () => {
  test('test-suite command declared T6 demotes to T4 (quality cap 7.0)', () => {
    assert.equal(effectiveEvidenceTier(testSuiteOutcome('o', 'T6', 'tests/a.test.ts')), 'T4');
  });

  test('test-suite command declared T5 demotes to T4', () => {
    assert.equal(effectiveEvidenceTier(testSuiteOutcome('o', 'T5', 'tests/a.test.ts')), 'T4');
  });

  test('test-suite command declared T4 keeps T4 (cap fits exactly — no demotion)', () => {
    assert.equal(effectiveEvidenceTier(testSuiteOutcome('o', 'T4', 'tests/a.test.ts')), 'T4');
  });

  test('cli-smoke declared T6 keeps T6 (maxScore 8.5 carries the declared tier)', () => {
    const o: Outcome = {
      id: 'o', tier: 'T6', kind: 'cli-smoke', description: 'real CLI invocation',
      command: 'node dist/index.js compete status', cli_args: ['compete', 'status'],
      expected_stdout_patterns: ['score'],
    } as Outcome;
    assert.equal(effectiveEvidenceTier(o), 'T6');
  });

  test('runtime-exec PRODUCT run (not a test runner) declared T5 keeps T5', () => {
    const o: RuntimeExecOutcome = {
      id: 'o', tier: 'T5', kind: 'runtime-exec', description: 'real product run',
      command: 'node dist/index.js gap testing --json', expected_exit: 0,
    };
    assert.equal(effectiveEvidenceTier(o), 'T5');
  });

  test('invalid declared tier is returned unchanged (scoring excludes it; stamping must not invent one)', () => {
    const o = { ...testSuiteOutcome('o', 'T6', 'tests/a.test.ts'), tier: 'T99' as CapabilityTier };
    assert.equal(effectiveEvidenceTier(o), 'T99');
  });

  test('highestTierWithinCap maps a 7.0 quality cap to T4', () => {
    assert.equal(highestTierWithinCap(7.0), 'T4');
    assert.equal(highestTierWithinCap(8.0), 'T5');
    assert.equal(highestTierWithinCap(0.5), null);
  });

  test('LOCKSTEP: stamped tier equals the bucket tier derived-score demotes to', () => {
    const overDeclared = testSuiteOutcome('over', 'T6', 'tests/a.test.ts');
    const honest = testSuiteOutcome('honest', 'T4', 'tests/b.test.ts');
    const breakdown = computeDerivedScoreWithBreakdown(
      { id: 'dimL', outcomes: [overDeclared, honest] },
      new Map(),
    );
    const demotion = breakdown.demotions.find(d => d.outcomeId === 'over');
    assert.ok(demotion, 'over-declared test-suite outcome must be demoted');
    assert.equal(demotion.to, effectiveEvidenceTier(overDeclared), 'receipt stamp and scoring bucket must agree');
    assert.equal(breakdown.demotions.find(d => d.outcomeId === 'honest'), undefined, 'honest declaration is not demoted');
  });
});

describe('receipt stamping — runOneOutcome writes the effective tier', () => {
  test('a T6-declared test-suite receipt is stamped T4 with declaredTier provenance', async () => {
    const outcome = testSuiteOutcome('t6_suite', 'T6', 'tests/fake-suite.test.ts');
    const written: Record<string, string> = {};
    const entry = await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: 'X:/nonexistent-effective-tier-test',
      _spawn: () => ({ status: 0, stdout: 'tests 5 pass 5 fail 0', stderr: '' }),
      _readGitSha: async () => SHA,
      _exists: async () => false,
      _writeFile: async (p, d) => { written[p] = d; },
      _createTimeMachineCommit: null,
    });
    assert.equal(entry.passed, true);
    assert.equal(entry.tier, 'T4', 'receipt must carry the tier its evidence genuinely supports');
    assert.equal(entry.declaredTier, 'T6', 'the over-declaration must be preserved as provenance');
    const onDisk = JSON.parse(Object.values(written)[0]!) as OutcomeEvidenceEntry;
    assert.equal(onDisk.tier, 'T4', 'the PERSISTED receipt carries the effective tier');
    assert.equal(onDisk.declaredTier, 'T6');
  });

  test('an honestly-declared T4 receipt is unchanged (no declaredTier noise)', async () => {
    const outcome = testSuiteOutcome('t4_suite', 'T4', 'tests/fake-suite.test.ts');
    const entry = await runOneOutcome({
      dimensionId: 'testing',
      outcome,
      cwd: 'X:/nonexistent-effective-tier-test',
      _spawn: () => ({ status: 0, stdout: 'tests 5 pass 5 fail 0', stderr: '' }),
      _readGitSha: async () => SHA,
      _exists: async () => false,
      _writeFile: async () => {},
      _createTimeMachineCommit: null,
    });
    assert.equal(entry.tier, 'T4');
    assert.equal(entry.declaredTier, undefined);
  });
});

describe('load↔score freshness lockstep (the gap "1/3 passing" collapse)', () => {
  function receipt(outcomeId: string, tier: CapabilityTier, ranAt: string, declaredTier?: CapabilityTier): OutcomeEvidenceEntry {
    return {
      dimensionId: 'testing', outcomeId, tier,
      ...(declaredTier ? { declaredTier } : {}),
      gitSha: SHA, passed: true, exitCode: 0, durationMs: 400,
      stdoutTail: 'pass', stderrTail: '', ranAt, evidencePath: '',
    };
  }

  function loadSeams(entries: OutcomeEvidenceEntry[]) {
    const files: Record<string, OutcomeEvidenceEntry> = {};
    for (const e of entries) files[`${e.gitSha}-${e.dimensionId}-${e.outcomeId}.json`] = e;
    return {
      _exists: async () => true,
      _readdir: async () => Object.keys(files),
      _readFile: async (p: string) => JSON.stringify(files[p.split(/[\\/]/).pop() as string]),
      _readGitSha: async () => SHA,
    };
  }

  test('a 2-day-old EFFECTIVE-T4 receipt survives load (14-day window, matching how it is scored)', async () => {
    const e = receipt('t6_suite', 'T4', daysAgo(2), 'T6');
    const map = await loadOutcomeEvidence('/x', SHA, loadSeams([e]));
    assert.equal(map.size, 1, 'a receipt scored at T4 must also be LOADED on the T4 window');
  });

  test('INTEGRITY: a legacy receipt still stamped T6 decays on the 24h window (no weakening)', async () => {
    const e = receipt('t6_suite', 'T6', daysAgo(2));
    const map = await loadOutcomeEvidence('/x', SHA, loadSeams([e]));
    assert.equal(map.size, 0, 'a genuine T6-claim receipt older than 24h must still be rejected');
  });

  test('REGRESSION: the testing-dim shape — T5 + 2xT6 test-suite outcomes, 2-day-old receipts, all credit at T4', async () => {
    const outcomes: Outcome[] = [
      testSuiteOutcome('t5_no_stub_scanner', 'T5', 'tests/matrix/verification-court.test.ts'),
      testSuiteOutcome('t6_integrity_seams', 'T6', 'tests/testing-dimension.test.ts'),
      testSuiteOutcome('t6_multi_receipt', 'T6', 'tests/completion-integrity.test.ts'),
    ];
    // Receipts as the FIXED runner stamps them: effective tier T4, 2 days old.
    const fixed = outcomes.map(o => receipt(o.id, effectiveEvidenceTier(o), daysAgo(2), o.tier));
    const loaded = await loadOutcomeEvidence('/x', SHA, loadSeams(fixed));
    assert.equal(loaded.size, 3, 'all three receipts must survive the load freshness gate');

    const breakdown = computeDerivedScoreWithBreakdown(
      { id: 'testing', outcomes }, loaded, new Date(),
    );
    const t4 = breakdown.perTier.find(pt => pt.tier === 'T4');
    assert.ok(t4, 'all three outcomes bucket at T4');
    assert.equal(t4.declared, 3);
    assert.equal(t4.passing, 3, 'no phantom failures from freshness-window mismatch');
    assert.equal(breakdown.score, 7.0, 'full T4 credit');

    // Contrast — the PRE-FIX stamping (declared tier on the receipt) reproduces the
    // bug this test exists to prevent: load drops both T6-stamped receipts at >24h
    // and gap reads "Tier T4: 1/3 passing (2 failing)" with every test green.
    const preFix = outcomes.map(o => receipt(o.id, o.tier, daysAgo(2)));
    const loadedPreFix = await loadOutcomeEvidence('/x', SHA, loadSeams(preFix));
    assert.equal(loadedPreFix.size, 1, 'pre-fix stamping loses the two T6-declared receipts');
    const preFixBreakdown = computeDerivedScoreWithBreakdown(
      { id: 'testing', outcomes }, loadedPreFix, new Date(),
    );
    const preFixT4 = preFixBreakdown.perTier.find(pt => pt.tier === 'T4');
    assert.equal(preFixT4?.passing, 1, 'this is exactly the 1/3-passing collapse the fix removes');
  });
});
