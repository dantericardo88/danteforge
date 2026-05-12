// Phase 13b — Smoke tests for GeminiAdapter + GrokAdapter
//
// The two new adapters are thin wrappers over LLMAgentAdapter — their
// behavior is identical to Claude/Codex via inheritance. These tests
// confirm: correct id/name + provider routing via the _callLLM seam.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GeminiAdapter } from '../../src/matrix/adapters/gemini-adapter.js';
import { GrokAdapter } from '../../src/matrix/adapters/grok-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease, WorkPacket } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function makeWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-grok-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'gemini', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath,
    allowedWritePaths: ['src/sample.ts'],
    allowedReadPaths: [], forbiddenPaths: [],
    requiredCommands: [], budget: { maxTokens: 1000, maxRuntimeMinutes: 5, maxIterations: 1 },
    status: 'active',
  };
}

function fakePacket(): WorkPacket {
  return {
    id: 'work.test', title: 'Hello', objective: 'Add hello()',
    dimensionId: 'dim.test',
    paths: { ownedPaths: ['src/sample.ts'], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['ok'], proof: { proofRequired: ['ok'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
  };
}

describe('GeminiAdapter', () => {
  it('has id="gemini" and labelled name', () => {
    const adapter = new GeminiAdapter({ workPacket: fakePacket() });
    assert.equal(adapter.id, 'gemini');
    assert.ok(adapter.name.includes('gemini'));
  });

  it('is always available', async () => {
    const adapter = new GeminiAdapter({ workPacket: fakePacket() });
    assert.equal(await adapter.isAvailable(), true);
  });

  it('writes files when injected LLM returns valid edits', async () => {
    const cwd = await makeWorktree();
    const adapter = new GeminiAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/sample.ts', action: 'write', contents: 'export const ok = true;' }]),
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
  });
});

describe('GrokAdapter', () => {
  it('has id="grok" and labelled name', () => {
    const adapter = new GrokAdapter({ workPacket: fakePacket() });
    assert.equal(adapter.id, 'grok');
    assert.ok(adapter.name.includes('grok'));
  });

  it('writes files when injected LLM returns valid edits', async () => {
    const cwd = await makeWorktree();
    const adapter = new GrokAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/sample.ts', action: 'write', contents: 'export const x = 1;' }]),
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
  });

  it('fails gracefully on malformed JSON', async () => {
    const cwd = await makeWorktree();
    const adapter = new GrokAdapter({
      workPacket: fakePacket(),
      _callLLM: async () => 'not json',
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
  });
});
