// Embedded mode tests — host detection, adapter, embedded-complete CLI.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectHostAI, isEmbeddedInHost } from '../../src/core/host-detection.js';
import { EmbeddedAdapter } from '../../src/matrix/adapters/embedded-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import { embeddedComplete } from '../../src/cli/commands/matrix-embedded.js';
import { saveGraph } from '../../src/matrix/engines/matrix-state.js';
import type { AgentLease } from '../../src/matrix/types/lease.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function tmpProject(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-embedded-'));
  tmpDirs.push(d);
  return d;
}

function makeLease(cwd: string, id = 'lease.test.1', workPacketId = 'work.test'): AgentLease {
  return {
    id,
    workPacketId,
    provider: 'embedded',
    agentRole: 'dimension-engineer',
    branch: `lease/${id}`,
    worktreePath: path.join(cwd, '.danteforge', 'worktrees', id),
    allowedWritePaths: ['src/feature.ts'],
    allowedReadPaths: ['src/index.ts'],
    forbiddenPaths: ['src/forbidden.ts'],
    requiredCommands: ['npm test'],
    budget: { maxTokens: 10_000, maxRuntimeMinutes: 30, maxIterations: 5 },
    status: 'issued',
  };
}

describe('detectHostAI', () => {
  it('returns null when no host env vars are set', () => {
    assert.equal(detectHostAI({ _env: {} }), null);
    assert.equal(isEmbeddedInHost({ _env: {} }), false);
  });

  it('returns "claude" when CLAUDE_PLUGIN_ROOT is set', () => {
    assert.equal(detectHostAI({ _env: { CLAUDE_PLUGIN_ROOT: '/x' } }), 'claude');
    assert.equal(isEmbeddedInHost({ _env: { CLAUDE_PLUGIN_ROOT: '/x' } }), true);
  });

  it('returns "codex" when any CODEX_* env is set', () => {
    assert.equal(detectHostAI({ _env: { CODEX: '1' } }), 'codex');
    assert.equal(detectHostAI({ _env: { CODEX_SESSION: 'abc' } }), 'codex');
    assert.equal(detectHostAI({ _env: { CODEX_ENV: 'prod' } }), 'codex');
  });

  it('prefers claude when both are set (Claude Code typically wraps Codex)', () => {
    assert.equal(detectHostAI({ _env: { CLAUDE_PLUGIN_ROOT: '/x', CODEX_SESSION: 'abc' } }), 'claude');
  });
});

describe('EmbeddedAdapter', () => {
  it('writes a Work Instruction Packet and returns awaiting_input status', async () => {
    const cwd = await tmpProject();
    const lease = makeLease(cwd);
    const adapter = new EmbeddedAdapter({
      workPacket: {
        title: 'Add the feature',
        objective: 'Move dimension X from 5 to 8',
        acceptanceCriteria: ['tests green', 'no forbidden edits'],
        paths: lease as never,
      },
      hostAI: 'claude',
    });
    const result = await runAdapter(adapter, { lease, cwd: lease.worktreePath });
    assert.equal(result.status, 'awaiting_input');
    assert.equal(result.provider, 'embedded');
    assert.equal(result.filesChanged.length, 0, 'embedded adapter should not edit anything itself');
    assert.match(result.finalMessage ?? '', /embedded-complete/);

    // Confirm packet files exist
    const packetDir = path.join(cwd, '.danteforge', 'embedded-mode', lease.id);
    const md = await fs.readFile(path.join(packetDir, 'work-instruction.md'), 'utf8');
    assert.match(md, /Work Instruction/);
    assert.match(md, /forbidden paths/i);
    assert.match(md, new RegExp(lease.id));

    const json = JSON.parse(await fs.readFile(path.join(packetDir, 'work-instruction.json'), 'utf8'));
    assert.equal(json.leaseId, lease.id);
    assert.equal(json.hostAI, 'claude');
    assert.ok(Array.isArray(json.ownedPaths));
  });
});

describe('embeddedComplete CLI', () => {
  it('captures injected filesChanged, updates agent-runs, marks lease completed, posts mailbox', async () => {
    const cwd = await tmpProject();
    const lease = makeLease(cwd);
    await saveGraph(cwd, 'leaseGraph', { generatedAt: new Date().toISOString(), leases: [lease] });

    const result = await embeddedComplete(lease.id, {
      cwd,
      _filesChanged: ['src/feature.ts', 'src/util.ts'],
    });
    assert.equal(result.leaseId, lease.id);
    assert.deepEqual(result.filesChanged, ['src/feature.ts', 'src/util.ts']);
    assert.ok(result.mailboxId, 'mailbox message should be published');

    // Lease status updated
    const leaseRaw = await fs.readFile(path.join(cwd, '.danteforge', 'matrix', 'matrix.lease-graph.json'), 'utf8');
    const leaseJson = JSON.parse(leaseRaw);
    assert.equal(leaseJson.leases[0].status, 'completed');

    // Agent run recorded
    const runsRaw = await fs.readFile(path.join(cwd, '.danteforge', 'matrix', 'matrix.agent-runs.json'), 'utf8');
    const runsJson = JSON.parse(runsRaw);
    assert.equal(runsJson.runs.length, 1);
    assert.equal(runsJson.runs[0].leaseId, lease.id);
    assert.equal(runsJson.runs[0].status, 'completed');
    assert.deepEqual(runsJson.runs[0].filesChanged, ['src/feature.ts', 'src/util.ts']);

    // Mailbox written
    const mboxDir = path.join(cwd, '.danteforge', 'matrix', 'mailbox');
    const entries = await fs.readdir(mboxDir);
    const msgs = entries.filter(n => n.endsWith('.json'));
    assert.ok(msgs.length >= 1);
  });

  it('skips mailbox publish when _skipMailbox is set (testing seam)', async () => {
    const cwd = await tmpProject();
    const lease = makeLease(cwd, 'lease.skipmb.1');
    await saveGraph(cwd, 'leaseGraph', { generatedAt: new Date().toISOString(), leases: [lease] });
    const result = await embeddedComplete(lease.id, {
      cwd,
      _filesChanged: [],
      _skipMailbox: true,
    });
    assert.equal(result.mailboxId, undefined);
  });

  it('throws when the lease is unknown', async () => {
    const cwd = await tmpProject();
    await saveGraph(cwd, 'leaseGraph', { generatedAt: new Date().toISOString(), leases: [] });
    await assert.rejects(
      () => embeddedComplete('lease.does-not-exist', { cwd, _filesChanged: [], _skipMailbox: true }),
      /not found/,
    );
  });
});
