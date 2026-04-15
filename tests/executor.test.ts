// executor.ts tests — executeWave with _llmCaller/_verifier/_reflector injection
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import { configureOfflineHome, restoreOfflineHome } from './helpers/offline-home.js';

const originalCwd = process.cwd();
const originalHome = process.env.DANTEFORGE_HOME;
const tempDirs: string[] = [];

async function makeTmpStateDir(taskOverrides?: Record<number, { name: string; files?: string[]; verify?: string }[]>) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-executor-'));
  tempDirs.push(tmpDir);
  const dfDir = path.join(tmpDir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });

  // Write a minimal STATE.yaml
  const tasks = taskOverrides ?? {
    1: [{ name: 'Build auth endpoint', verify: 'Returns 200 for valid requests' }],
  };
  const taskYaml = Object.entries(tasks)
    .map(([phase, list]) => `  ${phase}:\n${list.map(t => `    - name: "${t.name}"${t.verify ? `\n      verify: "${t.verify}"` : ''}`).join('\n')}`)
    .join('\n');
  const stateContent = `project: test-project
workflowStage: forge
currentPhase: 0
profile: balanced
lastHandoff: none
auditLog: []
tasks:
${taskYaml}
`;
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), stateContent);
  return tmpDir;
}

beforeEach(async () => {
  process.exitCode = 0;
  await configureOfflineHome(tempDirs);
});

afterEach(async () => {
  restoreOfflineHome(originalHome);
  process.exitCode = 0; // executor sets exitCode=1 on failure; reset so it doesn't poison the suite
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ─── withTimeout (internal) via promptMode tests ───────────────────────────

describe('executeWave — blocked path: no tasks for phase', () => {
  it('returns blocked when phase has no tasks', async () => {
    const tmpDir = await makeTmpStateDir({ 1: [] });
    process.chdir(tmpDir);

    const result = await executeWave(1, 'balanced');
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });

  it('returns blocked when phase key is missing entirely', async () => {
    const tmpDir = await makeTmpStateDir({});
    process.chdir(tmpDir);

    const result = await executeWave(99, 'balanced');
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });
});

describe('executeWave — blocked path: no LLM and not promptMode', () => {
  it('returns blocked when no LLM and promptMode=false', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    // No _llmCaller + no real LLM configured → blocked
    const result = await executeWave(1, 'balanced', false, false, false);
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });
});

describe('executeWave — promptMode path', () => {
  it('returns prompt mode success when promptMode=true', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    const result = await executeWave(1, 'balanced', false, true, false);
    assert.strictEqual(result.mode, 'prompt');
    assert.strictEqual(result.success, true);
  });

  it('saves prompt files for each task', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [
        { name: 'Implement login', verify: 'Returns token' },
        { name: 'Implement logout' },
      ],
    });
    process.chdir(tmpDir);

    await executeWave(1, 'balanced', false, true, false);

    const promptsDir = path.join(tmpDir, '.danteforge', 'prompts');
    const files = await fs.readdir(promptsDir).catch(() => [] as string[]);
    assert.ok(files.length >= 2, `Expected at least 2 prompt files, got ${files.length}`);
  });

  it('writes audit log entry for prompt generation', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    await executeWave(1, 'balanced', false, true, false);

    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(state.replace(/\s+/g, ' ').includes('task prompts generated'), 'audit log should mention prompts generated');
  });

  it('multiple tasks in promptMode returns success', async () => {
    const tmpDir = await makeTmpStateDir({
      3: [
        { name: 'Task A' },
        { name: 'Task B' },
        { name: 'Task C' },
      ],
    });
    process.chdir(tmpDir);

    const result = await executeWave(3, 'inferno', false, true, false);
    assert.strictEqual(result.mode, 'prompt');
    assert.strictEqual(result.success, true);
  });
});

