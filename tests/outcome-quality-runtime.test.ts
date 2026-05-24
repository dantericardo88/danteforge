import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutcomeQuality } from '../src/matrix/engines/outcome-quality.js';
import type { Outcome, OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

function makeEvidence(overrides: Partial<OutcomeEvidenceEntry> = {}): OutcomeEvidenceEntry {
  return {
    dimensionId: 'test',
    outcomeId: 'test_outcome',
    tier: 'T5',
    gitSha: 'abc123',
    passed: true,
    exitCode: 0,
    durationMs: 5000,
    stdoutTail: 'some output',
    stderrTail: '',
    ranAt: new Date().toISOString(),
    evidencePath: '/fake/path.json',
    ...overrides,
  };
}

describe('outcome-quality runtime gate', () => {
  it('rejects T5 shell outcome that only reads files', () => {
    const outcome: Outcome = {
      id: 'structural_check',
      tier: 'T5',
      description: 'checks file content',
      command: 'node -e "const c=require(\'fs\').readFileSync(\'src/foo.ts\',\'utf8\');if(!c.includes(\'bar\'))process.exit(1)"',
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'structural_check' });
    const errors = validateOutcomeQuality(outcome, evidence);
    assert.ok(errors.length > 0, 'should reject structural file check at T5');
    assert.ok(errors.some(e => e.reason.includes('structural file check')));
  });

  it('allows T5 cli-smoke outcome', () => {
    const outcome: Outcome = {
      id: 'cli_help',
      tier: 'T5',
      kind: 'cli-smoke',
      description: 'CLI help runs',
      cli_args: ['--help'],
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'cli_help' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'cli-smoke should not be rejected as structural');
  });

  it('allows T5 runtime-exec outcome', () => {
    const outcome: Outcome = {
      id: 'test_run',
      tier: 'T5',
      kind: 'runtime-exec',
      description: 'runs real tests',
      command: 'npx tsx --test tests/foo.test.ts',
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'test_run' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'runtime-exec should not be rejected as structural');
  });

  it('allows T5 e2e-workflow outcome', () => {
    const outcome: Outcome = {
      id: 'e2e_flow',
      tier: 'T5',
      kind: 'e2e-workflow',
      description: 'runs workflow',
      steps: [{ cli_args: ['--help'] }],
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'e2e_flow' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'e2e-workflow should not be rejected as structural');
  });

  it('allows T2 shell outcome with readFileSync (below gate)', () => {
    const outcome: Outcome = {
      id: 'structural_t2',
      tier: 'T2',
      description: 'T2 structural check is fine',
      command: 'node -e "require(\'fs\').readFileSync(\'src/foo.ts\')"',
    };
    const evidence = makeEvidence({ outcomeId: 'structural_t2', tier: 'T2' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'T2 structural checks are allowed');
  });

  it('allows T5 shell outcome that actually spawns processes', () => {
    const outcome: Outcome = {
      id: 'real_exec',
      tier: 'T5',
      description: 'runs actual test',
      command: 'npx tsx --test tests/foo.test.ts',
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'real_exec' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'shell outcome that runs real code should pass');
  });

  it('allows T5 shell with readFileSync if it also spawns', () => {
    const outcome: Outcome = {
      id: 'hybrid',
      tier: 'T5',
      description: 'reads then executes',
      command: 'node -e "const c=require(\'fs\').readFileSync(\'cfg.json\');require(\'child_process\').execSync(\'npm test\')"',
      timeout_ms: 10000,
    };
    const evidence = makeEvidence({ outcomeId: 'hybrid' });
    const errors = validateOutcomeQuality(outcome, evidence);
    const structuralErrors = errors.filter(e => e.reason.includes('structural'));
    assert.equal(structuralErrors.length, 0, 'hybrid command that both reads and executes should pass');
  });
});
