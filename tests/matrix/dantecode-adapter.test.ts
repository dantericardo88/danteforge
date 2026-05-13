// Phase 13c — DanteCodeAdapter tests (mocked spawn)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DanteCodeAdapter,
  parseEdits,
  validateEditsAgainstLease,
  buildPacketJson,
  collectContextFiles,
} from '../../src/matrix/adapters/dantecode-adapter.js';
import type {
  DanteCodeChildLike,
  DanteCodeSpawnFn,
} from '../../src/matrix/adapters/dantecode-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease, WorkPacket } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function makeWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dantecode-adapter-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'dantecode', agentRole: 'dimension-engineer',
    branch: 'b', worktreePath,
    allowedWritePaths: ['src/sample.ts'],
    allowedReadPaths: ['src/**'],
    forbiddenPaths: ['src/forbidden.ts'],
    requiredCommands: [], budget: { maxTokens: 200000, maxRuntimeMinutes: 30, maxIterations: 3 },
    status: 'active',
    ...overrides,
  };
}

function fakePacket(overrides: Partial<WorkPacket> = {}): WorkPacket {
  return {
    id: 'work.test', title: 'Test packet', objective: 'Add a hello function',
    dimensionId: 'dim.test',
    paths: {
      ownedPaths: ['src/sample.ts'],
      readOnlyPaths: [],
      forbiddenPaths: ['src/forbidden.ts'],
    },
    dependsOn: [], mayConflictWith: [],
    acceptanceCriteria: ['hello function exists', 'returns "hello"'],
    proof: { proofRequired: ['typecheck passes'], requiredCommands: ['npm run typecheck'] },
    tasteGateRequired: false, redTeamRequired: false,
    rollbackPlan: 'remove worktree',
    riskLevel: 'low',
    createdAt: '',
    ...overrides,
  };
}

/** Builds a spawn stub that asynchronously writes `outputBody` to the worktree's
 *  output file (or skips it if `outputBody === null`), then emits a 'close'
 *  event with `exitCode`. */
function makeSpawnStub(opts: {
  cwd: string;
  outputBody: string | null;
  exitCode: number;
}): DanteCodeSpawnFn {
  return (_cmd, _args, _o) => {
    const emitter = new EventEmitter() as EventEmitter & DanteCodeChildLike;
    emitter.kill = () => true;
    setImmediate(async () => {
      if (opts.outputBody !== null) {
        await fs.writeFile(path.join(opts.cwd, '.dantecode-output.json'), opts.outputBody, 'utf8');
      }
      emitter.emit('close', opts.exitCode);
    });
    return emitter;
  };
}

// ── isAvailable ────────────────────────────────────────────────────────────

describe('DanteCodeAdapter.isAvailable', () => {
  it('returns true when _isAvailable injection reports true', async () => {
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
    });
    assert.equal(await adapter.isAvailable(), true);
  });

  it('returns false when _isAvailable injection reports false', async () => {
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => false,
    });
    assert.equal(await adapter.isAvailable(), false);
  });

  it('falls back to DANTECODE_BIN env var presence', async () => {
    const prev = process.env.DANTECODE_BIN;
    process.env.DANTECODE_BIN = '/usr/local/bin/dantecode';
    try {
      const adapter = new DanteCodeAdapter({ workPacket: fakePacket() });
      assert.equal(await adapter.isAvailable(), true);
    } finally {
      if (prev === undefined) delete process.env.DANTECODE_BIN;
      else process.env.DANTECODE_BIN = prev;
    }
  });
});

// ── parseEdits ──────────────────────────────────────────────────────────────

describe('DanteCodeAdapter.parseEdits', () => {
  it('parses a clean JSON array', () => {
    const raw = '[{"path":"src/x.ts","action":"write","contents":"export const x=1;"}]';
    const edits = parseEdits(raw);
    assert.ok(edits);
    assert.equal(edits!.length, 1);
  });

  it('parses an object with an edits field (CLI shape)', () => {
    const raw = '{"edits":[{"path":"src/x.ts","action":"delete"}]}';
    const edits = parseEdits(raw);
    assert.ok(edits);
    assert.equal(edits![0]!.action, 'delete');
  });

  it('returns null on non-array, non-{edits} JSON', () => {
    assert.equal(parseEdits('{"path":"x","action":"write"}'), null);
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parseEdits('garbage'), null);
  });

  it('returns null when write edit is missing contents', () => {
    assert.equal(parseEdits('[{"path":"x","action":"write"}]'), null);
  });
});

// ── validateEditsAgainstLease ──────────────────────────────────────────────

describe('DanteCodeAdapter.validateEditsAgainstLease', () => {
  const lease = fakeLease('/tmp');

  it('approves owned paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/sample.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, true);
  });

  it('rejects forbidden paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/forbidden.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations[0]!.includes('FORBIDDEN'));
  });

  it('rejects unowned paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/other.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations[0]!.includes('outside'));
  });
});

// ── buildPacketJson ────────────────────────────────────────────────────────

describe('DanteCodeAdapter.buildPacketJson', () => {
  it('serializes workPacket + lease + contextFiles', () => {
    const json = buildPacketJson(
      fakePacket({ objective: 'Build feature X' }),
      fakeLease('/tmp'),
      [{ relativePath: 'src/existing.ts', contents: 'export const X = 1;', truncated: false }],
    );
    const parsed = JSON.parse(json);
    assert.equal(parsed.workPacket.objective, 'Build feature X');
    assert.deepEqual(parsed.lease.allowedWritePaths, ['src/sample.ts']);
    assert.equal(parsed.contextFiles[0].relativePath, 'src/existing.ts');
  });
});

