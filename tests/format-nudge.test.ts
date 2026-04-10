// format-nudge.test.ts — tests for src/core/format-nudge.ts (v0.17.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectCodePresence, buildFormatNudgePrompt, MAX_NUDGE_ATTEMPTS } from '../src/core/format-nudge.js';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

// ---------------------------------------------------------------------------
// detectCodePresence
// ---------------------------------------------------------------------------

describe('detectCodePresence', () => {
  it('returns true for fenced block without recognized format markers', () => {
    const response = '```typescript\nconst x = 1;\nexport default x;\n```';
    assert.equal(detectCodePresence(response), true);
  });

  it('returns false when response contains SEARCH/REPLACE markers', () => {
    const response = [
      '<<<<<<< SEARCH',
      'const x = 1;',
      '=======',
      'const x = 2;',
      '>>>>>>> REPLACE',
      'filepath: src/foo.ts',
    ].join('\n');
    assert.equal(detectCodePresence(response), false);
  });

  it('returns false when response contains NEW_FILE marker', () => {
    const response = 'NEW_FILE: src/bar.ts\n```ts\nexport const y = 1;\n```';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns false for plain prose with no code fences', () => {
    const response = 'You should update the function to return the correct value. Consider adding error handling.';
    assert.equal(detectCodePresence(response), false);
  });

  it('returns true for indented code block (4 spaces) without format markers', () => {
    const response = 'Here is the fix:\n\n    const x = fixedValue;\n    return x;\n';
    assert.equal(detectCodePresence(response), true);
  });

  it('returns false when response has filepath: marker', () => {
    const response = '```ts\nconst z = 1;\n```\nfilepath: src/z.ts';
    assert.equal(detectCodePresence(response), false);
  });
});

// ---------------------------------------------------------------------------
// buildFormatNudgePrompt
// ---------------------------------------------------------------------------

describe('buildFormatNudgePrompt', () => {
  it('includes the task name in the output', () => {
    const prompt = buildFormatNudgePrompt('Add authentication middleware', '```ts\nconst x = 1;\n```');
    assert.ok(prompt.includes('Add authentication middleware'), 'should include task name');
  });

  it('includes SEARCH/REPLACE format instructions', () => {
    const prompt = buildFormatNudgePrompt('Fix bug', '```ts\nconst x = 1;\n```');
    assert.ok(prompt.includes('<<<<<<< SEARCH'), 'should include SEARCH marker');
    assert.ok(prompt.includes('>>>>>>> REPLACE'), 'should include REPLACE marker');
    assert.ok(prompt.includes('filepath:'), 'should include filepath instruction');
  });

  it('includes the original response in the output', () => {
    const original = '```ts\nexport function greet() { return "hi"; }\n```';
    const prompt = buildFormatNudgePrompt('Update greet', original);
    assert.ok(prompt.includes('export function greet()'), 'should include original code');
  });

  it('truncates responses longer than 3000 chars', () => {
    const longResponse = 'x'.repeat(4000);
    const prompt = buildFormatNudgePrompt('Long task', longResponse);
    assert.ok(prompt.includes('[response truncated]'), 'should truncate long responses');
    // The truncated portion should be at most 3000 + overhead chars from the original
    const truncatedPart = prompt.slice(prompt.indexOf('## Your previous response'));
    assert.ok(truncatedPart.length < 4000, 'truncated portion should be much shorter than 4000 chars');
  });

  it('includes "do NOT change the implementation" instruction', () => {
    const prompt = buildFormatNudgePrompt('task', '```ts\nconst x = 1;\n```');
    assert.ok(
      prompt.toLowerCase().includes('do not change the implementation') ||
      prompt.toLowerCase().includes('do not change'),
      'should instruct LLM not to change implementation',
    );
  });

  it('handles empty badResponse without throwing', () => {
    assert.doesNotThrow(() => buildFormatNudgePrompt('task', ''));
    const prompt = buildFormatNudgePrompt('task', '');
    assert.ok(typeof prompt === 'string' && prompt.length > 0);
  });
});

// ---------------------------------------------------------------------------
// MAX_NUDGE_ATTEMPTS
// ---------------------------------------------------------------------------

describe('MAX_NUDGE_ATTEMPTS', () => {
  it('is exactly 2', () => {
    assert.equal(MAX_NUDGE_ATTEMPTS, 2);
  });
});

// ---------------------------------------------------------------------------
// Nudge loop integration in executeWave
// ---------------------------------------------------------------------------

async function makeTmpState(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-nudge-test-'));
  const stateDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  const state = {
    projectName: 'nudge-test',
    currentPhase: 1,
    tasks: {
      1: [{ name: 'test task', verify: 'code runs' }],
    },
    auditLog: [] as string[],
    constitution: '',
    workflowStage: 'forge' as const,
    lessons: '',
  };
  await fs.writeFile(
    path.join(stateDir, 'STATE.yaml'),
    `projectName: nudge-test\ncurrentPhase: 1\ntasks:\n  1:\n    - name: test task\n      verify: code runs\nauditLog: []\nconstitution: ""\nworkflowStage: forge\nlessons: ""\n`,
  );
  return tmpDir;
}

