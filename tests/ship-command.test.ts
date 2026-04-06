// ship-command.test.ts — command-level tests for ship() via injection seams
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { ShipPlan } from '../src/core/ship-engine.js';
import type { ReviewFinding } from '../src/core/paranoid-review.js';
import type { DanteState } from '../src/core/state.js';
import { ship } from '../src/cli/commands/ship.js';

const originalExitCode = process.exitCode;

beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExitCode; });

function makeCritical(description = 'Hardcoded secret'): ReviewFinding {
  return { severity: 'critical', category: 'security', filePath: 'src/index.ts', description, recommendation: 'Remove it' };
}

function makeInfo(description = 'Missing type annotation'): ReviewFinding {
  return { severity: 'informational', category: 'types', filePath: 'src/index.ts', description, recommendation: 'Add types' };
}

function makeShipPlan(overrides: Partial<ShipPlan> = {}): ShipPlan {
  return {
    bumpLevel: 'patch',
    currentVersion: '0.9.0',
    newVersion: '0.9.1',
    changelogEntry: '## 0.9.1\n- patch fix',
    commitGroups: [],
    reviewResult: { critical: [], informational: [], summary: 'Review passed: 0 informational finding(s)' },
    prTitle: 'chore: patch release',
    prBody: 'Patch release body',
    ...overrides,
  };
}

function makeStateStubs() {
  const saved: DanteState[] = [];
  const state: DanteState = {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
  return {
    _loadState: async () => ({ ...state, auditLog: [...state.auditLog] }) as DanteState,
    _saveState: async (s: DanteState) => { saved.push(s); },
    saved,
  };
}

describe('ship command: exit code behavior', () => {
  it('no critical findings → exitCode stays 0', async () => {
    const st = makeStateStubs();
    await ship({
      _buildShipPlan: async () => makeShipPlan(),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(process.exitCode, 0);
  });

  it('critical finding + no --skip-review → exitCode 1', async () => {
    const st = makeStateStubs();
    await ship({
      _buildShipPlan: async () => makeShipPlan({
        reviewResult: { critical: [makeCritical()], informational: [], summary: 'CRITICAL' },
      }),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('critical finding + --skip-review → exitCode stays 0', async () => {
    const st = makeStateStubs();
    await ship({
      skipReview: true,
      _buildShipPlan: async () => makeShipPlan({
        reviewResult: { critical: [makeCritical()], informational: [], summary: 'CRITICAL' },
      }),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(process.exitCode, 0);
  });

  it('informational findings only → exitCode stays 0', async () => {
    const st = makeStateStubs();
    await ship({
      _buildShipPlan: async () => makeShipPlan({
        reviewResult: { critical: [], informational: [makeInfo()], summary: 'Review passed' },
      }),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(process.exitCode, 0);
  });
});

describe('ship command: buildShipPlan arg forwarding', () => {
  it('passes dryRun=true to buildShipPlan when --dry-run set', async () => {
    let receivedDryRun = false;
    const st = makeStateStubs();
    await ship({
      dryRun: true,
      _buildShipPlan: async (_cwd, isDryRun) => { receivedDryRun = isDryRun; return makeShipPlan(); },
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(receivedDryRun, true);
  });

  it('passes dryRun=false to buildShipPlan by default', async () => {
    let receivedDryRun: boolean | undefined;
    const st = makeStateStubs();
    await ship({
      _buildShipPlan: async (_cwd, isDryRun) => { receivedDryRun = isDryRun; return makeShipPlan(); },
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.strictEqual(receivedDryRun, false);
  });
});

describe('ship command: audit log', () => {
  it('writes audit log entry on successful run', async () => {
    const st = makeStateStubs();
    await ship({
      _buildShipPlan: async () => makeShipPlan(),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    assert.ok(st.saved.length > 0, 'state should be saved');
    const entry = st.saved[0]!.auditLog[0]!;
    assert.match(entry, /ship:/, 'audit entry should contain ship:');
    assert.match(entry, /0\.9\.0->0\.9\.1/, 'audit entry should include version bump');
  });

  it('includes skip-review warning in audit log when --skip-review used', async () => {
    const st = makeStateStubs();
    await ship({
      skipReview: true,
      _buildShipPlan: async () => makeShipPlan({
        reviewResult: { critical: [makeCritical()], informational: [], summary: 'CRITICAL' },
      }),
      _loadState: st._loadState,
      _saveState: st._saveState,
    });
    const entries = st.saved[0]!.auditLog;
    const warnEntry = entries.find(e => e.includes('WARNING') && e.includes('skip-review'));
    assert.ok(warnEntry, 'should include skip-review warning in audit log');
  });

  it('state save failure is swallowed (best-effort)', async () => {
    await assert.doesNotReject(async () => {
      await ship({
        _buildShipPlan: async () => makeShipPlan(),
        _loadState: async () => { throw new Error('state unavailable'); },
        _saveState: async () => {},
      });
    }, 'state load failure should not propagate');
  });
});
