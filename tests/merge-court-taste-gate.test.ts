// Merge-court taste-gate enforcement tests.
//
// Regression for the silent-skip integrity hole (council 2026-05-29): arbitrate()
// only blocked when a tasteGateRequest was pre-populated, so a candidate that
// arrived WITHOUT one bypassed human review entirely. runMergeCourt now generates
// a request for every candidate missing one, so the gate is never silently skipped.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MergeCourtInput, RunMergeCourtOptions } from '../src/matrix/courts/merge-court.js';
import { runMergeCourt } from '../src/matrix/courts/merge-court.js';
import type { ConflictReport } from '../src/matrix/types/conflict.js';
import type { GateReport, TasteGateRequest } from '../src/matrix/types/gate.js';

function makeCandidate(filesChanged: string[], tasteGateRequest?: TasteGateRequest): MergeCourtInput {
  return {
    candidate: {
      candidateId: 'cand-1', leaseId: 'lease-1', workPacketId: 'wp-1',
      branch: 'agent/test', gateReportId: 'gate-1', filesChanged, allowEmptyDiff: true,
    },
    lease: {
      id: 'lease-1', workPacketId: 'wp-1', agentId: 'agent-1', branch: 'agent/test',
      allowedWritePaths: filesChanged, status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z',
    },
    workPacket: {
      id: 'wp-1', dimensionId: 'dim-test', description: 'test packet', priority: 1,
      estimatedLoc: 100, filesTouched: filesChanged, dependsOn: [],
      status: 'in-progress', createdAt: '2026-01-01T00:00:00.000Z',
    },
    gateReport: { status: 'passed', checks: [] } as GateReport,
    ...(tasteGateRequest ? { tasteGateRequest } : {}),
  };
}

// Seams bypass the earlier gates (LOC/stub/security/capability) so each test
// isolates the taste-gate behavior. _writeTasteGates is a noop (no disk).
function makeOptions(candidates: MergeCourtInput[]): RunMergeCourtOptions {
  return {
    candidates,
    conflictReport: { conflicts: [] } as ConflictReport,
    _runMerge: async () => ({ success: true }),
    _createTimeMachineCommit: async (c) => ({ eventId: `tm.${c.candidate.candidateId}` }),
    _now: () => '2026-01-01T00:00:00.000Z',
    _checkLocViolations: async () => [],
    _runSecurityCourt: async () => ({ recommendation: 'allow_merge', blockedBy: [], criticalCount: 0 }),
    _scanForStubs: async () => ({ ok: true, findings: [] }),
    _writeTasteGates: async () => 'noop',
  };
}

describe('merge-court taste-gate enforcement (silent-skip is closed)', () => {
  it('BLOCKS a candidate with NO taste request that touches a product-sensitive surface', async () => {
    // No tasteGateRequest provided, change touches src/cli/commands/ (a taste surface).
    // Under the old silent-skip bug this would have been APPROVED.
    const candidate = makeCandidate(['src/cli/commands/foo.ts']);
    const result = await runMergeCourt(makeOptions([candidate]));
    assert.equal(result.decisions[0]!.decision, 'BLOCKED_BY_TASTE_GATE',
      'a product-sensitive change with no pre-approved taste gate must be blocked, not silently approved');
  });

  it('APPROVES a candidate with NO taste request that touches only non-sensitive code', async () => {
    // checkTasteGate returns not_required for non-product-sensitive paths, so the
    // fix does not over-block ordinary internal changes.
    const candidate = makeCandidate(['src/core/some-internal-helper.ts']);
    const result = await runMergeCourt(makeOptions([candidate]));
    assert.equal(result.decisions[0]!.decision, 'APPROVED',
      'a non-sensitive change should reach APPROVED — the generated gate is not_required');
  });

  it('APPROVES a product-sensitive candidate when an approved taste request is supplied', async () => {
    const approved: TasteGateRequest = {
      id: 'taste.lease-1.approved', leaseId: 'lease-1', workPacketId: 'wp-1',
      status: 'approved', reason: 'human approved', affectedSurfaces: ['src/cli/commands/foo.ts'],
      requestedAt: '2026-01-01T00:00:00.000Z', resolvedAt: '2026-01-01T00:00:00.000Z', resolvedBy: 'reviewer',
    };
    const candidate = makeCandidate(['src/cli/commands/foo.ts'], approved);
    const result = await runMergeCourt(makeOptions([candidate]));
    assert.equal(result.decisions[0]!.decision, 'APPROVED',
      'an explicitly approved taste gate lets the product-sensitive change merge');
  });
});
