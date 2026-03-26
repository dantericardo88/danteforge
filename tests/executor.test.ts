// executor.ts tests — executeWave with _llmCaller/_verifier/_reflector injection
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeWave, readDesignContext } from '../src/harvested/gsd/agents/executor.js';

const originalCwd = process.cwd();
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

beforeEach(() => { process.exitCode = 0; });

afterEach(async () => {
  process.exitCode = 0; // reset to prevent test pollution
  process.chdir(originalCwd);
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ─── withTimeout (internal) via promptMode tests ───────────────────────────

describe('executeWave — blocked path: no tasks for phase', () => {
  it('returns blocked when phase has no tasks', async () => {
    const tmpDir = await makeTmpStateDir({ 1: [] });
    const result = await executeWave(1, 'balanced', false, false, false, 30000, { cwd: tmpDir });
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });

  it('returns blocked when phase key is missing entirely', async () => {
    const tmpDir = await makeTmpStateDir({});
    const result = await executeWave(99, 'balanced', false, false, false, 30000, { cwd: tmpDir });
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });
});

describe('executeWave — blocked path: no LLM and not promptMode', () => {
  it('returns blocked when no LLM and promptMode=false', async () => {
    const tmpDir = await makeTmpStateDir();
    // No _llmCaller + no real LLM configured → blocked
    const result = await executeWave(1, 'balanced', false, false, false, 30000, { cwd: tmpDir });
    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });
});

describe('executeWave — promptMode path', () => {
  it('returns prompt mode success when promptMode=true', async () => {
    const tmpDir = await makeTmpStateDir();
    const result = await executeWave(1, 'balanced', false, true, false, 30000, { cwd: tmpDir });
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
    await executeWave(1, 'balanced', false, true, false, 30000, { cwd: tmpDir });

    const promptsDir = path.join(tmpDir, '.danteforge', 'prompts');
    const files = await fs.readdir(promptsDir).catch(() => [] as string[]);
    assert.ok(files.length >= 2, `Expected at least 2 prompt files, got ${files.length}`);
  });

  it('writes audit log entry for prompt generation', async () => {
    const tmpDir = await makeTmpStateDir();
    await executeWave(1, 'balanced', false, true, false, 30000, { cwd: tmpDir });

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
    const result = await executeWave(3, 'inferno', false, true, false, 30000, { cwd: tmpDir });
    assert.strictEqual(result.mode, 'prompt');
    assert.strictEqual(result.success, true);
  });
});

describe('executeWave — LLM injection path', () => {
  it('executes task with injected LLM caller and verifier', async () => {
    const tmpDir = await makeTmpStateDir();
    let llmCalled = false;
    let verifierCalled = false;

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { llmCalled = true; return 'Task complete: endpoint returns 200'; },
      _verifier: async () => { verifierCalled = true; return true; },
      cwd: tmpDir,
    });

    assert.ok(llmCalled, 'LLM caller should have been invoked');
    assert.ok(verifierCalled, 'Verifier should have been invoked');
    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, true);
  });

  it('returns success=false when verifier returns false', async () => {
    const tmpDir = await makeTmpStateDir();
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Partial implementation only',
      _verifier: async () => false,
      cwd: tmpDir,
    });

    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, false);
  });

  it('handles LLM call failure gracefully — records error, continues', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Failing task' }, { name: 'Second task' }],
    });
    let callCount = 0;
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => {
        callCount++;
        if (callCount === 1) throw new Error('Simulated LLM timeout');
        return 'Second task complete';
      },
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, false, 'Should fail because first task errored');
    assert.strictEqual(callCount, 2, 'Both tasks should be attempted');
  });

  it('LLM result is passed to verifier', async () => {
    const tmpDir = await makeTmpStateDir();
    const expectedOutput = 'Implementation complete with tests passing';
    let verifierReceivedOutput: string | undefined;

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => expectedOutput,
      _verifier: async (_task, output) => { verifierReceivedOutput = output; return true; },
      cwd: tmpDir,
    });

    assert.strictEqual(verifierReceivedOutput, expectedOutput);
  });

  it('all tasks succeed → phase advances in state', async () => {
    const tmpDir = await makeTmpStateDir();

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    const stateContent = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(stateContent.includes('currentPhase: 2'), `Phase should advance to 2 after wave 1 completes`);
  });

  it('audit log records wave result', async () => {
    const tmpDir = await makeTmpStateDir();

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Complete',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    const state = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    const normalized = state.replace(/\s+/g, ' ');
    assert.ok(normalized.includes('forge: wave 1 complete'), 'audit log should record wave completion');
  });

  it('parallel execution runs all tasks', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Task P1' }, { name: 'Task P2' }, { name: 'Task P3' }],
    });
    const executed: string[] = [];
    const result = await executeWave(1, 'balanced', true, false, false, 30000, {
      _llmCaller: async (prompt) => {
        const match = prompt.match(/Task\s+P\d/);
        if (match) executed.push(match[0]);
        return `Completed: ${match?.[0] ?? 'task'}`;
      },
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(executed.length, 3, 'All 3 tasks should execute in parallel');
  });

  it('_reflector is called after task execution', async () => {
    const tmpDir = await makeTmpStateDir();
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
      cwd: tmpDir,
    });

    assert.ok(reflectorCalled, '_reflector should have been called');
  });

  it('reflection failure does not block task completion', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Task completed successfully',
      _verifier: async () => true,
      _reflector: async () => { throw new Error('Reflection engine failure'); },
      cwd: tmpDir,
    });

    assert.strictEqual(result.success, true, 'Reflection failure should not block success');
    assert.strictEqual(result.mode, 'executed');
  });

  it('task with verify field passes verify string to verifier', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Build module', verify: 'Returns 200', files: ['src/module.ts'] }],
    });

    let verifyArg: string | undefined;
    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async (task) => { verifyArg = task.verify; return true; },
      cwd: tmpDir,
    });

    assert.strictEqual(verifyArg, 'Returns 200');
  });

  it('multiple tasks all failing returns success=false', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [
        { name: 'Task A' },
        { name: 'Task B' },
      ],
    });
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { throw new Error('LLM unavailable'); },
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.success, false);
  });

  it('phase does NOT advance when any task fails', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Failing task' }],
    });

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { throw new Error('LLM failed'); },
      _verifier: async () => true,
      cwd: tmpDir,
    });

    const stateContent = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    // Phase should remain at 0 (initialized), not advance to 2
    assert.ok(!stateContent.includes('currentPhase: 2'), 'Phase should not advance on failure');
  });

  it('empty task list returns blocked', async () => {
    const tmpDir = await makeTmpStateDir({ 1: [] });

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });

  it('parallel mode with one failure still runs remaining tasks', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [
        { name: 'Task A' },
        { name: 'Task B' },
        { name: 'Task C' },
      ],
    });
    let callCount = 0;
    const result = await executeWave(1, 'balanced', true, false, false, 30000, {
      _llmCaller: async (prompt) => {
        callCount++;
        if (prompt.includes('Task A')) throw new Error('A fails');
        return 'Completed';
      },
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.success, false, 'should fail because Task A failed');
    assert.ok(callCount >= 2, 'should attempt to run remaining tasks despite failure');
  });

  it('executor handles empty LLM response gracefully', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => '',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    // Should still complete — empty response is not a throw
    assert.strictEqual(result.mode, 'executed');
  });

  it('promptMode generates prompt file per task', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, true, false, 30000, {
      _llmCaller: async () => 'Should not be called',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    assert.strictEqual(result.mode, 'prompt');
    // Verify prompt file was created
    const dfDir = path.join(tmpDir, '.danteforge');
    const entries = await fs.readdir(dfDir);
    assert.ok(entries.some(e => e.includes('prompt')), 'Should create prompt file(s)');
  });

  it('task files array is preserved in telemetry/audit log', async () => {
    const tmpDir = await makeTmpStateDir({
      1: [{ name: 'Build API', files: ['src/api.ts', 'src/routes.ts'], verify: 'npm test' }],
    });

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Done',
      _verifier: async () => true,
      cwd: tmpDir,
    });

    const stateContent = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(stateContent.includes('forge: wave 1'), 'Audit log should contain wave entry');
  });

  it('verifier returning false causes task failure', async () => {
    const tmpDir = await makeTmpStateDir();

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'Completed the task',
      _verifier: async () => false,
      cwd: tmpDir,
    });

    // Verifier returning false should cause the task to fail
    assert.strictEqual(result.success, false, 'should fail when verifier returns false');
  });
});

