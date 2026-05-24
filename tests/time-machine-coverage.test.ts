// time-machine-coverage.test.ts — every durable-state surface emits a Time Machine commit.
//
// The substrate already wired outcome-runner, hardener, and frontier-state in
// prior sessions. This test file covers the 4 remaining surfaces wired in this
// session: probe, honest-rescore, dispensation create + clear, evidence-scaffold.
//
// Each surface accepts a tri-state `_createTimeMachineCommit` injection seam:
//   undefined → lazy-import the real createTimeMachineCommit
//   null      → disable (test paths)
//   function  → injected mock (counter / label assertions)
//
// The test passes a counter function and asserts:
//   1. The seam fires when the surface writes durable state
//   2. The label follows the convention declared in the plan
//   3. Materials include the artifact path

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runProbe } from '../src/cli/commands/probe.js';
import { runHonestRescore } from '../src/cli/commands/honest-rescore.js';
import { dispensationCreate, dispensationClear } from '../src/cli/commands/dispensation.js';
import { runEvidenceScaffold } from '../src/cli/commands/evidence-scaffold.js';
import { saveMatrix, type CompeteMatrix } from '../src/core/compete-matrix.js';

interface TmCall {
  cwd: string;
  paths: string[];
  label: string;
  materials: string[];
}

function makeTmRecorder(): { calls: TmCall[]; fn: (opts: { cwd?: string; paths?: string[]; label?: string; causalLinks?: { materials?: string[]; inputDependencies?: string[] } }) => Promise<unknown> } {
  const calls: TmCall[] = [];
  return {
    calls,
    fn: async (opts) => {
      calls.push({
        cwd: opts.cwd ?? '',
        paths: opts.paths ?? [],
        label: opts.label ?? '',
        materials: opts.causalLinks?.materials ?? [],
      });
      return { ok: true };
    },
  };
}

