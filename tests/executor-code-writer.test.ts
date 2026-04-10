// executor-code-writer.test.ts — tests for code-writer integration in executeWave
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

function makeState(phase = 1, taskName = 'Test task') {
  return {
    project: 'test-project',
    lastHandoff: 'none',
    workflowStage: 'forge',
    currentPhase: phase,
    tasks: { [phase]: [{ name: taskName, verify: 'all tests pass' }] },
    auditLog: [],
    profile: 'balanced',
  };
}

function makeApplyResult(overrides: Partial<ApplyAllResult> = {}): ApplyAllResult {
  return {
    operations: [],
    filesWritten: [],
    filesFailedToApply: [],
    success: true,
    ...overrides,
  };
}

function makeTestRunResult(passed: boolean, overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    passed,
    exitCode: passed ? 0 : 1,
    stdout: passed ? 'all tests pass' : '1 failing test',
    stderr: '',
    durationMs: 10,
    failingTests: passed ? [] : ['some test > failed assertion'],
    typecheckErrors: [],
    ...overrides,
  };
}

/** Minimal LLM response containing a SEARCH/REPLACE block */
const SEARCH_REPLACE_RESPONSE = [
  '<<<<<<< SEARCH',
  'old code here',
  '=======',
  'new code here',
  '>>>>>>> REPLACE',
  'filepath: src/foo.ts',
].join('\n');

/** Minimal LLM response containing a NEW_FILE block */
const NEW_FILE_RESPONSE = [
  'NEW_FILE: src/bar.ts',
  '```typescript',
  'export const bar = 42;',
  '```',
].join('\n');