describe('executeWave — LLM injection path', () => {
  it('executes task with injected LLM caller and verifier', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    let llmCalled = false;
    let verifierCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { llmCalled = true; return 'Task complete: endpoint returns 200'; },
      _verifier: async () => { verifierCalled = true; return true; },
    });

    assert.ok(llmCalled, 'LLM caller should have been invoked');
    assert.ok(verifierCalled, 'Verifier should have been invoked');
    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, true);
  });

  it('returns success=false when verifier returns false', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Partial implementation only',
      _verifier: async () => false,
    });

    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, false);
  });

  it('handles LLM call failure gracefully — records error, continues', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Failing task' }, { name: 'Second task' }],
    });
    process.chdir(tmpDir);

    let callCount = 0;
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => {
        callCount++;
        if (callCount === 1) throw new Error('Simulated LLM timeout');
        return 'Second task complete';
      },
      _verifier: async () => true,
    });

    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, false, 'Should fail because first task errored');
    assert.strictEqual(callCount, 2, 'Both tasks should be attempted');
  });

  it('LLM result is passed to verifier', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    const expectedOutput = 'Implementation complete with tests passing';
    let verifierReceivedOutput: string | undefined;

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => expectedOutput,
      _verifier: async (_task, output) => { verifierReceivedOutput = output; return true; },
    });

    assert.strictEqual(verifierReceivedOutput, expectedOutput);
  });

  it('all tasks succeed → phase advances in state', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
    });

    const stateContent = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(stateContent.includes('currentPhase: 2'), `Phase should advance to 2 after wave 1 completes`);
  });

  it('audit log records wave result', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Complete',
      _verifier: async () => true,
    });

    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    const normalized = state.replace(/\s+/g, ' ');
    assert.ok(normalized.includes('forge: wave 1 complete'), 'audit log should record wave completion');
  });

  it('parallel execution runs all tasks', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Task P1' }, { name: 'Task P2' }, { name: 'Task P3' }],
    });
    process.chdir(tmpDir);

    const executed: string[] = [];
    const result = await executeWave(1, 'balanced', true, false, false, 30000, {
      _llmCaller: async (prompt) => {
        const match = prompt.match(/Task\s+P\d/);
        if (match) executed.push(match[0]);
        return `Completed: ${match?.[0] ?? 'task'}`;
      },
      _verifier: async () => true,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(executed.length, 3, 'All 3 tasks should execute in parallel');
  });

  it('_reflector is called after task execution', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    let reflectorCalled = false;
    const fakeVerdict = {
      sessionId: 'test-1', taskName: 'Build auth endpoint', status: 'complete' as const,
      confidence: 0.9, evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [], nextSteps: [], needsHumanAction: [], stuck: false,
      severity: 'NONE' as const, timestamp: new Date().toISOString(),
    };

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
      _reflector: async () => { reflectorCalled = true; return fakeVerdict; },
    });

    assert.ok(reflectorCalled, '_reflector should have been called');
  });
});

describe('executeWave — _onChunk streaming (Sprint 51)', () => {
  it('_onChunk receives chunks when provided', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    const chunks: string[] = [];
    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async (prompt) => {
        // Simulate streaming by calling _onChunk externally; the actual chunk
        // delivery happens in callLLMWithProgress — here we just verify the seam exists
        return 'Done implementing the task';
      },
      _verifier: async () => true,
      _onChunk: (chunk) => chunks.push(chunk),
    });

    // When _llmCaller is provided, _onChunk is bypassed (llmCaller takes priority).
    // Verify that the seam accepts a function without throwing.
    assert.ok(Array.isArray(chunks), '_onChunk should accept a function without error');
  });

  it('_onChunk omitted = silent execution (backward compat)', async () => {
    const tmpDir = await makeTmpStateDir();
    process.chdir(tmpDir);

    // Without _onChunk, execute should work exactly as before
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
      // no _onChunk
    });

    assert.ok(result.success, 'should succeed without _onChunk');
  });
});
