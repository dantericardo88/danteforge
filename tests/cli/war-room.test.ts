// War-room TUI tests — renderer + one-shot CLI invocation against a fixture snapshot.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderWarRoomTUI, warRoom } from '../../src/cli/commands/war-room.js';
import type { MatrixDashboardSnapshot } from '../../src/matrix/engines/dashboard-snapshot.js';

function fixture(overrides: Partial<MatrixDashboardSnapshot> = {}): MatrixDashboardSnapshot {
  return {
    workspaceRoot: '/tmp/fixture',
    runId: 'run-fixture-1',
    waves: [
      { waveNumber: 1, description: 'Wave 1', workPacketIds: ['p1', 'p2'], estimatedTokens: 12000, estimatedUsdLow: 0.04, estimatedUsdHigh: 0.18 },
    ],
    leaseCounts: { active: 2, completed: 1 },
    gateReports: [
      { leaseId: 'lease.alpha', status: 'passed', passed: 4, failed: 0 },
      { leaseId: 'lease.beta', status: 'failed', passed: 2, failed: 1 },
    ],
    mergeDecisions: [
      { candidateId: 'cand.lease.alpha', outcome: 'approved' },
      { candidateId: 'cand.lease.beta', outcome: 'rejected' },
    ],
    mailbox: [
      { messageId: 'msg.a', type: 'merge_ready', fromLease: 'lease.alpha', toLease: 'broadcast', summary: 'Alpha is done.', impact: 'consumer_update_required', status: 'pending_ack', createdAt: '2026-05-12T22:30:00Z' },
    ],
    retro: { bestPerformingProvider: 'ollama', weakestGate: 'forbidden_paths', recommendedNextRunChanges: ['shrink lease scope'] },
    loadedAt: '2026-05-12T22:31:00Z',
    errors: {},
    ...overrides,
  };
}

describe('renderWarRoomTUI', () => {
  it('renders all five sections from a populated snapshot', () => {
    const out = renderWarRoomTUI(fixture());
    assert.match(out, /Matrix War Room/);
    assert.match(out, /Simulation Plan/);
    assert.match(out, /Leases/);
    assert.match(out, /Verification Court/);
    assert.match(out, /Merge Court/);
    assert.match(out, /Mailbox/);
    assert.match(out, /Retrospective/);
    assert.match(out, /run-fixture-1/);
    assert.match(out, /lease\.alpha/);
    assert.match(out, /lease\.beta/);
    assert.match(out, /Alpha is done/);
  });

  it('emits placeholder copy when sections are empty', () => {
    const out = renderWarRoomTUI(fixture({
      waves: [],
      leaseCounts: {},
      gateReports: [],
      mergeDecisions: [],
      mailbox: [],
      retro: undefined,
    }));
    assert.match(out, /no plan/i);
    assert.match(out, /no leases yet/i);
    assert.match(out, /no gate reports yet/i);
    assert.match(out, /no merge decisions yet/i);
    assert.match(out, /no pending messages/i);
  });

  it('renders the load-errors section when files are missing', () => {
    const out = renderWarRoomTUI(fixture({
      errors: { 'matrix.simulation-plan.json': 'ENOENT' },
    }));
    assert.match(out, /Load errors/);
    assert.match(out, /matrix\.simulation-plan\.json/);
    assert.match(out, /ENOENT/);
  });

  it('truncates active mailbox display at 12 entries', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      messageId: `m${i}`, type: 'merge_ready', fromLease: `l.${i}`, toLease: 'broadcast',
      summary: `entry ${i}`, impact: 'informational', status: 'pending_ack',
      createdAt: `2026-05-12T22:30:${String(i).padStart(2, '0')}Z`,
    }));
    const out = renderWarRoomTUI(fixture({ mailbox: many }));
    assert.match(out, /and 8 more/);
  });
});

describe('warRoom CLI (one-shot mode)', () => {
  it('emits a rendered snapshot to the injected sink', async () => {
    const chunks: string[] = [];
    await warRoom({
      once: true,
      _snapshot: fixture(),
      _write: (chunk) => { chunks.push(chunk); },
    });
    const text = chunks.join('');
    assert.match(text, /Matrix War Room/);
    assert.match(text, /run-fixture-1/);
  });
});
