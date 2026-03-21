import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ExecutionTelemetry } from '../src/core/execution-telemetry.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTempDir(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('ReflectionEngine', () => {
  it('evaluateVerdict returns complete when all gates pass', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-1',
      taskName: 'test-task',
      status: 'complete' as const,
      confidence: 0.95,
      evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'NONE' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, true);
    assert.strictEqual(result.missing.length, 0);
    assert.ok(result.score >= 80);
  });

  it('evaluateVerdict returns missing items when tests not run', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-2',
      taskName: 'test-task',
      status: 'in_progress' as const,
      confidence: 0.9,
      evidence: {
        tests: { ran: false, passed: false, ranAfterChanges: false },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'LOW' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.ok(result.missing.some(m => m.includes('Tests were not run')));
  });

  it('evaluateVerdict flags low confidence', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-3',
      taskName: 'test-task',
      status: 'complete' as const,
      confidence: 0.3,
      evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'NONE' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.ok(result.missing.some(m => m.includes('Confidence')));
  });

  it('evaluateVerdict detects stuck agent', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-4',
      taskName: 'stuck-task',
      status: 'stuck' as const,
      confidence: 0.2,
      evidence: {
        tests: { ran: false, passed: false, ranAfterChanges: false },
        build: { ran: false, passed: false, ranAfterChanges: false },
        lint: { ran: false, passed: false, ranAfterChanges: false },
      },
      remainingWork: ['Fix the bug'],
      nextSteps: [],
      needsHumanAction: [],
      stuck: true,
      severity: 'HIGH' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.ok(result.missing.some(m => m.includes('stuck')));
    assert.ok(result.score < 30);
  });

  it('evaluateVerdict includes remaining work in missing list', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-5',
      taskName: 'partial-task',
      status: 'in_progress' as const,
      confidence: 0.85,
      evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: ['Implement error handling', 'Add edge case tests'],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'LOW' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.ok(result.missing.some(m => m.includes('error handling')));
    assert.ok(result.missing.some(m => m.includes('edge case')));
  });

  it('evaluateVerdict flags needs human action', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'test-6',
      taskName: 'human-task',
      status: 'blocked' as const,
      confidence: 0.9,
      evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: ['Approve API key access'],
      stuck: false,
      severity: 'MEDIUM' as const,
      timestamp: new Date().toISOString(),
    };

    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.ok(result.missing.some(m => m.includes('human action')));
  });

  it('hook registration and execution', async () => {
    const { registerHook, clearHooks } = await import('../src/core/reflection-engine.js');
    clearHooks();

    let hookCalled = false;
    registerHook(async () => { hookCalled = true; });

    // Hook is called internally by reflect(); we test registration works
    assert.strictEqual(hookCalled, false); // Not called yet
    clearHooks(); // Cleanup
  });

  it('loadLatestVerdict returns null when no reflections exist', async () => {
    const { loadLatestVerdict } = await import('../src/core/reflection-engine.js');
    const tmpDir = await makeTempDir('danteforge-reflection-');
    const result = await loadLatestVerdict(tmpDir);
    assert.strictEqual(result, null);
  });
});

// ─── Additional evaluateVerdict branch tests ──────────────────────────────

describe('evaluateVerdict — branch coverage', () => {
  function makeGoodEvidence() {
    return {
      tests: { ran: true, passed: true, ranAfterChanges: true },
      build: { ran: true, passed: true, ranAfterChanges: true },
      lint: { ran: true, passed: true, ranAfterChanges: true },
    };
  }

  it('flags tests ran+passed but not ranAfterChanges', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'ev-1',
      taskName: 'test-task',
      status: 'complete' as const,
      confidence: 0.9,
      evidence: {
        ...makeGoodEvidence(),
        tests: { ran: true, passed: true, ranAfterChanges: false },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'NONE' as const,
      timestamp: new Date().toISOString(),
    };
    const result = evaluateVerdict(verdict);
    assert.ok(result.missing.some(m => m.includes('not re-run after code changes')));
  });

  it('flags tests ran but not passed', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'ev-2',
      taskName: 'test-task',
      status: 'in_progress' as const,
      confidence: 0.9,
      evidence: {
        ...makeGoodEvidence(),
        tests: { ran: true, passed: false, ranAfterChanges: false },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'LOW' as const,
      timestamp: new Date().toISOString(),
    };
    const result = evaluateVerdict(verdict);
    assert.ok(result.missing.some(m => m.includes('Tests did not pass')));
  });

  it('flags build ran but not passed', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'ev-3',
      taskName: 'test-task',
      status: 'in_progress' as const,
      confidence: 0.9,
      evidence: {
        ...makeGoodEvidence(),
        build: { ran: true, passed: false, ranAfterChanges: false },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'LOW' as const,
      timestamp: new Date().toISOString(),
    };
    const result = evaluateVerdict(verdict);
    assert.ok(result.missing.some(m => m.includes('Build failed')));
  });

  it('flags lint ran but not passed', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'ev-4',
      taskName: 'test-task',
      status: 'in_progress' as const,
      confidence: 0.9,
      evidence: {
        ...makeGoodEvidence(),
        lint: { ran: true, passed: false, ranAfterChanges: false },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      severity: 'LOW' as const,
      timestamp: new Date().toISOString(),
    };
    const result = evaluateVerdict(verdict);
    assert.ok(result.missing.some(m => m.includes('Lint failed')));
  });

  it('score is 0 for completely failed verdict', async () => {
    const { evaluateVerdict } = await import('../src/core/reflection-engine.js');
    const verdict = {
      sessionId: 'ev-5',
      taskName: 'zero-task',
      status: 'stuck' as const,
      confidence: 0.0,
      evidence: {
        tests: { ran: false, passed: false, ranAfterChanges: false },
        build: { ran: false, passed: false, ranAfterChanges: false },
        lint: { ran: false, passed: false, ranAfterChanges: false },
      },
      remainingWork: ['Fix everything'],
      nextSteps: [],
      needsHumanAction: [],
      stuck: true,
      severity: 'HIGH' as const,
      timestamp: new Date().toISOString(),
    };
    const result = evaluateVerdict(verdict);
    assert.strictEqual(result.complete, false);
    assert.strictEqual(result.score, 0);
  });
});

