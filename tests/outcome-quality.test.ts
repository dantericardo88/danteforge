import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeQuality, classifyOutcomeKind } from '../src/matrix/engines/outcome-quality.js';
import type { Outcome, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

describe('classifyOutcomeKind — cli-smoke banner cap (grading-integrity #7)', () => {
  const cliSmoke = (cli_args: string[], command?: string): Outcome =>
    ({ id: 'o', tier: 'T6', description: 'd', kind: 'cli-smoke', cli_args, ...(command ? { command } : {}) } as unknown as Outcome);
  it('a --help cli-smoke caps at 7.0 (reachability, not capability)', () => {
    assert.equal(classifyOutcomeKind(cliSmoke(['--help'])).maxScore, 7.0);
    assert.equal(classifyOutcomeKind(cliSmoke(['gap', '--help'])).maxScore, 7.0, 'help flag after a real subcommand is still a banner');
    assert.equal(classifyOutcomeKind(cliSmoke([])).maxScore, 7.0, 'a bare invocation is a banner');
  });
  it('a real cli-smoke (non-trivial subcommand, no help flag) keeps 8.5', () => {
    assert.equal(classifyOutcomeKind(cliSmoke(['validate', 'security'])).maxScore, 8.5);
    // shorthand: cli-smoke carrying a real `command` instead of cli_args is not penalized
    assert.equal(classifyOutcomeKind(cliSmoke([], 'node dist/index.js validate security')).maxScore, 8.5);
  });
});

function makeOutcome(overrides: Partial<Outcome> & { command?: string } = {}): Outcome {
  return {
    id: 'test-outcome',
    tier: 'T5',
    description: 'Test outcome',
    command: 'npm run smoke-test',
    timeout_ms: 30000,
    expected_exit: 0,
    ...overrides,
  } as Outcome;
}

function makeEvidence(overrides: Partial<OutcomeEvidenceEntry> = {}): OutcomeEvidenceEntry {
  return {
    dimensionId: 'testing',
    outcomeId: 'test-outcome',
    tier: 'T5',
    gitSha: 'abc123',
    passed: true,
    exitCode: 0,
    durationMs: 5000,
    stdoutTail: 'Tests passed: 42/42',
    stderrTail: '',
    ranAt: new Date().toISOString(),
    evidencePath: '.danteforge/outcome-evidence/test.json',
    ...overrides,
  };
}

describe('outcome-quality gate', () => {
  it('passes a real T5 outcome with meaningful stdout', () => {
    const errors = validateOutcomeQuality(makeOutcome(), makeEvidence());
    assert.equal(errors.length, 0);
  });

  it('rejects T5 outcome with timeout_ms < 5000', () => {
    const errors = validateOutcomeQuality(
      makeOutcome({ timeout_ms: 1000 }),
      makeEvidence(),
    );
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.reason.includes('timeout_ms=1000'));
  });

  it('rejects T5 outcome with empty stdout', () => {
    const errors = validateOutcomeQuality(
      makeOutcome(),
      makeEvidence({ stdoutTail: '' }),
    );
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.reason.includes('zero stdout'));
  });

  it('rejects T3+ shell outcome with trivial echo command', () => {
    const errors = validateOutcomeQuality(
      makeOutcome({ tier: 'T3', command: 'echo done' }),
      undefined,
    );
    assert.ok(errors.length > 0);
    assert.ok(errors[0]!.reason.includes('trivial'));
  });

  it('passes T2 outcome with echo command (gate only fires T3+)', () => {
    const errors = validateOutcomeQuality(
      makeOutcome({ tier: 'T2', command: 'echo ok' }),
      undefined,
    );
    assert.equal(errors.length, 0);
  });

  it('rejects T3 shell outcome with very short command', () => {
    const errors = validateOutcomeQuality(
      makeOutcome({ tier: 'T3', command: 'true' }),
      undefined,
    );
    assert.ok(errors.length > 0);
  });

  it('passes T5 outcome with real command and stdout', () => {
    const errors = validateOutcomeQuality(
      makeOutcome({ command: 'npm run integration-test -- --timeout 30000', timeout_ms: 60000 }),
      makeEvidence({ stdoutTail: '42 tests passed in 12.3s' }),
    );
    assert.equal(errors.length, 0);
  });
});
