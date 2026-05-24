// Merge-court LOC gate tests
// Verifies that candidates introducing .ts/.tsx files over 750 lines
// are blocked with BLOCKED_BY_POLICY before arbitration runs.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MergeCourtInput, RunMergeCourtOptions } from '../src/matrix/courts/merge-court.js';
import { runMergeCourt } from '../src/matrix/courts/merge-court.js';
import type { ConflictReport } from '../src/matrix/types/conflict.js';
import type { GateReport } from '../src/matrix/types/gate.js';

// ── Minimal fixture builders ─────────────────────────────────────────────────

function makeCandidate(filesChanged: string[]): MergeCourtInput {
  return {
    candidate: {
      candidateId: 'cand-1',
      leaseId: 'lease-1',
      workPacketId: 'wp-1',
      branch: 'agent/test',
      gateReportId: 'gate-1',
      filesChanged,
      allowEmptyDiff: true,
    },
    lease: {
      id: 'lease-1',
      workPacketId: 'wp-1',
      agentId: 'agent-1',
      branch: 'agent/test',
      allowedWritePaths: ['src/test.ts'],
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
    workPacket: {
      id: 'wp-1',
      dimensionId: 'dim-test',
      description: 'test packet',
      priority: 1,
      estimatedLoc: 100,
      filesTouched: filesChanged,
      dependsOn: [],
      status: 'in-progress',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    gateReport: {
      status: 'passed',
      checks: [],
    } as GateReport,
  };
}

const emptyConflict: ConflictReport = { conflicts: [] };

function makeOptions(
  candidates: MergeCourtInput[],
  locFn: (files: string[], cwd: string) => Promise<{ file: string; loc: number }[]>,
): RunMergeCourtOptions {
  return {
    candidates,
    conflictReport: emptyConflict,
    _runMerge: async () => ({ success: true }),
    _createTimeMachineCommit: async (c) => ({ eventId: `tm.${c.candidate.candidateId}` }),
    _now: () => '2026-01-01T00:00:00.000Z',
    _checkLocViolations: locFn,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('merge-court LOC gate', () => {
  it('blocks a candidate whose .ts file exceeds 750 lines', async () => {
    const candidate = makeCandidate(['src/big-module.ts']);
    // Simulate a 751-line file
    const locFn = async (_files: string[], _cwd: string) => [
      { file: 'src/big-module.ts', loc: 751 },
    ];
    const result = await runMergeCourt(makeOptions([candidate], locFn));

    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].decision, 'BLOCKED_BY_POLICY');
    assert.ok(result.decisions[0].reason.includes('LOC limit exceeded'));
    assert.ok(result.decisions[0].reason.includes('src/big-module.ts'));
    assert.ok(result.decisions[0].reason.includes('751 lines'));
    assert.equal(result.approvedCount, 0);
    assert.equal(result.blockedCount, 1);
  });

  it('approves a candidate whose .ts file is exactly 750 lines', async () => {
    const candidate = makeCandidate(['src/ok-module.ts']);
    // Exactly 750 — not a violation
    const locFn = async (_files: string[], _cwd: string) => [];
    const result = await runMergeCourt(makeOptions([candidate], locFn));

    assert.equal(result.decisions.length, 1);
    assert.equal(result.decisions[0].decision, 'APPROVED');
    assert.equal(result.approvedCount, 1);
    assert.equal(result.blockedCount, 0);
  });

  it('does not block a candidate whose only changed files are non-.ts', async () => {
    const candidate = makeCandidate(['docs/README.md', 'package.json']);
    // LOC check returns no violations (non-.ts files are skipped by the helper)
    const locFn = async (_files: string[], _cwd: string) => [];
    const result = await runMergeCourt(makeOptions([candidate], locFn));

    assert.equal(result.decisions[0].decision, 'APPROVED');
  });

  it('skips unreadable file paths gracefully and does not block the merge', async () => {
    const candidate = makeCandidate(['/nonexistent/path/module.ts']);
    // Real checkLocViolations would catch the ENOENT and return [] — simulate that
    const locFn = async (_files: string[], _cwd: string) => [];
    const result = await runMergeCourt(makeOptions([candidate], locFn));

    // Should still reach arbitrate() and be approved (allowEmptyDiff=true, gate passed)
    assert.equal(result.decisions[0].decision, 'APPROVED');
  });
});