// ── DanteCodeAdapter end-to-end (with mocked spawn) ───────────────────────

describe('DanteCodeAdapter end-to-end', () => {
  it('writes files when CLI emits valid edits and exits 0', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([
      { path: 'src/sample.ts', action: 'write', contents: 'export const hello = () => "hello";' },
    ]);
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
    const written = await fs.readFile(path.join(cwd, 'src/sample.ts'), 'utf8');
    assert.ok(written.includes('hello'));
    assert.equal(result.commandsExecuted.length, 1);
    assert.equal(result.commandsExecuted[0]!.exitCode, 0);
  });

  it('fails when CLI exits non-zero', async () => {
    const cwd = await makeWorktree();
    const stub = makeSpawnStub({ cwd, outputBody: null, exitCode: 1 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('dantecode_cli_exit_1'));
  });

  it('fails when CLI returns malformed JSON', async () => {
    const cwd = await makeWorktree();
    const stub = makeSpawnStub({ cwd, outputBody: 'not even close to JSON', exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorReason, 'cli_returned_malformed_json');
  });

  it('fails when CLI tries to edit a forbidden path', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([
      { path: 'src/forbidden.ts', action: 'write', contents: 'evil = true;' },
    ]);
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('edit_outside_lease'));
    assert.ok(result.errorReason!.includes('FORBIDDEN'));
    await assert.rejects(() => fs.access(path.join(cwd, 'src/forbidden.ts')));
  });

  it('fails when CLI tries to edit outside lease (unowned path)', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([
      { path: 'src/somewhere-else.ts', action: 'write', contents: 'x' },
    ]);
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('edit_outside_lease'));
  });

  it('fails when CLI exits 0 but output file is missing', async () => {
    const cwd = await makeWorktree();
    const stub = makeSpawnStub({ cwd, outputBody: null, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('output_file_missing'));
  });

  it('applies a two-edit batch via mocked _writeFile', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([
      { path: 'src/a.ts', action: 'write', contents: 'export const a = 1;' },
      { path: 'src/b.ts', action: 'write', contents: 'export const b = 2;' },
    ]);
    const writes: string[] = [];
    // Capture writeFile but still let the input/output JSON files land on disk
    // (the stub reads them via real fs in the close handler).
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
      _writeFile: async (p, c) => { writes.push(p); await fs.writeFile(p, c, 'utf8'); },
    });
    const lease = fakeLease(cwd, { allowedWritePaths: ['src/a.ts', 'src/b.ts'] });
    const result = await runAdapter(adapter, { lease, cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/a.ts', 'src/b.ts']);
    // _writeFile must have been invoked for both edits + the input descriptor file.
    assert.ok(writes.some(p => p.endsWith('a.ts')));
    assert.ok(writes.some(p => p.endsWith('b.ts')));
  });

  it('invokes _removeFile for delete actions', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([{ path: 'src/sample.ts', action: 'delete' }]);
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    let removedPath = '';
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
      _removeFile: async (p) => { removedPath = p; },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.ok(removedPath.endsWith('sample.ts'));
  });

  it('cleans up run state after stopRun', async () => {
    const cwd = await makeWorktree();
    const stub = makeSpawnStub({ cwd, outputBody: '[]', exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const prepared = await adapter.prepareRun({ lease: fakeLease(cwd), cwd });
    const handle = await adapter.startRun(prepared);
    await adapter.stopRun(handle);
    await assert.rejects(() => adapter.collectResult(handle));
  });

  it('streams started + file_changed + completed events', async () => {
    const cwd = await makeWorktree();
    const editsJson = JSON.stringify([
      { path: 'src/sample.ts', action: 'write', contents: 'x' },
    ]);
    const stub = makeSpawnStub({ cwd, outputBody: editsJson, exitCode: 0 });
    const adapter = new DanteCodeAdapter({
      workPacket: fakePacket(),
      _isAvailable: async () => true,
      _spawn: stub,
    });
    const prepared = await adapter.prepareRun({ lease: fakeLease(cwd), cwd });
    const handle = await adapter.startRun(prepared);
    const kinds: string[] = [];
    for await (const event of adapter.streamEvents(handle)) kinds.push(event.kind);
    assert.ok(kinds.includes('started'));
    assert.ok(kinds.includes('file_changed'));
    assert.ok(kinds.includes('completed'));
  });
});

// ── collectContextFiles ────────────────────────────────────────────────────

describe('DanteCodeAdapter.collectContextFiles', () => {
  it('truncates files longer than maxLines', async () => {
    const cwd = await makeWorktree();
    await fs.mkdir(path.join(cwd, 'src'), { recursive: true });
    const longContent = Array(500).fill('const x = 1;').join('\n');
    await fs.writeFile(path.join(cwd, 'src/big.ts'), longContent);
    const lease = fakeLease(cwd, { allowedWritePaths: ['src/big.ts'] });
    const files = await collectContextFiles(
      cwd, lease, (p) => fs.readFile(p, 'utf8'), 20, 50,
    );
    assert.equal(files.length, 1);
    assert.equal(files[0]!.truncated, true);
    assert.ok(files[0]!.contents.length < longContent.length);
  });
});
