// Tests for the code application pipeline wired into executeWave().
// Verifies: code extraction → disk apply → test run → retry loop.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import type { ApplyAllResult, FileOperation } from '../src/core/code-writer.js';
import type { TestRunResult } from '../src/core/test-runner.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(tasks: { name: string; files?: string[]; verify?: string }[]): DanteState {
  return {
    project: 'test',
    lastHandoff: '',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: { 1: tasks },
    auditLog: [],
    constitution: 'Build quality software.',
    selfEditPolicy: 'deny',
  } as unknown as DanteState;
}

function makeApplyResult(overrides: Partial<ApplyAllResult> = {}): ApplyAllResult {
  return {
    operations: [],
    filesWritten: ['src/foo.ts'],
    filesFailedToApply: [],
    success: true,
    ...overrides,
  };
}

function makeTestResult(passed: boolean, overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed ? 'all tests pass' : '1 failing',
    stderr: '',
    durationMs: 100,
    failingTests: passed ? [] : ['test foo fails'],
    typecheckErrors: [],
    ...overrides,
  };
}

const BASE_OPTIONS = {
  _stateCaller: {
    load: async () => makeState([{ name: 'Add foo', verify: 'foo is exported' }]),
    save: async () => {},
  },
  _reflector: async () => ({ timestamp: new Date().toISOString(), score: 80, reasoning: 'ok', verdict: 'proceed' as const }),
  _memorizer: async () => {},
  _captureFailureLessons: async () => {},
  _sevenLevelsAnalysis: async () => {},
  _isLLMAvailable: async () => false,
};

// ── T1: No code blocks → _applyOperations never called ───────────────────────