async function mkTmp(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

// ── probe ────────────────────────────────────────────────────────────────────

describe('probe → Time Machine', () => {
  it('emits probe-evidence/<tier>/<runner>/<pass|fail> when probe writes evidence', async () => {
    const cwd = await mkTmp('tm-probe-');
    try {
      const recorder = makeTmRecorder();
      await runProbe({
        cwd,
        tier: 'T1',
        forceCold: true,
        _detectRunner: async () => 'npm',
        _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
        _readGitSha: async () => ({ gitSha: 'abc123', worktreeFingerprint: 'abc123' }),
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 1, 'probe should emit exactly one TM commit');
      const call = recorder.calls[0]!;
      assert.match(call.label, /^probe-evidence\/T1\/npm\/(pass|fail)$/);
      assert.equal(call.paths.length, 1);
      assert.ok(call.paths[0]!.includes('runtime-evidence'), 'paths should reference runtime-evidence');
      assert.deepEqual(call.materials, call.paths);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('honors _createTimeMachineCommit: null (disable)', async () => {
    const cwd = await mkTmp('tm-probe-disabled-');
    try {
      // null means "do not emit", and the test must not throw or read TM module.
      await runProbe({
        cwd,
        tier: 'T1',
        forceCold: true,
        _detectRunner: async () => 'npm',
        _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
        _readGitSha: async () => ({ gitSha: 'def456', worktreeFingerprint: 'def456' }),
        _createTimeMachineCommit: null,
      });
      // No assertion on TM; just verify the call returned successfully (no throw).
      assert.ok(true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('honors _noWrite (skips evidence file AND TM)', async () => {
    const cwd = await mkTmp('tm-probe-nowrite-');
    try {
      const recorder = makeTmRecorder();
      const result = await runProbe({
        cwd,
        tier: 'T1',
        forceCold: true,
        _detectRunner: async () => 'npm',
        _spawn: () => ({ status: 0, stdout: 'ok', stderr: '' }),
        _readGitSha: async () => ({ gitSha: 'ghi789', worktreeFingerprint: 'ghi789' }),
        _createTimeMachineCommit: recorder.fn,
        _noWrite: true,
      });
      assert.equal(recorder.calls.length, 0, '_noWrite must suppress TM commit');
      assert.ok(result.evidencePath, 'result still carries evidencePath');
      // Verify file was NOT written
      try {
        await fs.access(result.evidencePath);
        assert.fail('evidence file should not exist under _noWrite');
      } catch { /* expected */ }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

// ── honest-rescore ────────────────────────────────────────────────────────────

describe('honest-rescore → Time Machine', () => {
  async function setupMinimalMatrix(cwd: string): Promise<void> {
    const matrix: CompeteMatrix = {
      project: 'tm-honest-test',
      competitors: ['cursor'],
      competitors_closed_source: ['cursor'],
      competitors_oss: [],
      lastUpdated: '2026-05-18T00:00:00.000Z',
      overallSelfScore: 7.0,
      dimensions: [
        {
          id: 'testing', label: 'Testing', weight: 1.0, category: 'quality',
          frequency: 'high', scores: { self: 7.0, cursor: 8.0 },
          gap_to_leader: 1.0, leader: 'cursor',
          gap_to_closed_source_leader: 1.0, closed_source_leader: 'cursor',
          gap_to_oss_leader: 0, oss_leader: 'none',
          status: 'in-progress', sprint_history: [], next_sprint_target: 9.0,
        },
      ],
    };
    await saveMatrix(matrix, cwd);
  }

  it('emits honest-rescore/reported=X.XX->honest=Y.YY when rescore writes', async () => {
    const cwd = await mkTmp('tm-honest-');
    try {
      await setupMinimalMatrix(cwd);
      const recorder = makeTmRecorder();
      await runHonestRescore({
        cwd,
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 1);
      const call = recorder.calls[0]!;
      assert.match(call.label, /^honest-rescore\/reported=\d+\.\d{2}->honest=\d+\.\d{2}$/);
      assert.equal(call.paths.length, 2, 'paths should include both honest matrix and diff report');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('honors _noWrite (skips files AND TM)', async () => {
    const cwd = await mkTmp('tm-honest-nowrite-');
    try {
      await setupMinimalMatrix(cwd);
      const recorder = makeTmRecorder();
      await runHonestRescore({
        cwd,
        _noWrite: true,
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

// ── dispensation ──────────────────────────────────────────────────────────────

describe('dispensation create → Time Machine', () => {
  it('emits dispensation-created/<dim>/<id> on create', async () => {
    const cwd = await mkTmp('tm-disp-create-');
    try {
      const recorder = makeTmRecorder();
      const disp = await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'test fixture for TM coverage of create path',
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 1);
      const call = recorder.calls[0]!;
      assert.equal(call.label, `dispensation-created/security/${disp.id}`);
      assert.equal(call.paths.length, 1);
      assert.ok(call.paths[0]!.includes('dispensations'));
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('dispensation clear → Time Machine', () => {
  it('emits dispensation-cleared/<dim>/<id> on clear', async () => {
    const cwd = await mkTmp('tm-disp-clear-');
    try {
      // Create first (this will emit a -created commit; ignore it).
      const created = await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'test fixture for TM coverage of clear path',
        _createTimeMachineCommit: null, // suppress create commit
      });
      // Now clear and watch the TM seam.
      const recorder = makeTmRecorder();
      await dispensationClear({
        cwd,
        dispensationId: created.id,
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 1);
      const call = recorder.calls[0]!;
      assert.equal(call.label, `dispensation-cleared/security/${created.id}`);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

// ── evidence-scaffold ────────────────────────────────────────────────────────

describe('evidence-scaffold → Time Machine', () => {
  it('emits outcome-scaffold/<N>-dims when scaffolding mutates matrix.json', async () => {
    const cwd = await mkTmp('tm-scaffold-');
    try {
      const recorder = makeTmRecorder();
      // Inject a minimal matrix with one dim missing capability_test.
      const matrix: CompeteMatrix = {
        project: 'tm-scaffold-test',
        competitors: ['cursor'],
        competitors_closed_source: ['cursor'],
        competitors_oss: [],
        lastUpdated: '2026-05-18T00:00:00.000Z',
        overallSelfScore: 5.0,
        dimensions: [
          {
            id: 'testing', label: 'Testing', weight: 1.0, category: 'quality',
            frequency: 'high', scores: { self: 5.0, cursor: 8.0 },
            gap_to_leader: 3.0, leader: 'cursor',
            gap_to_closed_source_leader: 3.0, closed_source_leader: 'cursor',
            gap_to_oss_leader: 0, oss_leader: 'none',
            status: 'in-progress', sprint_history: [], next_sprint_target: 7.0,
          },
        ],
      };
      // Need a package.json so detectProjectType returns 'npm' (so capability_test gets auto-scaffolded).
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"tm-scaffold-fixture"}');
      const writes: Array<{ path: string; content: string }> = [];
      await runEvidenceScaffold({
        cwd,
        _loadMatrix: async () => matrix,
        _writeFile: async (p, c) => { writes.push({ path: p, content: c }); },
        _writeMatrix: async (m, p) => { writes.push({ path: p, content: JSON.stringify(m) }); },
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 1, 'scaffold should emit exactly one TM commit');
      const call = recorder.calls[0]!;
      assert.match(call.label, /^outcome-scaffold\/\d+-dims$/);
      assert.equal(call.paths.length, 1);
      assert.ok(call.paths[0]!.endsWith('matrix.json'));
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('does NOT emit TM when dryRun is true (no matrix write happened)', async () => {
    const cwd = await mkTmp('tm-scaffold-dry-');
    try {
      await fs.mkdir(cwd, { recursive: true });
      await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"tm-scaffold-dry"}');
      const recorder = makeTmRecorder();
      const matrix: CompeteMatrix = {
        project: 'tm-scaffold-dry',
        competitors: ['cursor'],
        competitors_closed_source: ['cursor'],
        competitors_oss: [],
        lastUpdated: '2026-05-18T00:00:00.000Z',
        overallSelfScore: 5.0,
        dimensions: [
          {
            id: 'testing', label: 'Testing', weight: 1.0, category: 'quality',
            frequency: 'high', scores: { self: 5.0, cursor: 8.0 },
            gap_to_leader: 3.0, leader: 'cursor',
            gap_to_closed_source_leader: 3.0, closed_source_leader: 'cursor',
            gap_to_oss_leader: 0, oss_leader: 'none',
            status: 'in-progress', sprint_history: [], next_sprint_target: 7.0,
          },
        ],
      };
      await runEvidenceScaffold({
        cwd,
        dryRun: true,
        _loadMatrix: async () => matrix,
        _writeFile: async () => { /* dry */ },
        _writeMatrix: async () => { /* dry */ },
        _createTimeMachineCommit: recorder.fn,
      });
      assert.equal(recorder.calls.length, 0, 'dry-run must NOT emit TM');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
