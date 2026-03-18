import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import {
  requireConstitution,
  requireSpec,
  requirePlan,
  requireTests,
  requireApproval,
  runGate,
  GateError,
} from '../src/core/gates.js';

afterEach(() => {
  process.exitCode = 0;
});

describe('GateError', () => {
  it('has gate and remedy properties', () => {
    const err = new GateError('blocked', 'testGate', 'run fix');
    assert.strictEqual(err.gate, 'testGate');
    assert.strictEqual(err.remedy, 'run fix');
    assert.strictEqual(err.message, 'blocked');
    assert.strictEqual(err.name, 'GateError');
  });

  it('is an instance of Error', () => {
    const err = new GateError('msg', 'g', 'r');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof GateError);
  });
});

describe('gates light mode bypass', () => {
  it('requireConstitution passes in light mode', async () => {
    await requireConstitution(true);
  });

  it('requireSpec passes in light mode', async () => {
    await requireSpec(true);
  });

  it('requirePlan passes in light mode', async () => {
    await requirePlan(true);
  });

  it('requireTests passes in light mode', async () => {
    await requireTests(true);
  });

  it('requireApproval does not throw in any mode', async () => {
    await requireApproval('test-artifact', false);
    await requireApproval('test-artifact', true);
  });
});

describe('runGate', () => {
  it('returns true when gate passes', async () => {
    const result = await runGate(() => Promise.resolve());
    assert.strictEqual(result, true);
  });

  it('returns false when gate throws GateError', async () => {
    const result = await runGate(() => {
      throw new GateError('blocked', 'test', 'fix');
    });
    assert.strictEqual(result, false);
  });

  it('rethrows non-GateError errors', async () => {
    try {
      await runGate(() => { throw new Error('unexpected'); });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'unexpected');
      assert.ok(!(err instanceof GateError));
    }
  });
});
