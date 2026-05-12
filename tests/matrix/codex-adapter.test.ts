// Phase 13b — CodexAdapter tests (mocked LLM)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CodexAdapter,
  parseEdits,
  validateEditsAgainstLease,
  buildCodingPrompt,
  collectContextFiles,
} from '../../src/matrix/adapters/codex-adapter.js';
import { runAdapter } from '../../src/matrix/adapters/adapter-interface.js';
import type { AgentLease, WorkPacket } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
async function makeWorktree(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-adapter-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

function fakeLease(worktreePath: string, overrides: Partial<AgentLease> = {}): AgentLease {
  return {
    id: 'lease.test', workPacketId: 'work.test',
    provider: 'codex', agentRole: 'dimension-engineer',
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

// ── parseEdits ──────────────────────────────────────────────────────────────

describe('CodexAdapter.parseEdits', () => {
  it('parses a clean JSON array', () => {
    const raw = '[{"path":"src/x.ts","action":"write","contents":"export const x=1;"}]';
    const edits = parseEdits(raw);
    assert.ok(edits);
    assert.equal(edits!.length, 1);
    assert.equal(edits![0]!.action, 'write');
  });

  it('strips markdown fences even though the prompt tells OpenAI not to use them', () => {
    const raw = '```json\n[{"path":"src/x.ts","action":"delete"}]\n```';
    const edits = parseEdits(raw);
    assert.ok(edits);
    assert.equal(edits![0]!.action, 'delete');
  });

  it('returns null on non-array JSON', () => {
    assert.equal(parseEdits('{"path":"x","action":"write"}'), null);
  });

  it('returns null on malformed JSON', () => {
    assert.equal(parseEdits('I will not return JSON, ha!'), null);
  });

  it('returns null when write edit is missing contents', () => {
    assert.equal(parseEdits('[{"path":"x","action":"write"}]'), null);
  });

  it('returns null on invalid action', () => {
    assert.equal(parseEdits('[{"path":"x","action":"frobnicate","contents":""}]'), null);
  });
});

// ── validateEditsAgainstLease ──────────────────────────────────────────────

describe('CodexAdapter.validateEditsAgainstLease', () => {
  const lease = fakeLease('/tmp');

  it('approves edits within allowed write paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/sample.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, true);
  });

  it('rejects edits to forbidden paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/forbidden.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations[0]!.includes('FORBIDDEN'));
  });

  it('rejects edits outside allowed write paths', () => {
    const r = validateEditsAgainstLease(
      [{ path: 'src/somewhere-else.ts', action: 'write', contents: 'x' }],
      lease,
    );
    assert.equal(r.ok, false);
    assert.ok(r.violations[0]!.includes('outside'));
  });
});

// ── buildCodingPrompt ──────────────────────────────────────────────────────

describe('CodexAdapter.buildCodingPrompt', () => {
  it('includes the objective and acceptance criteria', () => {
    const prompt = buildCodingPrompt(
      fakePacket({ objective: 'Build feature X' }),
      fakeLease('/tmp'),
      [],
    );
    assert.ok(prompt.includes('Build feature X'));
    assert.ok(prompt.includes('hello function exists'));
  });

  it('lists owned + forbidden paths', () => {
    const prompt = buildCodingPrompt(
      fakePacket(),
      fakeLease('/tmp', {
        allowedWritePaths: ['src/foo.ts'],
        forbiddenPaths: ['src/cli/index.ts'],
      }),
      [],
    );
    assert.ok(prompt.includes('src/foo.ts'));
    assert.ok(prompt.includes('src/cli/index.ts'));
  });

  it('explicitly forbids markdown fences (OpenAI-style nudge)', () => {
    const prompt = buildCodingPrompt(fakePacket(), fakeLease('/tmp'), []);
    assert.ok(/no markdown fences/i.test(prompt));
  });
});

// ── CodexAdapter (with injected LLM) ───────────────────────────────────────

describe('CodexAdapter', () => {
  it('isAvailable returns true', async () => {
    const adapter = new CodexAdapter({ workPacket: fakePacket() });
    assert.equal(await adapter.isAvailable(), true);
  });

  it('writes files when LLM returns valid edits', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/sample.ts', action: 'write', contents: 'export function hello(): string { return "hello"; }' }]),
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/sample.ts']);
    const written = await fs.readFile(path.join(cwd, 'src/sample.ts'), 'utf8');
    assert.ok(written.includes('function hello'));
  });

  it('fails when LLM returns malformed JSON', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () => 'I refuse to comply with the JSON contract',
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.equal(result.errorReason, 'llm_returned_malformed_json');
    assert.equal(result.filesChanged.length, 0);
  });

  it('fails when LLM tries to edit forbidden paths', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/forbidden.ts', action: 'write', contents: 'evil = true;' }]),
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('edit_outside_lease'));
    assert.ok(result.errorReason!.includes('FORBIDDEN'));
    await assert.rejects(() => fs.access(path.join(cwd, 'src/forbidden.ts')));
  });

  it('fails on edit outside lease (not forbidden, just unowned)', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/somewhere-else.ts', action: 'write', contents: 'x' }]),
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('edit_outside_lease'));
  });

  it('applies a two-edit batch', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () => JSON.stringify([
        { path: 'src/a.ts', action: 'write', contents: 'export const a = 1;' },
        { path: 'src/b.ts', action: 'write', contents: 'export const b = 2;' },
      ]),
    });
    const lease = fakeLease(cwd, { allowedWritePaths: ['src/a.ts', 'src/b.ts'] });
    const result = await runAdapter(adapter, { lease, cwd });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.filesChanged, ['src/a.ts', 'src/b.ts']);
  });

  it('handles delete action via _removeFile injection', async () => {
    const cwd = await makeWorktree();
    let removedPath = '';
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () =>
        JSON.stringify([{ path: 'src/sample.ts', action: 'delete' }]),
      _removeFile: async (p) => { removedPath = p; },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'completed');
    assert.ok(removedPath.endsWith('sample.ts'));
  });

  it('cleans up run state after stopRun', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () => '[]',
    });
    const prepared = await adapter.prepareRun({ lease: fakeLease(cwd), cwd });
    const handle = await adapter.startRun(prepared);
    await adapter.stopRun(handle);
    await assert.rejects(() => adapter.collectResult(handle));
  });

  it('surfaces LLM throws (e.g. budget exceeded) as errorReason', async () => {
    const cwd = await makeWorktree();
    const adapter = new CodexAdapter({
      workPacket: fakePacket(),
      _callLLM: async () => { throw new Error('budget_exceeded'); },
    });
    const result = await runAdapter(adapter, { lease: fakeLease(cwd), cwd });
    assert.equal(result.status, 'failed');
    assert.ok(result.errorReason!.includes('budget_exceeded'));
  });
});

// ── collectContextFiles ────────────────────────────────────────────────────

describe('CodexAdapter.collectContextFiles', () => {
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
    assert.ok(files[0]!.contents.includes('(truncated)'));
  });
});
