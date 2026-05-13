// Phase 8 — Fake Agent Adapter tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FakeAgentAdapter } from '../../src/matrix/adapters/fake-agent-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function tmpWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'fake-agent-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'fake', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath,
    allowedWritePaths: ['src/sample.ts'],
    allowedReadPaths: [], forbiddenPaths: ['src/frozen.ts'],
    requiredCommands: [], budget: { maxTokens: 1, maxRuntimeMinutes: 1, maxIterations: 1 },
    status: 'active',
    ...overrides,
  };
}

describe('FakeAgentAdapter', () => {
  it('is always available', async () => {
    const adapter = new FakeAgentAdapter();
    assert.equal(await adapter.isAvailable(), true);
  });

  it('success action writes a file into allowedWritePaths', async () => {
    const cwd = await tmpWorktree();
    const adapter = new FakeAgentAdapter({ action: 'success' });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.equal(result.filesChanged.length, 1);
    const written = await fs.readFile(path.join(cwd, result.filesChanged[0]!), 'utf8');
    assert.ok(written.includes('Implementation'), 'success file should have expected marker');
  });

  it('forbidden-edit action writes to forbiddenPaths[0]', async () => {
    const cwd = await tmpWorktree();
    const adapter = new FakeAgentAdapter({ action: 'forbidden-edit' });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.filesChanged[0], 'src/frozen.ts');
  });

  it('stub-commit action writes a TODO/not-implemented file', async () => {
    const cwd = await tmpWorktree();
    const adapter = new FakeAgentAdapter({ action: 'stub-commit' });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    const written = await fs.readFile(path.join(cwd, result.filesChanged[0]!), 'utf8');
    assert.ok(written.includes('TODO') || written.includes('not implemented'));
  });

  it('custom fileWrites override the default action behavior', async () => {
    const cwd = await tmpWorktree();
    const adapter = new FakeAgentAdapter({
      action: 'success',
      fileWrites: [{ path: 'custom.ts', contents: 'export const custom = 1;' }],
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.deepEqual(result.filesChanged, ['custom.ts']);
    const written = await fs.readFile(path.join(cwd, 'custom.ts'), 'utf8');
    assert.equal(written, 'export const custom = 1;');
  });

  it('streams started + completed events', async () => {
    const cwd = await tmpWorktree();
    const adapter = new FakeAgentAdapter({ action: 'noop' });
    const prepared = await adapter.prepareRun({ lease: fakeLease(cwd), cwd });
    const handle = await adapter.startRun(prepared);
    const kinds: string[] = [];
    for await (const event of adapter.streamEvents(handle)) {
      kinds.push(event.kind);
    }
    assert.ok(kinds.includes('started'));
    assert.ok(kinds.includes('completed'));
  });
});
