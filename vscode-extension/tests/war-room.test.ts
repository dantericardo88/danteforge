// Phase 14 — Tests for Matrix War Room webview
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMatrixWarRoomHTML,
  loadMatrixDashboardSnapshot,
  type MatrixDashboardSnapshot,
} from '../src/war-room';

function baseSnapshot(over: Partial<MatrixDashboardSnapshot> = {}): MatrixDashboardSnapshot {
  return {
    workspaceRoot: '/tmp/demo',
    waves: [],
    leaseCounts: {},
    gateReports: [],
    mergeDecisions: [],
    loadedAt: '2026-05-12T00:00:00Z',
    errors: {},
    ...over,
  };
}

describe('renderMatrixWarRoomHTML', () => {
  it('emits the header with "Matrix War Room"', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot());
    assert.ok(html.includes('<h1>Matrix War Room</h1>'));
  });

  it('shows the muted "no plan" prompt when waves are empty', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot());
    assert.ok(html.includes('No simulation plan yet'));
  });

  it('renders a wave row when waves are present', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      waves: [{
        waveNumber: 1, description: 'Wave 1',
        workPacketIds: ['p1', 'p2'],
        estimatedTokens: 12345, estimatedUsdLow: 0.04, estimatedUsdHigh: 0.18,
      }],
    }));
    assert.ok(html.includes('12,345'));
    assert.ok(html.includes('$0.04–$0.18'));
  });

  it('renders lease counts grouped by status', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      leaseCounts: { active: 2, completed: 1 },
    }));
    assert.ok(html.includes('<strong>active</strong>'));
    assert.ok(html.includes('<strong>completed</strong>'));
  });

  it('marks failed gate reports with the fail class', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      gateReports: [{ leaseId: 'lease.x', status: 'failed', passed: 3, failed: 2 }],
    }));
    assert.ok(html.includes('class="fail"'));
  });

  it('shows retrospective recommendations when present', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      retro: { bestPerformingProvider: 'claude', recommendedNextRunChanges: ['Skip community_adoption next time'] },
    }));
    assert.ok(html.includes('Best provider:'));
    assert.ok(html.includes('Skip community_adoption next time'));
  });

  it('escapes hostile content in lease IDs (no script injection)', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      gateReports: [{ leaseId: '<script>x</script>', status: 'failed', passed: 0, failed: 1 }],
    }));
    assert.ok(!html.includes('<script>x</script>'));
  });

  it('renders an errors section when load errors exist', () => {
    const html = renderMatrixWarRoomHTML(baseSnapshot({
      errors: { 'matrix.lease-graph.json': 'ENOENT' },
    }));
    assert.ok(html.includes('Load errors'));
    assert.ok(html.includes('ENOENT'));
  });
});

describe('loadMatrixDashboardSnapshot', () => {
  it('returns empty waves and records ENOENT when files are absent', async () => {
    const snapshot = await loadMatrixDashboardSnapshot({
      workspaceRoot: '/tmp/no-such',
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(snapshot.waves.length, 0);
    assert.ok(Object.keys(snapshot.errors).length > 0);
  });

  it('aggregates lease statuses', async () => {
    const fakeFiles: Record<string, string> = {
      'matrix.lease-graph.json': JSON.stringify({
        leases: [{ status: 'active' }, { status: 'active' }, { status: 'completed' }],
      }),
    };
    const snapshot = await loadMatrixDashboardSnapshot({
      workspaceRoot: '/tmp/x',
      _readFile: async (p: string) => {
        const filename = p.split('/').pop()!;
        if (fakeFiles[filename]) return fakeFiles[filename];
        throw new Error('ENOENT');
      },
    });
    assert.deepEqual(snapshot.leaseCounts, { active: 2, completed: 1 });
  });

  it('extracts gate report pass/fail counts from checks', async () => {
    const fakeFiles: Record<string, string> = {
      'matrix.gate-reports.json': JSON.stringify({
        reports: [{
          leaseId: 'lease.x', status: 'failed',
          checks: [
            { status: 'passed' }, { status: 'passed' }, { status: 'failed' },
          ],
        }],
      }),
    };
    const snapshot = await loadMatrixDashboardSnapshot({
      workspaceRoot: '/tmp/x',
      _readFile: async (p: string) => {
        const filename = p.split('/').pop()!;
        if (fakeFiles[filename]) return fakeFiles[filename];
        throw new Error('ENOENT');
      },
    });
    assert.equal(snapshot.gateReports[0]?.passed, 2);
    assert.equal(snapshot.gateReports[0]?.failed, 1);
  });
});
