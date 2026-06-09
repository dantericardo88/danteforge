import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectInputForSession, resolveRunCommand, checkFrontierSpec, type FrontierSpec } from '../src/core/frontier-spec.js';

function spec(over: Partial<FrontierSpec['real_user_path']> = {}): FrontierSpec {
  return {
    version: 1, target_score: 9.0, status: 'frozen',
    leader_target: { competitor: 'Cursor', score: 9.5, observed_capability: 'repo map' },
    real_user_path: {
      required_callsite: 'src/x.ts',
      run_command: 'node dist/index.js context inspect --project {input}',
      observable_artifacts: [{ kind: 'json', path: 'out/x.json' }],
      ...over,
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}

describe('frontier multi-input variants — anti-circular defense', () => {
  test('selectInputForSession rotates across realistic_inputs by session', () => {
    const s = spec({ realistic_inputs: ['fixtures/a', 'fixtures/b'] });
    assert.equal(selectInputForSession(s, 0), 'fixtures/a');
    assert.equal(selectInputForSession(s, 1), 'fixtures/b', 'session 2 uses a DIFFERENT input');
    assert.equal(selectInputForSession(s, 2), 'fixtures/a', 'rotates');
  });

  test('selectInputForSession falls back to singular realistic_input', () => {
    assert.equal(selectInputForSession(spec({ realistic_input: 'fixtures/solo' }), 0), 'fixtures/solo');
    assert.equal(selectInputForSession(spec(), 0), undefined);
  });

  test('resolveRunCommand substitutes {input} per session', () => {
    const s = spec({ realistic_inputs: ['fixtures/a', 'fixtures/b'] });
    assert.equal(resolveRunCommand(s, 0), 'node dist/index.js context inspect --project fixtures/a');
    assert.equal(resolveRunCommand(s, 1), 'node dist/index.js context inspect --project fixtures/b');
  });

  test('checkFrontierSpec ERRORS when the two-session protocol has <2 realistic inputs', () => {
    const single = spec({ run_command: 'node dist/index.js context inspect --project fixtures/a' });
    const r = checkFrontierSpec(single, ['Cursor']);
    assert.equal(r.ok, false, 'a single input cannot prove two meaningfully-distinct sessions');
    assert.ok(r.errors.some(e => /realistic_inputs/.test(e)), 'blocks freeze until ≥2 inputs are declared');
  });

  test('two declared inputs → no realistic_inputs error', () => {
    const multi = spec({ run_command: 'node dist/index.js context inspect --project {input}', realistic_inputs: ['fixtures/a', 'fixtures/b'] });
    const r = checkFrontierSpec(multi, ['Cursor']);
    assert.equal(r.errors.some(e => /realistic_inputs/.test(e)), false);
  });
});