// ─── reflect() heuristic path tests ───────────────────────────────────────

describe('reflect() heuristic execution', () => {
  const originalCwd = process.cwd();
  const tempDirsReflect: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    while (tempDirsReflect.length > 0) {
      const dir = tempDirsReflect.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  function makeTelemetry(overrides: Partial<ExecutionTelemetry> = {}): ExecutionTelemetry {
    return {
      toolCalls: [],
      bashCommands: [],
      filesModified: [],
      duration: 1500,
      tokenEstimate: 0,
      ...overrides,
    };
  }

  it('heuristic: no writes → "stuck" verdict persisted to disk', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-stuck-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const verdict = await reflect('Build feature', '', makeTelemetry(), { cwd: tmpDir });

    assert.strictEqual(verdict.status, 'stuck');
    assert.strictEqual(verdict.stuck, true);
    assert.ok(verdict.remainingWork.length > 0, 'stuck verdict should have remaining work');

    // Verify verdict was persisted to disk
    const dir = path.join(tmpDir, '.danteforge', 'reflections');
    const files = await fs.readdir(dir);
    assert.ok(files.length > 0, 'verdict should be persisted');
  });

  it('heuristic: mentions "failed" → "blocked" verdict', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-blocked-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const verdict = await reflect(
      'Run tests',
      'Tests failed: AssertionError at line 42',
      makeTelemetry(),
      { cwd: tmpDir },
    );

    assert.strictEqual(verdict.status, 'blocked');
    assert.ok(verdict.remainingWork.some(w => w.includes('failing')));
  });

  it('heuristic: has writes + mentions "passed" → "complete" verdict', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-complete-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const telemetry = makeTelemetry({
      toolCalls: [{ name: 'write', timestamp: Date.now(), isWrite: true }],
    });

    const verdict = await reflect(
      'Add feature',
      'All tests passed. Implementation complete.',
      telemetry,
      { cwd: tmpDir },
    );

    assert.strictEqual(verdict.status, 'complete');
    assert.ok(verdict.confidence > 0.5, 'complete verdict should have good confidence');
  });

  it('loadLatestVerdict retrieves the most recently persisted verdict', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-load-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect, loadLatestVerdict } = await import('../src/core/reflection-engine.js');

    await reflect('My task', '', makeTelemetry(), { cwd: tmpDir });
    const loaded = await loadLatestVerdict(tmpDir);

    assert.ok(loaded !== null, 'should find the persisted verdict');
    assert.strictEqual(loaded!.taskName, 'My task');
  });

  it('registered hook is called after reflect()', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-hook-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect, registerHook, clearHooks } = await import('../src/core/reflection-engine.js');

    clearHooks();
    let hookCalledWith: string | null = null;

    registerHook(async (verdict) => {
      hookCalledWith = verdict.taskName;
    });

    await reflect('Hook test task', '', makeTelemetry(), { cwd: tmpDir });

    assert.strictEqual(hookCalledWith, 'Hook test task', 'hook should be called with the verdict');
    clearHooks();
  });

  it('reflect() returns verdict with sessionId, timestamp, and severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-fields-'));
    tempDirsReflect.push(tmpDir);
    process.chdir(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const verdict = await reflect('Fields test', '', makeTelemetry(), { cwd: tmpDir });

    assert.ok(typeof verdict.sessionId === 'string' && verdict.sessionId.length > 0);
    assert.ok(typeof verdict.timestamp === 'string' && verdict.timestamp.length > 0);
    assert.ok(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'BLOCKER'].includes(verdict.severity));
  });
});