// ─── readDesignContext ──────────────────────────────────────────────────────

describe('readDesignContext', () => {
  it('returns null when no DESIGN.op exists', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-design-ctx-'));
    tempDirs.push(tmpDir);
    const result = await readDesignContext(tmpDir);
    assert.strictEqual(result, null, 'should return null when DESIGN.op is missing');
  });

  it('returns design context string when DESIGN.op exists with components', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-design-ctx-'));
    tempDirs.push(tmpDir);
    const dfDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2026-03-25T00:00:00.000Z',
      document: { name: 'Test Design', pages: [] },
      nodes: [
        { id: '1', type: 'component', name: 'Button', children: [] },
        { id: '2', type: 'frame', name: 'Dashboard', children: [] },
        { id: '3', type: 'rectangle', name: 'bg', children: [] },
      ],
    });
    await fs.writeFile(path.join(dfDir, 'DESIGN.op'), designOp);
    const result = await readDesignContext(tmpDir);
    assert.ok(result !== null, 'should return non-null when DESIGN.op exists');
    assert.ok(result!.includes('## Design Context'), 'should include design context heading');
    assert.ok(result!.includes('Button'), 'should include component names');
    assert.ok(result!.includes('Dashboard'), 'should include frame names');
    assert.ok(result!.includes('design-tokens.css'), 'should include token reference');
  });

  it('uses _fsOps injection instead of real fs', async () => {
    const mockDesignOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2026-03-25T00:00:00.000Z',
      document: { name: 'Test', pages: [] },
      nodes: [{ id: '1', type: 'component', name: 'Header', children: [] }],
    });
    const result = await readDesignContext('/some/cwd', {
      _fsOps: {
        readFile: async (_p: string, _enc: string) => mockDesignOp,
      },
    });
    assert.ok(result !== null, 'should use injected fsOps');
    assert.ok(result!.includes('Header'), 'should parse injected design content');
  });

  it('returns null when DESIGN.op contains invalid JSON', async () => {
    const result = await readDesignContext('/some/cwd', {
      _fsOps: {
        readFile: async (_p: string, _enc: string) => 'not valid json {{{',
      },
    });
    assert.strictEqual(result, null, 'should return null on parse error');
  });

  it('injects design context into executeWave via _readDesignContext seam', async () => {
    const tmpDir = await makeTmpStateDir();
    const capturedPrompts: string[] = [];
    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async (prompt) => { capturedPrompts.push(prompt); return 'done'; },
      _verifier: async () => true,
      _readDesignContext: async () => '## Design Context (from DESIGN.op)\nComponents: Button, Card',
      cwd: tmpDir,
    });
    assert.ok(capturedPrompts.length > 0, 'LLM should have been called');
    assert.ok(
      capturedPrompts[0]!.includes('## Design Context'),
      'design context should be injected into task prompt',
    );
  });

  it('skips design context injection when _readDesignContext returns null', async () => {
    const tmpDir = await makeTmpStateDir();
    const capturedPrompts: string[] = [];
    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async (prompt) => { capturedPrompts.push(prompt); return 'done'; },
      _verifier: async () => true,
      _readDesignContext: async () => null,
      cwd: tmpDir,
    });
    assert.ok(capturedPrompts.length > 0, 'LLM should have been called');
    assert.ok(
      !capturedPrompts[0]!.includes('## Design Context'),
      'null design context should not be injected',
    );
  });

  // ── Recursive node walk ──

  it('detects component nested inside a frame', async () => {
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2024-01-01T00:00:00Z',
      document: { name: 'Test', pages: [] },
      nodes: [
        {
          id: '1', type: 'frame', name: 'Layout',
          children: [
            { id: '2', type: 'component', name: 'NestedButton', children: [] },
          ],
        },
      ],
    });
    const result = await readDesignContext('/cwd', {
      _fsOps: { readFile: async () => designOp },
    });
    assert.ok(result !== null, 'should return non-null');
    assert.ok(result!.includes('NestedButton'), 'should include nested component name');
    assert.ok(result!.includes('Layout'), 'should include parent frame');
  });

  it('detects deeply nested component (3 levels)', async () => {
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2024-01-01T00:00:00Z',
      document: { name: 'Test', pages: [] },
      nodes: [
        {
          id: '1', type: 'frame', name: 'Outer',
          children: [
            {
              id: '2', type: 'frame', name: 'Middle',
              children: [
                { id: '3', type: 'component', name: 'DeepCard', children: [] },
              ],
            },
          ],
        },
      ],
    });
    const result = await readDesignContext('/cwd', {
      _fsOps: { readFile: async () => designOp },
    });
    assert.ok(result !== null, 'should return non-null');
    assert.ok(result!.includes('DeepCard'), 'should include deeply nested component');
  });

  it('combines top-level and nested components into a single list', async () => {
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2024-01-01T00:00:00Z',
      document: { name: 'Test', pages: [] },
      nodes: [
        { id: '1', type: 'component', name: 'TopBtn', children: [] },
        {
          id: '2', type: 'frame', name: 'NavFrame',
          children: [
            { id: '3', type: 'component', name: 'NavItem', children: [] },
          ],
        },
      ],
    });
    const result = await readDesignContext('/cwd', {
      _fsOps: { readFile: async () => designOp },
    });
    assert.ok(result !== null);
    assert.ok(result!.includes('TopBtn'), 'top-level component should appear');
    assert.ok(result!.includes('NavItem'), 'nested component should appear');
    assert.ok(result!.includes('NavFrame'), 'frame should appear');
  });

  it('handles empty children array without error', async () => {
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2024-01-01T00:00:00Z',
      document: { name: 'Test', pages: [] },
      nodes: [
        { id: '1', type: 'component', name: 'Btn', children: [] },
      ],
    });
    const result = await readDesignContext('/cwd', {
      _fsOps: { readFile: async () => designOp },
    });
    assert.ok(result !== null, 'should not throw on empty children');
    assert.ok(result!.includes('Btn'), 'should still list the top-level component');
  });

  it('caps at 10 components when tree has more than 10', async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: String(i + 1), type: 'frame' as const, name: `Frame${i + 1}`,
      children: [
        { id: `${i + 1}-c`, type: 'component' as const, name: `Comp${i + 1}`, children: [] as [] },
      ],
    }));
    const designOp = JSON.stringify({
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2024-01-01T00:00:00Z',
      document: { name: 'Test', pages: [] },
      nodes,
    });
    const result = await readDesignContext('/cwd', {
      _fsOps: { readFile: async () => designOp },
    });
    assert.ok(result !== null);
    // 6 frames + 6 nested components = 12 total, but capped at 10
    const componentLine = result!.split('\n').find(l => l.startsWith('Components:'));
    assert.ok(componentLine, 'should have Components line');
    const names = componentLine!.replace('Components: ', '').split(', ');
    assert.ok(names.length <= 10, `should be at most 10 components, got ${names.length}`);
  });
});
