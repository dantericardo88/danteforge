// LAW L4 — Process hygiene: every spawn in a flow is tracked and reaped on exit/timeout.
//
// Drives the REAL runCli path (src/cli/commands/ascend-frontier-runner.ts) through the
// setRunnerProcessControl recording seam: clean exit, spawn-glitch retry (fast 127), and the
// timeout tree-kill (exit 124) path — asserting track/untrack pairing and killTree-on-timeout.
// Also drives the codex adapter's runChild through its _spawn seam with a REAL grandchild
// process, asserting the timeout path genuinely tree-kills it (the zombie-accumulation pin).
//
// NEGATIVE CONTROL: fleet-shaped event logs (a child tracked but never untracked; an untrack
// that races ahead of the kill) are fed to the pairing checker and it is asserted to TRIP.

import { describe, test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  runCli, setRunnerProcessControl, type RunnerProcessControl,
} from '../../src/cli/commands/ascend-frontier-runner.js';
import { CodexAdapter, type CodexChildLike } from '../../src/matrix/adapters/codex-adapter.js';
import type { AgentRunInput } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease } from '../../src/matrix/types/lease.js';
import type { WorkPacket } from '../../src/matrix/types/work-graph.js';
import { lawsTmpDir, rmrf, checkSpawnHygiene, type SpawnHygieneEvent } from './rig.js';

const ROOT = lawsTmpDir('l4');
before(async () => { await fs.mkdir(ROOT, { recursive: true }); });
after(async () => {
  setRunnerProcessControl(); // always restore the real surface
  await rmrf(ROOT);
});

interface RecordingChild extends EventEmitter {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
}

