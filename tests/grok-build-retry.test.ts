// Tests for GrokBuildAdapter transient-error retry logic.
// Uses injection seams (_spawn, _sleep, _isAvailable, _gitDiff) — no real grok.exe needed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GrokBuildAdapter } from '../src/matrix/adapters/grok-build-adapter.js';
import type { GrokBuildSpawnFn } from '../src/matrix/adapters/grok-build-adapter.js';
import type { WorkPacket } from '../src/matrix/types/work-graph.js';
import type { AgentLease } from '../src/matrix/types/lease.js';

function makeWorkPacket(): WorkPacket {
  return {
    id: 'wp-retry-test',
    dimensionId: 'test',
    objective: 'Write a hello world file',
    acceptanceCriteria: ['File exists'],
    proof: { proofRequired: ['Output visible'] },
    globalForbidden: [],
    allowedWritePaths: ['src/**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [],
    effort: 'low',
    fileClaims: [],
  } as unknown as WorkPacket;
}

function makeLease(): AgentLease {
  return {
    id: 'lease-retry',
    agentId: 'grok-build',
    worktreePath: '/tmp/grok-test',
    allowedWritePaths: ['src/**'],
    allowedReadPaths: ['**'],
    forbiddenPaths: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  } as unknown as AgentLease;
}

function makeSpawn(responses: Array<{ exitCode: number; stdout: string; stderr?: string }>): GrokBuildSpawnFn {
  let callCount = 0;
  return (_cmd, _args, _opts) => {
    const resp = responses[Math.min(callCount++, responses.length - 1)];
    const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    const child = {
      stdout: {
        on: (_event: string, cb: (chunk: Buffer) => void) => {
          if (resp.stdout) setTimeout(() => cb(Buffer.from(resp.stdout)), 0);
        },
      },
      stderr: {
        on: (_event: string, cb: (chunk: Buffer) => void) => {
          if (resp.stderr) setTimeout(() => cb(Buffer.from(resp.stderr)), 0);
        },
      },
      on: (event: string, cb: (...args: unknown[]) => void) => {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        if (event === 'close') {
          setTimeout(() => listeners['close']?.forEach(f => f(resp.exitCode)), 5);
        }
        return child;
      },
      kill: () => true,
      pid: 9999,
    };
    return child;
  };
}

describe('GrokBuildAdapter — 502 retry', () => {
  it('succeeds on first attempt when no error', async () => {
    const sleepCalls: number[] = [];
    const adapter = new GrokBuildAdapter({
      workPacket: makeWorkPacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _spawn: makeSpawn([{ exitCode: 0, stdout: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: good\nSCORE_SUGGESTION: 9\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none' }]),
      _sleep: async (ms) => { sleepCalls.push(ms); },
    });
    const handle = await adapter.startRun({ lease: makeLease(), prepared: true } as never);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'completed');
    assert.equal(sleepCalls.length, 0, 'should not sleep on success');
  });

  it('retries on 502 output and succeeds on second attempt', async () => {
    const sleepCalls: number[] = [];
    const responses = [
      { exitCode: 1, stderr: '502 Bad Gateway\nretry-after: 10' },
      { exitCode: 0, stdout: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: ok\nSCORE_SUGGESTION: 8\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none' },
    ];
    const adapter = new GrokBuildAdapter({
      workPacket: makeWorkPacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _spawn: makeSpawn(responses),
      _sleep: async (ms) => { sleepCalls.push(ms); },
    });
    const handle = await adapter.startRun({ lease: makeLease(), prepared: true } as never);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'completed');
    assert.equal(sleepCalls.length, 1, 'should sleep once before retry');
    assert.equal(sleepCalls[0], 10_000, 'should respect retry-after: 10');
  });

  it('fails after exhausting max retries', async () => {
    const sleepCalls: number[] = [];
    const fiveHundredTwo = { exitCode: 1, stderr: '502 Bad Gateway\nretry-after: 5' };
    const adapter = new GrokBuildAdapter({
      workPacket: makeWorkPacket(),
      judgeMode: false,
      maxGrokRetries: 2,
      _isAvailable: async () => true,
      _spawn: makeSpawn([fiveHundredTwo, fiveHundredTwo, fiveHundredTwo]),
      _sleep: async (ms) => { sleepCalls.push(ms); },
      _gitDiff: async () => [],
    });
    const handle = await adapter.startRun({ lease: makeLease(), prepared: true } as never);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed');
    assert.equal(sleepCalls.length, 2, 'should sleep twice (2 retries)');
  });

  it('does NOT retry on non-transient exit code', async () => {
    const sleepCalls: number[] = [];
    const adapter = new GrokBuildAdapter({
      workPacket: makeWorkPacket(),
      judgeMode: false,
      _isAvailable: async () => true,
      _spawn: makeSpawn([{ exitCode: 1, stdout: 'SyntaxError: unexpected token' }]),
      _sleep: async (ms) => { sleepCalls.push(ms); },
      _gitDiff: async () => [],
    });
    const handle = await adapter.startRun({ lease: makeLease(), prepared: true } as never);
    const result = await adapter.collectResult(handle);
    assert.equal(result.status, 'failed');
    assert.equal(sleepCalls.length, 0, 'non-502 errors should not retry');
  });

  it('clamps retry-after to [5s, 300s]', async () => {
    const sleepCalls: number[] = [];
    const responses = [
      { exitCode: 1, stderr: '502 Bad Gateway\nretry-after: 9999' },
      { exitCode: 0, stdout: 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: ok\nSCORE_SUGGESTION: 7\nBLOCKING_ISSUES: none\nBLOCKING_CONCERNS: none\nDISSENT: none' },
    ];
    const adapter = new GrokBuildAdapter({
      workPacket: makeWorkPacket(),
      judgeMode: true,
      _isAvailable: async () => true,
      _spawn: makeSpawn(responses),
      _sleep: async (ms) => { sleepCalls.push(ms); },
    });
    await adapter.startRun({ lease: makeLease(), prepared: true } as never);
    assert.equal(sleepCalls[0], 300_000, 'retry-after 9999s should be clamped to 300s');
  });
});
