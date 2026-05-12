// Phase 6 — Conflict Radar tests (one per conflict type)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanConflicts, isBlockingConflict } from '../../src/matrix/engines/conflict-radar.js';
import type { WorkPacket, OwnershipMap } from '../../src/matrix/types/index.js';

function packet(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.test', title: 't', objective: 'o',
    dimensionId: 'dim.test',
    paths: { ownedPaths: [], readOnlyPaths: [], forbiddenPaths: [] },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['a'],
    proof: { proofRequired: ['p'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'r', riskLevel: 'low', createdAt: '',
    ...overrides,
  };
}

function ownership(frozen: string[] = [], workstreams: Record<string, string[]> = {}): OwnershipMap {
  return {
    version: 1, generatedAt: '', globalAllowed: [],
    workstreams: Object.fromEntries(
      Object.entries(workstreams).map(([k, paths]) => [k, { workstream: k, ownedPaths: paths }]),
    ),
    frozenFiles: frozen,
  };
}

describe('Conflict Radar — file_overlap', () => {
  it('detects two packets writing the same file', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'b', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(),
    });
    const c = report.conflicts.find(r => r.type === 'file_overlap');
    assert.ok(c, 'expected file_overlap conflict');
    assert.equal(c!.level, 'HIGH');
    assert.deepEqual(c!.workPacketIds!.sort(), ['a', 'b']);
  });

  it('does not flag distinct files as file_overlap', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['src/foo.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'b', paths: { ownedPaths: ['src/bar.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(),
    });
    assert.equal(report.conflicts.filter(c => c.type === 'file_overlap').length, 0);
  });
});

describe('Conflict Radar — protected_path_violation', () => {
  it('flags packet that claims ownership of a frozen file as CRITICAL', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['src/cli/index.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(['src/cli/index.ts']),
    });
    const c = report.conflicts.find(r => r.type === 'protected_path_violation');
    assert.ok(c);
    assert.equal(c!.level, 'CRITICAL');
    assert.equal(c!.recommendedAction, 'block_immediately');
  });
});

describe('Conflict Radar — symbol_overlap', () => {
  it('flags packets that would export the same top-level symbol', () => {
    const fileContents = new Map<string, string>([
      ['src/a.ts', 'export function shared() {}'],
      ['src/b.ts', 'export function shared() {}'],
    ]);
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'pa', paths: { ownedPaths: ['src/a.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'pb', paths: { ownedPaths: ['src/b.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(),
      fileContents,
    });
    const c = report.conflicts.find(r => r.type === 'symbol_overlap');
    assert.ok(c);
    assert.ok(c!.affectedSymbols!.includes('shared'));
  });
});

describe('Conflict Radar — test_overlap', () => {
  it('flags two packets that edit the same test file', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['tests/foo.test.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'b', paths: { ownedPaths: ['tests/foo.test.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(),
    });
    const testConflicts = report.conflicts.filter(c => c.type === 'test_overlap');
    assert.ok(testConflicts.length >= 1);
  });
});

describe('Conflict Radar — duplicate_subsystem', () => {
  it('flags two packets that propose the same -types.ts subsystem', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['src/core/foo-types.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'b', paths: { ownedPaths: ['src/core/foo-types.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(),
    });
    const c = report.conflicts.find(r => r.type === 'duplicate_subsystem');
    assert.ok(c);
    assert.equal(c!.level, 'HIGH');
  });
});

describe('Conflict Radar — summary counts', () => {
  it('aggregates per-level counts correctly', () => {
    const report = scanConflicts({
      workPackets: [
        packet({ id: 'a', paths: { ownedPaths: ['src/x.ts', 'src/cli/index.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
        packet({ id: 'b', paths: { ownedPaths: ['src/x.ts'], readOnlyPaths: [], forbiddenPaths: [] } }),
      ],
      ownershipMap: ownership(['src/cli/index.ts']),
    });
    assert.ok(report.summary.critical >= 1, 'protected_path_violation should be critical');
    assert.ok(report.summary.high >= 1, 'file_overlap should be high');
  });

  it('isBlockingConflict returns true for HIGH and CRITICAL only', () => {
    assert.equal(isBlockingConflict({ conflictId: '', level: 'CRITICAL', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'block_immediately' }), true);
    assert.equal(isBlockingConflict({ conflictId: '', level: 'HIGH', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'block_immediately' }), true);
    assert.equal(isBlockingConflict({ conflictId: '', level: 'MEDIUM', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'sequence_merge' }), false);
    assert.equal(isBlockingConflict({ conflictId: '', level: 'LOW', type: 'file_overlap', detectedAt: '', description: '', recommendedAction: 'allow_with_warning' }), false);
  });
});
