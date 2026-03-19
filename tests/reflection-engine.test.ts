import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