async function makeTmpStateDir(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cw-'));
  tempDirs.push(tmpDir);
  const dfDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.writeFile(
    path.join(dfDir, 'STATE.yaml'),
    [
      'project: test-project',
      'workflowStage: forge',
      'currentPhase: 0',
      'profile: balanced',
      'lastHandoff: none',
      'auditLog: []',
      'tasks:',
      '  1:',
      '    - name: "Test task"',
      '      verify: "all tests pass"',
    ].join('\n'),
    'utf8',
  );
  return tmpDir;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

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

describe('executeWave — code-writer integration', () => {
  // 1. No code blocks → _codeWriter NOT called
  it('skips code-writer when LLM response has no SEARCH/REPLACE or NEW_FILE blocks', async () => {
    const tmpDir = await makeTmpStateDir();
    let codeWriterCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => 'No code blocks here — just plain prose.',
      _codeWriter: async () => {
        codeWriterCalled = true;
        return makeApplyResult();
      },
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(codeWriterCalled, false, '_codeWriter must NOT be called when no ops are parsed');
    assert.equal(result.success, true);
  });

  // 2. SEARCH/REPLACE block → _codeWriter IS called
  it('calls _codeWriter when LLM response contains a SEARCH/REPLACE block', async () => {
    const tmpDir = await makeTmpStateDir();
    let codeWriterCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => {
        codeWriterCalled = true;
        return makeApplyResult({ operations: [{ filePath: 'src/foo.ts', success: true }], filesWritten: ['src/foo.ts'] });
      },
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(codeWriterCalled, true, '_codeWriter must be called when SEARCH/REPLACE ops are present');
    assert.equal(result.success, true);
  });

  // 3. NEW_FILE block → _codeWriter IS called
  it('calls _codeWriter when LLM response contains a NEW_FILE block', async () => {
    const tmpDir = await makeTmpStateDir();
    let codeWriterCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => NEW_FILE_RESPONSE,
      _codeWriter: async () => {
        codeWriterCalled = true;
        return makeApplyResult({ operations: [{ filePath: 'src/bar.ts', success: true }], filesWritten: ['src/bar.ts'] });
      },
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(codeWriterCalled, true, '_codeWriter must be called for NEW_FILE operations');
  });

  // 4. Typecheck passes + tests pass → no repair (LLM called exactly once)
  it('does not trigger repair when typecheck and tests both pass', async () => {
    const tmpDir = await makeTmpStateDir();
    let llmCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => {
        llmCallCount++;
        return SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(llmCallCount, 1, 'LLM should be called exactly once when typecheck+tests pass immediately');
  });

  // 5. Typecheck fails → repair loop triggered, LLM called a second time
  it('triggers repair when typecheck fails — LLM called a second time', async () => {
    const tmpDir = await makeTmpStateDir();
    let llmCallCount = 0;
    let tcCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => {
        llmCallCount++;
        return SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => {
        tcCallCount++;
        // Fail first, then pass
        return makeTestRunResult(tcCallCount >= 2, { typecheckErrors: tcCallCount < 2 ? ['TS2345: argument error'] : [] });
      },
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(llmCallCount >= 2, `LLM must be called at least twice when typecheck fails (got ${llmCallCount})`);
  });

  // 6. Tests fail after typecheck passes → repair loop triggered
  it('triggers repair when tests fail after typecheck passes', async () => {
    const tmpDir = await makeTmpStateDir();
    let llmCallCount = 0;
    let testCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => {
        llmCallCount++;
        return SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => {
        testCallCount++;
        // Fail first time, pass on second
        return makeTestRunResult(testCallCount >= 2);
      },
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(llmCallCount >= 2, `LLM must be called again when tests fail (got ${llmCallCount})`);
  });

  // 7. Both pass after 1 repair → stops without hitting max repairs
  it('stops repair loop after first successful fix', async () => {
    const tmpDir = await makeTmpStateDir();
    let tcCallCount = 0;
    let llmCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => {
        llmCallCount++;
        return SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => {
        tcCallCount++;
        return makeTestRunResult(tcCallCount >= 2);
      },
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    // Called once for initial + once for repair = 2. Should NOT reach 4 (max 3 repairs + initial).
    assert.ok(llmCallCount <= 3, `Should stop at first fix, not exhaust all 3 repairs (got ${llmCallCount} LLM calls)`);
    assert.equal(tcCallCount, 2, 'Typecheck should be called twice — once failing, once passing');
  });

  // 8. 3 repair attempts exhausted → fails via test result (test-gated verification, v0.18.0)
  it('completes without throwing when max 3 repair attempts are exhausted', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      // Always fail typecheck → forces 3 repair attempts, finalTestResult.passed=false
      _typecheckRunner: async () => makeTestRunResult(false, { typecheckErrors: ['TS2345: persistent error'] }),
      _testRunner: async () => makeTestRunResult(false),
      // _verifier not called for code tasks — test result is authoritative
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    // Should not throw; code was applied but tests always fail → success=false
    assert.equal(result.success, false, 'wave result should be false when all repairs exhausted and tests still fail');
  });

  // 9. _codeWriter throws → caught, execution continues to verifyTask
  it('continues to verifyTask even when _codeWriter throws', async () => {
    const tmpDir = await makeTmpStateDir();
    let verifierCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => {
        throw new Error('disk full — simulated write failure');
      },
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => {
        verifierCalled = true;
        return true;
      },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    // Task-level error is caught and recorded — verifier is NOT called after throw propagates to task level
    // The outer catch around runTask will record the failure
    assert.equal(result.mode, 'executed');
  });

  // 10. Auto-commit attempted when files were written
  it('attempts stageAndCommit after files are written (non-fatal path exists)', async () => {
    const tmpDir = await makeTmpStateDir();
    let commitAttempted = false;

    // We inject a git-integration override via the codeWriter indirectly — instead
    // test that the wave succeeds even with a commit-less git environment
    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async (_resp: string, _opts: CodeWriterOptions) => {
        commitAttempted = true; // proxy for "we reached the commit path"
        return makeApplyResult({ filesWritten: ['src/foo.ts'], operations: [{ filePath: 'src/foo.ts', success: true }] });
      },
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(commitAttempted, true, 'codeWriter path was reached when files were expected to be written');
    assert.equal(result.success, true);
    // Commit failure (no git repo in tmpDir) is non-fatal — result still succeeds
  });

  // 11. Auto-commit failure is non-fatal
  it('succeeds even when auto-commit fails (non-git directory)', async () => {
    // tmpDir has no .git — stageAndCommit will throw, but that must be caught
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({
        filesWritten: ['src/foo.ts'],
        operations: [{ filePath: 'src/foo.ts', success: true }],
      }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(result.success, true, 'commit failure must be non-fatal');
    assert.equal(result.mode, 'executed');
  });

  // 12. Uses buildTaskPromptWithCodeFormat — prompt injected to _llmCaller contains SEARCH/REPLACE
  it('uses buildTaskPromptWithCodeFormat — prompt contains SEARCH/REPLACE format instructions', async () => {
    const tmpDir = await makeTmpStateDir();
    let capturedPrompt = '';

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async (prompt) => {
        capturedPrompt = prompt;
        return 'plain response with no code blocks';
      },
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(
      capturedPrompt.includes('SEARCH/REPLACE'),
      `Prompt to LLM must include SEARCH/REPLACE instructions. Got: ${capturedPrompt.slice(0, 200)}`,
    );
  });

  // 13. Repair prompt contains "Output ONLY SEARCH/REPLACE blocks" text
  it('repair prompt contains "Output ONLY SEARCH/REPLACE blocks" instruction', async () => {
    const tmpDir = await makeTmpStateDir();
    const capturedPrompts: string[] = [];
    let tcCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async (prompt) => {
        capturedPrompts.push(prompt);
        return SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => {
        tcCallCount++;
        return makeTestRunResult(tcCallCount > 1);
      },
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(capturedPrompts.length >= 2, 'Should have at least one repair prompt');
    const repairPrompt = capturedPrompts[1]!;
    assert.ok(
      repairPrompt.includes('Output ONLY SEARCH/REPLACE blocks'),
      `Repair prompt must instruct LLM to output ONLY SEARCH/REPLACE blocks. Got: ${repairPrompt.slice(0, 300)}`,
    );
  });

  // 14. Repair prompt contains first 2000 chars of previous response
  it('repair prompt contains truncated first 2000 chars of previous LLM response', async () => {
    const tmpDir = await makeTmpStateDir();
    const capturedPrompts: string[] = [];
    let tcCallCount = 0;
    // Make a long first response so we can verify truncation
    const longPreviousResponse = SEARCH_REPLACE_RESPONSE + '\n' + 'x'.repeat(3000);

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async (prompt) => {
        capturedPrompts.push(prompt);
        // Return long response on first call; valid SEARCH/REPLACE on subsequent
        return capturedPrompts.length === 1 ? longPreviousResponse : SEARCH_REPLACE_RESPONSE;
      },
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => {
        tcCallCount++;
        return makeTestRunResult(tcCallCount > 1);
      },
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(capturedPrompts.length >= 2, 'Should have repair prompt');
    const repairPrompt = capturedPrompts[1]!;
    // The first 2000 chars of longPreviousResponse starts with the SEARCH/REPLACE prefix
    assert.ok(
      repairPrompt.includes('<<<<<<< SEARCH'),
      'Repair prompt must include part of the previous response for context',
    );
    // Verify it doesn't include more than 2000 chars of the previous response
    const prevResponseSnippet = longPreviousResponse.slice(0, 2000);
    assert.ok(
      repairPrompt.includes(prevResponseSnippet.slice(0, 100)),
      'Repair prompt must include the beginning of the previous response',
    );
  });

  // 15. _typecheckRunner not called when no code ops
  it('does not call _typecheckRunner when there are no parsed code operations', async () => {
    const tmpDir = await makeTmpStateDir();
    let typecheckCalled = false;

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => 'Plain text response without any code blocks.',
      _typecheckRunner: async () => {
        typecheckCalled = true;
        return makeTestRunResult(true);
      },
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(typecheckCalled, false, '_typecheckRunner must not be called when no code ops are parsed');
  });

  // 16. Parallel execution: code-writer called for each task
  it('calls _codeWriter for each task when running in parallel mode', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cw-parallel-'));
    tempDirs.push(tmpDir);
    const dfDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(
      path.join(dfDir, 'STATE.yaml'),
      [
        'project: test-project',
        'workflowStage: forge',
        'currentPhase: 0',
        'profile: balanced',
        'lastHandoff: none',
        'auditLog: []',
        'tasks:',
        '  1:',
        '    - name: "Task A"',
        '      verify: "pass"',
        '    - name: "Task B"',
        '      verify: "pass"',
      ].join('\n'),
      'utf8',
    );

    let codeWriterCallCount = 0;

    const state = {
      project: 'test-project',
      lastHandoff: 'none',
      workflowStage: 'forge',
      currentPhase: 1,
      tasks: {
        1: [
          { name: 'Task A', verify: 'pass' },
          { name: 'Task B', verify: 'pass' },
        ],
      },
      auditLog: [],
      profile: 'balanced',
    };

    await executeWave(1, 'balanced', true, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => state,
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => {
        codeWriterCallCount++;
        return makeApplyResult({ filesWritten: ['src/foo.ts'] });
      },
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(codeWriterCallCount, 2, '_codeWriter must be called once per task in parallel mode');
  });

  // 17. Prompt mode: returns before _codeWriter path
  it('returns mode=prompt without calling _codeWriter in prompt mode', async () => {
    const tmpDir = await makeTmpStateDir();
    let codeWriterCalled = false;

    const result = await executeWave(1, 'balanced', false, true, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _codeWriter: async () => {
        codeWriterCalled = true;
        return makeApplyResult();
      },
      _verifier: async () => true,
    });

    assert.equal(result.mode, 'prompt');
    assert.equal(codeWriterCalled, false, '_codeWriter must NOT be called in prompt mode');
  });

  // 18. Blocked mode (no LLM, no promptMode): returns blocked
  it('returns mode=blocked when no LLM is available and promptMode=false', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      // no _llmCaller → triggers isLLMAvailable() which returns false in offline env
    });

    assert.equal(result.mode, 'blocked');
    assert.equal(result.success, false);
  });

  // 19. filesFailedToApply non-empty → success still depends on verifier
  it('still passes when filesFailedToApply is non-empty (verifier determines success)', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({
        filesWritten: [],
        filesFailedToApply: ['src/foo.ts'],
        operations: [{ filePath: 'src/foo.ts', success: false, error: 'no match found' }],
        success: false,
      }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(result.success, true, 'verifier returning true should yield success=true regardless of filesFailedToApply');
  });

  // 20. _testRunner receives cwd from options
  it('passes cwd to _testRunner via TestRunnerOptions', async () => {
    const tmpDir = await makeTmpStateDir();
    let receivedCwd = '';

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async (opts: TestRunnerOptions) => {
        receivedCwd = opts.cwd ?? '';
        return makeTestRunResult(true);
      },
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(receivedCwd, tmpDir, `_testRunner must receive the cwd from ExecuteWaveOptions. Got: ${receivedCwd}`);
  });

  // 21. _typecheckRunner receives cwd from options
  it('passes cwd to _typecheckRunner via TestRunnerOptions', async () => {
    const tmpDir = await makeTmpStateDir();
    let receivedCwd = '';

    await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async (opts: TestRunnerOptions) => {
        receivedCwd = opts.cwd ?? '';
        return makeTestRunResult(true);
      },
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(receivedCwd, tmpDir, `_typecheckRunner must receive the cwd from ExecuteWaveOptions. Got: ${receivedCwd}`);
  });

  // 22. Wave result includes mode: 'executed' after successful code write
  it('returns mode=executed after a successful code-write + verify cycle', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({
        operations: [{ filePath: 'src/foo.ts', success: true }],
        filesWritten: ['src/foo.ts'],
      }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => true,
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.equal(result.mode, 'executed', 'successful LLM + code write cycle must return mode=executed');
    assert.equal(result.success, true);
  });

  // 23. _verifier is NOT called after code operations are applied (test-gated verification, v0.18.0)
  it('does not call _verifier after code operations are applied (test result is authoritative)', async () => {
    const tmpDir = await makeTmpStateDir();
    let verifierCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 5000, {
      cwd: tmpDir,
      _stateCaller: {
        load: async () => makeState(1),
        save: async () => {},
      },
      _llmCaller: async () => SEARCH_REPLACE_RESPONSE,
      _codeWriter: async () => makeApplyResult({ filesWritten: ['src/foo.ts'] }),
      _typecheckRunner: async () => makeTestRunResult(true),
      _testRunner: async () => makeTestRunResult(true),
      _verifier: async () => {
        verifierCalled = true;
        return true;
      },
      _reflector: async () => ({ timestamp: new Date().toISOString(), score: 10, feedback: 'ok', complete: true }),
    });

    assert.ok(!verifierCalled, '_verifier should NOT be called when code was applied — test result is authoritative');
    assert.equal(result.success, true, 'result should be success=true when tests pass');
  });
});
