// executor-verify-gate.test.ts — tests for Test-Gated Verification (v0.18.0)
// Verifies that: finalTestResult is captured in the repair loop; code tasks use test
// results as primary verification gate; non-code tasks fall through to LLM verifier;
// lastVerifyStatus is written to state.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import { configureOfflineHome, restoreOfflineHome } from './helpers/offline-home.js';
import type { ApplyAllResult, CodeWriterOptions } from '../src/core/code-writer.js';
import type { TestRunResult, TestRunnerOptions } from '../src/core/test-runner.js';

const originalCwd = process.cwd();
const originalHome = process.env.DANTEFORGE_HOME;
const tempDirs: string[] = [];

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeState(phase = 1, taskName = 'Test task', verify?: string) {
  return {
    project: 'test-project',
    lastHandoff: 'none',
    workflowStage: 'forge',
    currentPhase: phase,
    tasks: { [phase]: [{ name: taskName, ...(verify ? { verify } : {}) }] },
    auditLog: [],
    profile: 'balanced',
    lastVerifyStatus: undefined as 'pass' | 'fail' | 'warn' | 'unknown' | undefined,
    lastVerifiedAt: undefined as string | undefined,
  };
}

function makeApplyResult(overrides: Partial<ApplyAllResult> = {}): ApplyAllResult {
  return { operations: [], filesWritten: [], filesFailedToApply: [], success: true, ...overrides };
}

function makeTestResult(passed: boolean): TestRunResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed ? 'ok' : 'FAIL',
    stderr: '',
    durationMs: 1,
    failingTests: passed ? [] : ['some test'],
    typecheckErrors: [],
  };
}

const SEARCH_REPLACE_RESPONSE = [
  '<<<<<<< SEARCH',
  'old code here',
  '=======',
  'new code here',
  '>>>>>>> REPLACE',
  'filepath: src/foo.ts',
].join('\n');

const PROSE_RESPONSE = 'Here is a plan for the feature: step 1, step 2, step 3.';

beforeEach(async () => {
  process.exitCode = 0;
  await configureOfflineHome(tempDirs);
});

afterEach(async () => {
  restoreOfflineHome(originalHome);
  process.exitCode = 0;
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executeWave — test-gated verification', () => {
  it('does not call _verifier for code tasks when tests pass', async () => {
    let verifierCalled = false;
    let savedState: ReturnType<typeof makeState> | undefined;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Add feature', 'tests pass') as never,
        save: async (s) => { savedState = s as ReturnType<typeof makeState>; },
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: async () => makeTestResult(true),
      _verifier: async () => { verifierCalled = true; return false; },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(!verifierCalled, '_verifier should not be called for code tasks');
  });

  it('sets result.success=true when code applied and tests pass', async () => {
    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Add feature') as never,
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: async () => makeTestResult(true),
      _verifier: async () => { throw new Error('should not be called'); },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(result.success, true);
  });

  it('sets result.success=false when code applied and tests fail', async () => {
    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Broken change') as never,
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: async () => makeTestResult(false),
      _verifier: async () => { throw new Error('should not be called'); },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(result.success, false);
  });

  it('calls _verifier for non-code tasks (prose LLM response)', async () => {
    let verifierCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Write documentation') as never,
        save: async () => {},
      },
      _llmCaller: async () => PROSE_RESPONSE,
      _testRunner: async (_opts: TestRunnerOptions) => { throw new Error('testRunner should not be called'); },
      _verifier: async () => { verifierCalled = true; return true; },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(verifierCalled, '_verifier should be called for non-code tasks');
  });

  it('writes lastVerifyStatus=pass to state when tests pass', async () => {
    const saves: Array<ReturnType<typeof makeState>> = [];

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Add feature') as never,
        save: async (s) => { saves.push(s as ReturnType<typeof makeState>); },
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: async () => makeTestResult(true),
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    const statusSave = saves.find(s => s.lastVerifyStatus !== undefined);
    assert.ok(statusSave, 'state should be saved with lastVerifyStatus set');
    assert.equal(statusSave?.lastVerifyStatus, 'pass');
  });

  it('writes lastVerifyStatus=fail to state when tests fail', async () => {
    const saves: Array<ReturnType<typeof makeState>> = [];

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Broken task') as never,
        save: async (s) => { saves.push(s as ReturnType<typeof makeState>); },
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: async () => makeTestResult(false),
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    const statusSave = saves.find(s => s.lastVerifyStatus !== undefined);
    assert.equal(statusSave?.lastVerifyStatus, 'fail');
  });

  it('typecheck failure sets lastVerifyStatus=fail (no test run needed)', async () => {
    const saves: Array<ReturnType<typeof makeState>> = [];
    let testRunnerCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Type-error task') as never,
        save: async (s) => { saves.push(s as ReturnType<typeof makeState>); },
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestResult(false),
      _testRunner: async () => { testRunnerCalled = true; return makeTestResult(true); },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    // After MAX_REPAIRS (3) failed typecheck cycles, finalTestResult.passed=false
    const statusSave = saves.find(s => s.lastVerifyStatus !== undefined);
    assert.equal(statusSave?.lastVerifyStatus, 'fail', 'should be fail when typecheck keeps failing');
  });

  it('repair loop captures updated test result after re-apply', async () => {
    let callCount = 0;
    const saves: Array<ReturnType<typeof makeState>> = [];

    // First call: initial LLM response (code ops)
    // Second call onwards: repair responses (also code ops)
    const llmCaller = async () => SEARCH_REPLACE_RESPONSE;

    // First test run fails, second passes (after repair)
    let testRunCount = 0;
    const testRunner = async (_opts: TestRunnerOptions): Promise<TestRunResult> => {
      testRunCount++;
      return makeTestResult(testRunCount >= 2);
    };

    await executeWave(1, 'balanced', false, false, false, 5000, {
      _stateCaller: {
        load: async () => makeState(1, 'Repaired task') as never,
        save: async (s) => { saves.push(s as ReturnType<typeof makeState>); },
      },
      _llmCaller: llmCaller,
      _codeWriter: async () => { callCount++; return makeApplyResult({ filesWritten: ['src/foo.ts'] }); },
      _typecheckRunner: async () => makeTestResult(true),
      _testRunner: testRunner,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    // After repair succeeds, lastVerifyStatus should be pass
    const statusSave = saves.find(s => s.lastVerifyStatus !== undefined);
    assert.equal(statusSave?.lastVerifyStatus, 'pass', 'final test result (pass) drives lastVerifyStatus');
  });
});