// ─── reflect() LLM-injection path tests ─────────────────────────────────────

describe('reflect() with _llmCaller injection', () => {
  const tempDirsLLM: string[] = [];

  afterEach(async () => {
    while (tempDirsLLM.length > 0) {
      const dir = tempDirsLLM.pop();
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  });

  function makeTelemetry(overrides: Partial<ExecutionTelemetry> = {}): ExecutionTelemetry {
    return { toolCalls: [], bashCommands: [], filesModified: [], duration: 500, tokenEstimate: 0, ...overrides };
  }

  function makeValidJSON(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      status: 'complete',
      confidence: 0.9,
      evidence: {
        tests: { ran: true, passed: true, ranAfterChanges: true },
        build: { ran: true, passed: true, ranAfterChanges: true },
        lint: { ran: true, passed: true, ranAfterChanges: true },
      },
      remainingWork: [],
      nextSteps: [],
      needsHumanAction: [],
      stuck: false,
      ...overrides,
    });
  }

  it('uses _llmCaller response to build verdict via parseVerdictJSON + normalizeVerdict', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-llm-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const verdict = await reflect(
      'LLM task',
      'Some output',
      makeTelemetry(),
      { cwd: tmpDir, _llmCaller: async () => makeValidJSON() },
    );

    assert.strictEqual(verdict.status, 'complete');
    assert.strictEqual(verdict.confidence, 0.9);
    assert.ok(verdict.sessionId.startsWith('llm-'), 'LLM path sets sessionId prefix to "llm-"');
    assert.strictEqual(verdict.evidence.tests.passed, true);
  });

  it('LLM path: markdown-fenced JSON is parsed correctly', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-fence-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const fencedJSON = `\`\`\`json\n${makeValidJSON({ status: 'in_progress' })}\n\`\`\``;
    const verdict = await reflect('Fenced task', 'output', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => fencedJSON,
    });

    assert.strictEqual(verdict.status, 'in_progress');
  });

  it('LLM path: non-JSON response falls back to heuristic', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-nojson-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    // _llmCaller returns plain text → parseVerdictJSON returns null → heuristic kicks in
    const verdict = await reflect('Heuristic fallback', '', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => 'This is not JSON at all',
    });

    // Heuristic path: no writes, empty output → 'stuck'
    assert.strictEqual(verdict.status, 'stuck');
    assert.ok(verdict.sessionId.startsWith('heuristic-'), 'Should fall back to heuristic sessionId');
  });

  it('LLM path: thrown error falls back to heuristic', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-err-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const verdict = await reflect('Error task', '', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => { throw new Error('LLM unavailable'); },
    });

    // Should not throw; should fall back to heuristic
    assert.ok(['stuck', 'blocked', 'in_progress', 'complete'].includes(verdict.status));
    assert.ok(verdict.sessionId.startsWith('heuristic-'));
  });

  it('normalizeVerdict: confidence is clamped to [0, 1]', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-clamp-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const overConfident = makeValidJSON({ confidence: 1.5 });
    const verdict = await reflect('Clamp test', 'out', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => overConfident,
    });
    assert.strictEqual(verdict.confidence, 1.0);
  });

  it('normalizeVerdict: stuck status → HIGH severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-sev-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const stuckJSON = makeValidJSON({ status: 'stuck', stuck: true });
    const verdict = await reflect('Stuck task', 'out', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => stuckJSON,
    });
    assert.strictEqual(verdict.severity, 'HIGH');
  });

  it('normalizeVerdict: blocked status → MEDIUM severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-blocksev-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const blockedJSON = makeValidJSON({ status: 'blocked', stuck: false });
    const verdict = await reflect('Blocked task', 'out', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => blockedJSON,
    });
    assert.strictEqual(verdict.severity, 'MEDIUM');
  });

  it('normalizeVerdict: in_progress status → LOW severity', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-logsev-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const inProgressJSON = makeValidJSON({ status: 'in_progress' });
    const verdict = await reflect('In-progress task', 'out', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => inProgressJSON,
    });
    assert.strictEqual(verdict.severity, 'LOW');
  });

  it('LLM path: JSON embedded in prose is extracted', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-reflect-embed-'));
    tempDirsLLM.push(tmpDir);
    const { reflect } = await import('../src/core/reflection-engine.js');

    const json = makeValidJSON({ status: 'complete', confidence: 0.85 });
    const prose = `Here is my assessment:\n${json}\n\nHope that helps!`;
    const verdict = await reflect('Embedded JSON', 'out', makeTelemetry(), {
      cwd: tmpDir,
      _llmCaller: async () => prose,
    });

    assert.strictEqual(verdict.status, 'complete');
    assert.strictEqual(verdict.confidence, 0.85);
  });
});