describe('executeWave — format nudge integration', () => {
  it('calls _nudgeCaller when LLM returns code without SEARCH/REPLACE', async () => {
    const tmpDir = await makeTmpState();
    let nudgeCalled = false;

    await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async () => '```typescript\nconst x = 1;\nexport default x;\n```',
      _nudgeCaller: async (p: string) => {
        nudgeCalled = true;
        assert.ok(p.includes('SEARCH/REPLACE'), 'nudge prompt should include format instructions');
        // Return proper format so it stops nudging
        return [
          '<<<<<<< SEARCH',
          'const old = 1;',
          '=======',
          'const x = 1;',
          '>>>>>>> REPLACE',
          'filepath: src/test.ts',
        ].join('\n');
      },
      _codeWriter: async () => ({ operations: [], filesWritten: [], filesFailedToApply: [], success: true }),
      _testRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _typecheckRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _verifier: async () => true,
      _reflector: async () => ({ taskName: 'test task', score: 8, complete: true, feedback: '', timestamp: new Date().toISOString() }),
    });

    assert.ok(nudgeCalled, '_nudgeCaller should have been called');
  });

  it('does NOT call _nudgeCaller when LLM already uses SEARCH/REPLACE', async () => {
    const tmpDir = await makeTmpState();
    let nudgeCalled = false;

    await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async () => [
        '<<<<<<< SEARCH',
        'const x = 1;',
        '=======',
        'const x = 2;',
        '>>>>>>> REPLACE',
        'filepath: src/test.ts',
      ].join('\n'),
      _nudgeCaller: async () => {
        nudgeCalled = true;
        return 'should not be called';
      },
      _codeWriter: async () => ({ operations: [], filesWritten: ['src/test.ts'], filesFailedToApply: [], success: true }),
      _testRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _typecheckRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _verifier: async () => true,
      _reflector: async () => ({ taskName: 'test task', score: 8, complete: true, feedback: '', timestamp: new Date().toISOString() }),
    });

    assert.equal(nudgeCalled, false, '_nudgeCaller should NOT be called when format is correct');
  });

  it('does NOT call _nudgeCaller when LLM returns pure prose (no code at all)', async () => {
    const tmpDir = await makeTmpState();
    let nudgeCalled = false;

    await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async () => 'You need to update the function to return the correct value. Make sure to add error handling.',
      _nudgeCaller: async () => {
        nudgeCalled = true;
        return 'should not be called';
      },
      _codeWriter: async () => ({ operations: [], filesWritten: [], filesFailedToApply: [], success: true }),
      _verifier: async () => true,
      _reflector: async () => ({ taskName: 'test task', score: 5, complete: false, feedback: 'no code', timestamp: new Date().toISOString() }),
    });

    assert.equal(nudgeCalled, false, 'nudge should not fire when there is no code at all');
  });

  it('falls back to _llmCaller for nudging when _nudgeCaller is not provided', async () => {
    const tmpDir = await makeTmpState();
    const calls: string[] = [];

    await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async (p: string) => {
        calls.push(p.slice(0, 50));
        if (calls.length === 1) {
          // First call: wrong format
          return '```typescript\nconst updated = true;\n```';
        }
        // Subsequent calls (nudge attempts): proper format
        return [
          '<<<<<<< SEARCH',
          'const x = 1;',
          '=======',
          'const updated = true;',
          '>>>>>>> REPLACE',
          'filepath: src/test.ts',
        ].join('\n');
      },
      _codeWriter: async () => ({ operations: [], filesWritten: ['src/test.ts'], filesFailedToApply: [], success: true }),
      _testRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _typecheckRunner: async () => ({ passed: true, exitCode: 0, stdout: '', stderr: '', durationMs: 0, failingTests: [], typecheckErrors: [] }),
      _verifier: async () => true,
      _reflector: async () => ({ taskName: 'test task', score: 8, complete: true, feedback: '', timestamp: new Date().toISOString() }),
    });

    assert.ok(calls.length >= 2, '_llmCaller should be called at least twice (initial + nudge)');
  });

  it('calls _nudgeCaller at most MAX_NUDGE_ATTEMPTS times', async () => {
    const tmpDir = await makeTmpState();
    let nudgeCallCount = 0;

    await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async () => '```typescript\nconst x = 1;\n```',
      _nudgeCaller: async () => {
        nudgeCallCount++;
        // Always return wrong format to exhaust nudge attempts
        return '```typescript\nconst still_wrong = true;\n```';
      },
      _codeWriter: async () => ({ operations: [], filesWritten: [], filesFailedToApply: [], success: true }),
      _verifier: async () => true,
      _reflector: async () => ({ taskName: 'test task', score: 5, complete: false, feedback: 'no code', timestamp: new Date().toISOString() }),
    });

    assert.ok(nudgeCallCount <= MAX_NUDGE_ATTEMPTS, `nudge should be called at most ${MAX_NUDGE_ATTEMPTS} times, got ${nudgeCallCount}`);
  });

  it('gracefully degrades when nudge exhausts and falls through to verifier', async () => {
    const tmpDir = await makeTmpState();
    let verifierCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 30_000, {
      cwd: tmpDir,
      _llmCaller: async () => '```typescript\nconst x = 1;\n```',
      _nudgeCaller: async () => '```typescript\nstill no format\n```',
      _codeWriter: async () => ({ operations: [], filesWritten: [], filesFailedToApply: [], success: true }),
      _verifier: async () => {
        verifierCalled = true;
        return true;
      },
      _reflector: async () => ({ taskName: 'test task', score: 5, complete: false, feedback: 'no format', timestamp: new Date().toISOString() }),
    });

    assert.ok(verifierCalled, 'verifier should be called even when nudge exhausts');
    assert.equal(result.mode, 'executed');
  });
});