function makeRecordingControl(opts: {
  pidStart: number;
  behavior: 'close-0' | 'error-enoent' | 'never-close';
  timeoutMs: number;
}): { control: Partial<RunnerProcessControl>; events: SpawnHygieneEvent[] } {
  const events: SpawnHygieneEvent[] = [];
  let nextPid = opts.pidStart;
  const spawnFn = ((): ChildProcess => {
    const child = new EventEmitter() as RecordingChild;
    child.pid = nextPid++;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    events.push({ kind: 'spawn', pid: child.pid });
    if (opts.behavior === 'close-0') {
      setImmediate(() => child.emit('close', 0, null));
    } else if (opts.behavior === 'error-enoent') {
      const err = new Error('spawn danteforge ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      setImmediate(() => child.emit('error', err));
    }
    // never-close: the child hangs until the phase timeout fires.
    return child as unknown as ChildProcess;
  }) as unknown as RunnerProcessControl['spawnFn'];
  const control: Partial<RunnerProcessControl> = {
    spawnFn,
    trackChildFn: (pid) => events.push({ kind: 'track', pid }),
    untrackChildFn: (pid) => events.push({ kind: 'untrack', pid }),
    killTreeFn: (pid) => events.push({ kind: 'kill', pid }),
    phaseTimeoutMsFn: () => opts.timeoutMs,
  };
  return { control, events };
}

describe('L4 — runCli drive-through with the recording process-control seam', () => {
  test('clean exit: tracked once, untracked once, never killed', async () => {
    const { control, events } = makeRecordingControl({ pidStart: 9001, behavior: 'close-0', timeoutMs: 60_000 });
    setRunnerProcessControl(control);
    try {
      const res = await runCli(ROOT, ['outcomes', '--status']);
      assert.equal(res.exitCode, 0);
      assert.equal(res.ok, true);
    } finally {
      setRunnerProcessControl();
    }
    assert.deepEqual(checkSpawnHygiene(events), []);
    assert.equal(events.filter(e => e.kind === 'kill').length, 0, 'no kill on a clean exit');
  });

  test('spawn-glitch retry (fast 127): BOTH attempts are individually tracked and reaped', async () => {
    const { control, events } = makeRecordingControl({ pidStart: 9101, behavior: 'error-enoent', timeoutMs: 60_000 });
    setRunnerProcessControl(control);
    try {
      const res = await runCli(ROOT, ['gap', '--all']);
      assert.equal(res.exitCode, 127, 'a persistent ENOENT stays 127 after the single retry');
    } finally {
      setRunnerProcessControl();
    }
    assert.equal(events.filter(e => e.kind === 'spawn').length, 2, 'exactly one retry');
    assert.deepEqual(checkSpawnHygiene(events), [], 'pairing holds across the retry');
  });

  test('the 124 path: timeout fires killTree on the child pid, THEN reaps it', async () => {
    const { control, events } = makeRecordingControl({ pidStart: 9201, behavior: 'never-close', timeoutMs: 40 });
    setRunnerProcessControl(control);
    let res;
    try {
      res = await runCli(ROOT, ['harden-crusade', '--loop']);
    } finally {
      setRunnerProcessControl();
    }
    assert.equal(res.exitCode, 124, 'the phase timeout is the only exit for a hung child');
    assert.equal(res.ok, false);
    const kills = events.filter(e => e.kind === 'kill');
    assert.equal(kills.length, 1, 'the WHOLE TREE is killed exactly once on timeout');
    assert.equal(kills[0]!.pid, 9201);
    assert.deepEqual(checkSpawnHygiene(events), [], 'kill-then-untrack ordering and pairing hold');
  });
});

describe('L4 — codex adapter runChild via the _spawn seam: timeout tree-kills a REAL grandchild', () => {
  function makeLease(): AgentLease {
    return {
      id: 'laws-lease', workPacketId: 'wp-laws', provider: 'codex', branch: 'laws-branch',
      worktreePath: ROOT, allowedWritePaths: ['src/**'], allowedReadPaths: ['**'],
      forbiddenPaths: [], requiredCommands: [],
    } as unknown as AgentLease;
  }
  function makeWorkPacket(): WorkPacket {
    return {
      id: 'wp-laws', title: 'laws', objective: 'laws', dimensionId: 'laws_dim', paths: {},
      dependsOn: [], mayConflictWith: [], acceptanceCriteria: ['x'], proof: { proofRequired: [] },
      tasteGateRequired: false, redTeamRequired: false, rollbackPlan: 'revert', riskLevel: 'low',
      createdAt: new Date().toISOString(),
    } as unknown as WorkPacket;
  }
  function isAlive(pid: number): boolean {
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  test('a hung agent child is tree-killed (exit 124) and the real grandchild process dies', async (t) => {
    // A REAL long-lived process stands in for the agent CLI's own helper tree — the exact
    // thing the fleet found surviving parent exits. killTree must take it down.
    const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore', windowsHide: true,
    });
    t.after(() => { try { grandchild.kill(); } catch { /* already dead — the law did its job */ } });
    assert.ok(grandchild.pid, 'real grandchild spawned');
    assert.ok(isAlive(grandchild.pid!), 'grandchild is alive before the run');

    let killRequested = false;
    const hungChild: CodexChildLike = {
      pid: grandchild.pid,
      stdout: null, stderr: null, stdin: null,
      on() { return this; }, // never emits close — the hang
      kill() { killRequested = true; return true; },
    } as unknown as CodexChildLike;

    const adapter = new CodexAdapter({
      workPacket: makeWorkPacket(),
      timeoutMs: 250,
      _isAvailable: async () => true,
      _spawn: () => hungChild,
      _gitDiff: async () => [],
      _revertFile: async () => {},
    });
    const input: AgentRunInput = { lease: makeLease(), cwd: ROOT };
    const prepared = await adapter.prepareRun(input);
    const handle = await adapter.startRun(prepared);
    const result = await adapter.collectResult(handle);

    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason?.includes('124'), `timeout surfaces as exit 124: ${result.errorReason}`);
    assert.ok(killRequested, 'the direct child handle was killed too');

    // The tree-kill is detached (taskkill /T /F) — poll until the REAL grandchild is gone.
    const deadline = Date.now() + 10_000;
    while (isAlive(grandchild.pid!) && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    assert.equal(isAlive(grandchild.pid!), false,
      'killTree on the timeout path must reap the WHOLE descendant tree — a surviving grandchild is the zombie-leak bug');
  });
});

describe('L4 — NEGATIVE controls: fleet-shaped hygiene violations TRIP the checker', () => {
  test('a tracked-but-never-untracked child (the zombie shape) is flagged', () => {
    const events: SpawnHygieneEvent[] = [
      { kind: 'spawn', pid: 7001 },
      { kind: 'track', pid: 7001 },
      // process exits; nothing reaps 7001 — the fleet's surviving-builder shape
    ];
    const violations = checkSpawnHygiene(events);
    assert.ok(violations.some(v => v.includes('untracked 0 times')), violations.join(' | '));
  });

  test('a spawn that was never tracked at all is flagged', () => {
    const events: SpawnHygieneEvent[] = [
      { kind: 'spawn', pid: 7002 },
      { kind: 'untrack', pid: 7002 },
    ];
    const violations = checkSpawnHygiene(events);
    assert.ok(violations.some(v => v.includes('tracked 0 times')), violations.join(' | '));
  });

  test('an untrack racing AHEAD of the tree-kill is flagged (the pid-release race shape)', () => {
    const events: SpawnHygieneEvent[] = [
      { kind: 'spawn', pid: 7003 },
      { kind: 'track', pid: 7003 },
      { kind: 'untrack', pid: 7003 },
      { kind: 'kill', pid: 7003 },
    ];
    const violations = checkSpawnHygiene(events);
    assert.ok(violations.some(v => v.includes('untracked BEFORE the tree-kill')), violations.join(' | '));
  });
});
