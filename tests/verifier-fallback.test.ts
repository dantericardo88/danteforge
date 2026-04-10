// verifier-fallback.test.ts — tests for graceful LLM-unavailable fallback in verifyTask (v0.18.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTask } from '../src/core/verifier.js';

function makeState() {
  return {
    project: 'test',
    phase: 1,
    tasks: [],
    constitution: '',
    auditLog: [],
    lastVerifyStatus: undefined,
  } as unknown as Parameters<typeof verifyTask>[2] extends { _loadState?: () => Promise<infer S> } ? S : never;
}

function makeOpts(overrides: Parameters<typeof verifyTask>[2] = {}): Parameters<typeof verifyTask>[2] {
  let state = makeState();
  return {
    _isLLMAvailable: async () => false,
    _loadState: async () => state,
    _saveState: async (s) => { state = s as typeof state; },
    _llmCaller: async () => { throw new Error('LLM should not be called'); },
    ...overrides,
  };
}

describe('verifyTask — LLM unavailable fallback', () => {
  it('returns true when task has no verify criteria and LLM is unavailable', async () => {
    const result = await verifyTask(
      { name: 'Add feature' },   // no verify field
      'Some task output',
      makeOpts(),
    );
    assert.equal(result, true, 'should return true when no criteria and LLM unavailable');
  });

  it('returns false when task has explicit verify criteria and LLM is unavailable', async () => {
    const result = await verifyTask(
      { name: 'Add feature', verify: 'Returns 200 for valid JWT' },
      'Some task output',
      makeOpts(),
    );
    assert.equal(result, false, 'should return false when explicit criteria and LLM unavailable');
  });

  it('records SKIP in audit log when no criteria and LLM unavailable', async () => {
    let savedState: { auditLog: string[] } | undefined;
    await verifyTask(
      { name: 'Plan task' },
      'Some output',
      makeOpts({
        _saveState: async (s) => { savedState = s as { auditLog: string[] }; },
      }),
    );
    const lastEntry = savedState?.auditLog[savedState.auditLog.length - 1] ?? '';
    assert.ok(lastEntry.includes('SKIP'), `audit log should include SKIP, got: ${lastEntry}`);
  });

  it('records BLOCKED in audit log when explicit criteria and LLM unavailable', async () => {
    let savedState: { auditLog: string[] } | undefined;
    await verifyTask(
      { name: 'Auth task', verify: 'auth works' },
      'Some output',
      makeOpts({
        _saveState: async (s) => { savedState = s as { auditLog: string[] }; },
      }),
    );
    const lastEntry = savedState?.auditLog[savedState.auditLog.length - 1] ?? '';
    assert.ok(lastEntry.includes('BLOCKED'), `audit log should include BLOCKED, got: ${lastEntry}`);
  });

  it('returns LLM verdict (PASS) normally when LLM is available', async () => {
    const result = await verifyTask(
      { name: 'Add feature', verify: 'works correctly' },
      'Implementation output',
      makeOpts({
        _isLLMAvailable: async () => true,
        _llmCaller: async () => 'PASS\nLooks good.',
      }),
    );
    assert.equal(result, true, 'should return true when LLM returns PASS');
  });

  it('returns LLM verdict (FAIL) normally when LLM is available', async () => {
    const result = await verifyTask(
      { name: 'Add feature', verify: 'works correctly' },
      'Implementation output',
      makeOpts({
        _isLLMAvailable: async () => true,
        _llmCaller: async () => 'FAIL\nNot implemented.',
      }),
    );
    assert.equal(result, false, 'should return false when LLM returns FAIL');
  });
});