describe('executor code-application pipeline', () => {
  it('T1: plain text response skips apply and test', async () => {
    let applyCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'Here is my analysis of the task. No code changes needed.',
      _applyOperations: async () => { applyCalled = true; return makeApplyResult(); },
      _runTests: async () => { throw new Error('should not run tests'); },
      _verifier: async () => true,
    });

    assert.strictEqual(applyCalled, false, '_applyOperations must not be called when no code blocks');
  });

  // ── T2: Code blocks → applyOperations called with parsed ops ─────────────

  it('T2: code blocks in response trigger apply', async () => {
    let receivedOps: FileOperation[] = [];

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'NEW_FILE: src/foo.ts\n```typescript\nexport const x = 1;\n```',
      _applyOperations: async (ops) => { receivedOps = ops; return makeApplyResult(); },
      _runTests: async () => makeTestResult(true),
      _verifier: async () => true,
    });

    assert.equal(receivedOps.length, 1);
    assert.ok(receivedOps[0]!.filePath.includes('foo.ts'));
  });

  // ── T3: Tests pass on first run → LLM called exactly once ────────────────

  it('T3: tests pass first try — no retry', async () => {
    let llmCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => { llmCallCount++; return 'NEW_FILE: src/a.ts\n```typescript\nexport const a = 1;\n```'; },
      _applyOperations: async () => makeApplyResult(),
      _runTests: async () => makeTestResult(true),
      _verifier: async () => true,
    });

    assert.equal(llmCallCount, 1, 'LLM should only be called once when tests pass immediately');
  });

  // ── T4: Tests fail once → retry with error context ───────────────────────

  it('T4: tests fail once → retry called with error summary in prompt', async () => {
    let testCallCount = 0;
    let llmCallCount = 0;
    let secondPrompt = '';

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async (prompt) => {
        llmCallCount++;
        if (llmCallCount > 1) secondPrompt = prompt;
        return 'NEW_FILE: src/b.ts\n```typescript\nexport const b = 2;\n```';
      },
      _applyOperations: async () => makeApplyResult(),
      _runTests: async () => {
        testCallCount++;
        return makeTestResult(testCallCount >= 2); // fail first, pass second
      },
      _verifier: async () => true,
    });

    assert.ok(llmCallCount >= 2, 'LLM must be retried after test failure');
    assert.ok(secondPrompt.includes('failed tests'), 'retry prompt must mention failed tests');
  });

  // ── T5: Tests fail all retries → executeWave does not throw ──────────────

  it('T5: all retries fail — executeWave returns without throwing', async () => {
    let llmCallCount = 0;

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => {
        llmCallCount++;
        return 'NEW_FILE: src/c.ts\n```typescript\nexport const c = 3;\n```';
      },
      _applyOperations: async () => makeApplyResult(),
      _runTests: async () => makeTestResult(false), // always fail
      _verifier: async () => false,
    });

    // MAX_CODE_APPLY_RETRIES = 2, so 1 original + 2 retries = 3 LLM calls
    assert.ok(llmCallCount <= 4, `LLM called too many times: ${llmCallCount}`);
    assert.ok(result !== undefined, 'executeWave must return a result even on repeated failures');
  });

  // ── T6: applyOperations throws → pipeline absorbed, verifier still called ─

  it('T6: apply throws — verifier still called', async () => {
    let verifierCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'NEW_FILE: src/d.ts\n```typescript\nexport const d = 4;\n```',
      _applyOperations: async () => { throw new Error('disk full'); },
      _runTests: async () => makeTestResult(true),
      _verifier: async () => { verifierCalled = true; return true; },
    });

    assert.strictEqual(verifierCalled, true, 'verifier must still be called even when apply throws');
  });

  // ── T7: partial apply → tests still run ──────────────────────────────────

  it('T7: partial apply (some files failed) — tests still run', async () => {
    let testsCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'NEW_FILE: src/e.ts\n```typescript\nexport const e = 5;\n```',
      _applyOperations: async () => makeApplyResult({
        success: false,
        filesWritten: [],
        filesFailedToApply: ['src/e.ts'],
      }),
      _runTests: async () => { testsCalled = true; return makeTestResult(true); },
      _verifier: async () => true,
    });

    assert.strictEqual(testsCalled, true, 'tests must run even when some files failed to apply');
  });

  // ── T8: retry prompt includes current file content ────────────────────────

  it('T8: retry prompt includes current file content from _readFileFn', async () => {
    let llmCalls = 0;
    let secondPrompt = '';
    let readFileCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async (prompt) => {
        llmCalls++;
        if (llmCalls > 1) secondPrompt = prompt;
        return 'NEW_FILE: src/f.ts\n```typescript\nexport const f = 6;\n```';
      },
      _applyOperations: async () => makeApplyResult({ filesWritten: ['src/f.ts'] }),
      _runTests: async () => makeTestResult(llmCalls >= 2), // fail first, pass second
      _readFileFn: async () => { readFileCalled = true; return 'export const f = 6; // current'; },
      _verifier: async () => true,
    });

    assert.ok(readFileCalled, '_readFileFn must be called during retry');
    assert.ok(secondPrompt.includes('src/f.ts'), 'retry prompt must include the file path');
    assert.ok(secondPrompt.includes('Current state of files'), 'retry prompt must include file context header');
  });

  // ── T9: retry apply result is captured — failures are not silent ──────────

  it('T9: retry apply failure is captured, not silent — applyFn called on retry', async () => {
    let applyCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'NEW_FILE: src/g.ts\n```typescript\nexport const g = 7;\n```',
      _applyOperations: async () => {
        applyCallCount++;
        if (applyCallCount === 1) return makeApplyResult({ filesWritten: ['src/g.ts'] });
        // retry apply fails — result must be captured (not discarded)
        return makeApplyResult({ success: false, filesWritten: [], filesFailedToApply: ['src/g.ts'] });
      },
      _runTests: async () => makeTestResult(false), // always fail to force retry
      _readFileFn: async () => '',
      _verifier: async () => false,
    });

    assert.ok(applyCallCount >= 2, 'applyFn must be called on retry (not just first attempt)');
  });

  // ── T10: filesInFlight updated — retry reads files from latest apply ───────

  it('T10: _readFileFn called with paths from latest apply result', async () => {
    const filesRead: string[] = [];
    let applyCallCount = 0;
    let testCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'NEW_FILE: src/h.ts\n```typescript\nexport const h = 8;\n```',
      _applyOperations: async () => {
        applyCallCount++;
        return makeApplyResult({ filesWritten: ['src/h.ts'] });
      },
      _runTests: async () => {
        testCallCount++;
        return makeTestResult(testCallCount >= 2); // fail first, pass second
      },
      _readFileFn: async (p) => { filesRead.push(p); return '// content'; },
      _verifier: async () => true,
    });

    assert.ok(filesRead.length > 0, '_readFileFn must be called with file paths during retry');
    assert.ok(filesRead.some(p => p.includes('h.ts')), 'must read the file that was applied');
  });

  // ── T11: file content capped at 200 lines ────────────────────────────────

  it('T11: file content injected into retry prompt is capped at 200 lines', async () => {
    let llmCalls = 0;
    let capturedRetryPrompt = '';

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async (prompt) => {
        llmCalls++;
        if (llmCalls === 2) capturedRetryPrompt = prompt;
        return 'NEW_FILE: src/i.ts\n```typescript\nexport const i = 9;\n```';
      },
      _applyOperations: async () => makeApplyResult({ filesWritten: ['src/i.ts'] }),
      _runTests: async () => makeTestResult(llmCalls >= 2), // fail first, pass second
      _readFileFn: async () => Array.from({ length: 300 }, (_, n) => `line ${n}`).join('\n'),
      _verifier: async () => true,
    });

    if (capturedRetryPrompt) {
      const fileSection = capturedRetryPrompt.split('Current state of files')[1] ?? '';
      const lineCount = fileSection.split('\n').length;
      assert.ok(lineCount <= 225, `file context must be capped (~200 lines + headers), got ${lineCount}`);
    }
  });

  // ── T12: no file reads when initial apply wrote no files ─────────────────

  it('T12: _readFileFn not called when no files were written or attempted', async () => {
    let readCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      ...BASE_OPTIONS,
      _llmCaller: async () => 'Here is my analysis. No code changes.',
      _applyOperations: async () => makeApplyResult({ filesWritten: [], success: true }),
      _runTests: async () => makeTestResult(true),
      _readFileFn: async () => { readCalled = true; return ''; },
      _verifier: async () => true,
    });

    assert.strictEqual(readCalled, false, '_readFileFn must not be called when no files were applied');
  });
});
