// Tests for src/cli/commands/matrix-build-subagent-prompt.ts
//
// Uses the _readFile injection seam so we don't have to stand up a full
// matrix fixture — we just feed canned work-instruction.json + lease-graph
// payloads in.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSubagentPrompt } from '../src/cli/commands/matrix-build-subagent-prompt.js';

const SAMPLE_PACKET = {
  leaseId: 'lease.feature_x.2026-01-01T00-00-00.embedded.2026-01-01T00-00-01',
  workPacketId: 'work.feature_x.2026-01-01T00-00-00',
  packetTitle: 'Close gap on Feature X',
  objective: 'Move "Feature X" from current score 6.0 toward target 8.0.',
  ownedPaths: ['src/core/feature-x.ts', 'src/core/feature-x-helpers.ts'],
  readOnlyPaths: ['src/types/feature-x.ts'],
  forbiddenPaths: ['src/core/access-control.ts', 'src/core/security-controls.ts'],
  acceptanceCriteria: [
    'Implementation passes typecheck and tests',
    'Score moves from 6.0 toward 8.0',
  ],
  worktreePath: '/fake/cwd/.danteforge-worktrees/lease.feature_x.2026-01-01T00-00-00.embedded.2026-01-01T00-00-01',
  hostAI: 'claude',
  createdAt: '2026-01-01T00:00:01.000Z',
};

const SAMPLE_LEASE_GRAPH = {
  leases: [{
    id: SAMPLE_PACKET.leaseId,
    branch: 'matrix/feature_x/embedded-abc1234',
    worktreePath: SAMPLE_PACKET.worktreePath,
  }],
};

function makeReader(packet: unknown = SAMPLE_PACKET, leaseGraph: unknown = SAMPLE_LEASE_GRAPH) {
  return async (p: string): Promise<string> => {
    if (p.endsWith('work-instruction.json')) return JSON.stringify(packet);
    if (p.endsWith('matrix.lease-graph.json')) return JSON.stringify(leaseGraph);
    throw Object.assign(new Error('ENOENT: ' + p), { code: 'ENOENT' });
  };
}

describe('buildSubagentPrompt', () => {
  it('returns leaseId, description, and prompt', async () => {
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: makeReader(),
    });
    assert.equal(result.leaseId, SAMPLE_PACKET.leaseId);
    assert.match(result.description, /Matrix lease: feature_x/);
    assert.ok(result.prompt.length > 500, 'prompt should be a real instruction body');
  });

  it('mentions the worktree path verbatim so the sub-agent knows where to edit', async () => {
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: makeReader(),
    });
    assert.ok(
      result.prompt.includes(SAMPLE_PACKET.worktreePath),
      'prompt must include the absolute worktree path',
    );
  });

  it('includes every owned path and every forbidden path', async () => {
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: makeReader(),
    });
    for (const p of SAMPLE_PACKET.ownedPaths) {
      assert.ok(result.prompt.includes(p), `owned path ${p} must appear in prompt`);
    }
    for (const p of SAMPLE_PACKET.forbiddenPaths) {
      assert.ok(result.prompt.includes(p), `forbidden path ${p} must appear in prompt`);
    }
  });

  it('embeds the lease branch from the lease graph', async () => {
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: makeReader(),
    });
    assert.ok(
      result.prompt.includes('matrix/feature_x/embedded-abc1234'),
      'prompt must cite the lease branch so the sub-agent knows it is isolated',
    );
  });

  it('falls back to "<unknown>" branch when the lease graph is missing', async () => {
    const reader = async (p: string): Promise<string> => {
      if (p.endsWith('work-instruction.json')) return JSON.stringify(SAMPLE_PACKET);
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: reader,
    });
    assert.ok(result.prompt.includes('<unknown>'), 'should degrade gracefully on missing lease graph');
  });

  it('throws a clear error when the work-instruction packet is missing', async () => {
    const reader = async (): Promise<string> => {
      throw Object.assign(new Error('ENOENT: no packet'), { code: 'ENOENT' });
    };
    await assert.rejects(
      buildSubagentPrompt('lease.does-not-exist', { cwd: '/fake/cwd', _readFile: reader }),
      /could not read.*work-instruction\.json/,
    );
  });

  it('forbids nested sub-agent dispatch and self-call of embedded-complete', async () => {
    const result = await buildSubagentPrompt(SAMPLE_PACKET.leaseId, {
      cwd: '/fake/cwd',
      _readFile: makeReader(),
    });
    assert.match(result.prompt, /Do NOT spawn other sub-agents/i, 'must forbid recursive dispatch');
    assert.match(result.prompt, /do NOT call.*embedded-complete/i, 'must reserve embedded-complete for the parent');
  });
});
