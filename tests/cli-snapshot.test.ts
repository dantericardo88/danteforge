import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cliSnapshot, listSnapshots } from '../src/cli/commands/cli-snapshot.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFs() {
  const store = new Map<string, string>();
  return {
    _readFile: async (p: string) => {
      const val = store.get(p);
      if (!val) throw new Error(`ENOENT: ${p}`);
      return val;
    },
    _writeFile: async (p: string, data: string) => { store.set(p, data); },
    _exists: async (p: string) => store.has(p),
    store,
  };
}

function makeRunner(output: string) {
  return async () => output;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cliSnapshot', () => {
  it('creates snapshot on first run', async () => {
    const fs = makeFs();
    const lines: string[] = [];
    const result = await cliSnapshot({
      name: 'test-snap',
      command: 'echo hello',
      cwd: '/fake',
      _run: makeRunner('hello'),
      ...fs,
      _stdout: (l) => lines.push(l),
    });
    assert.equal(result.status, 'created');
    assert.equal(result.exitCode, 0);
    assert.ok(result.snapshotPath.includes('test-snap'));
    assert.ok(fs.store.size > 0);
  });

  it('matches identical output', async () => {
    const fs = makeFs();
    const lines: string[] = [];
    // First: create
    await cliSnapshot({ name: 'match-snap', command: 'cmd', cwd: '/fake', _run: makeRunner('same output'), ...fs, _stdout: () => {} });
    // Second: compare
    const result = await cliSnapshot({ name: 'match-snap', command: 'cmd', cwd: '/fake', _run: makeRunner('same output'), ...fs, _stdout: (l) => lines.push(l) });
    assert.equal(result.status, 'matched');
    assert.equal(result.exitCode, 0);
    assert.ok(lines.some(l => l.includes('✓')));
  });

  it('detects changed output', async () => {
    const fs = makeFs();
    const lines: string[] = [];
    await cliSnapshot({ name: 'change-snap', command: 'cmd', cwd: '/fake', _run: makeRunner('old output'), ...fs, _stdout: () => {} });
    const result = await cliSnapshot({ name: 'change-snap', command: 'cmd', cwd: '/fake', _run: makeRunner('new output'), ...fs, _stdout: (l) => lines.push(l) });
    assert.equal(result.status, 'changed');
    assert.equal(result.exitCode, 1);
    assert.ok(result.diff);
    assert.ok(lines.some(l => l.includes('✗')));
  });

  it('updates snapshot when --update is set', async () => {
    const fs = makeFs();
    await cliSnapshot({ name: 'update-snap', command: 'cmd', cwd: '/fake', _run: makeRunner('v1'), ...fs, _stdout: () => {} });
    const result = await cliSnapshot({ name: 'update-snap', command: 'cmd', update: true, cwd: '/fake', _run: makeRunner('v2'), ...fs, _stdout: () => {} });
    assert.equal(result.status, 'updated');
    assert.equal(result.exitCode, 0);
    // Snapshot should now contain 'v2'
    const saved = fs.store.get(result.snapshotPath);
    assert.ok(saved?.includes('v2'));
  });

  it('strips ANSI codes by default', async () => {
    const fs = makeFs();
    const ansiOutput = '\x1b[32mgreen text\x1b[0m normal';
    const result = await cliSnapshot({ name: 'ansi-snap', command: 'cmd', cwd: '/fake', _run: makeRunner(ansiOutput), ...fs, _stdout: () => {} });
    assert.equal(result.status, 'created');
    const saved = fs.store.get(result.snapshotPath) ?? '';
    assert.ok(!saved.includes('\x1b'), 'ANSI codes should be stripped');
    assert.ok(saved.includes('green text'), 'Text content should be preserved');
  });
});

describe('listSnapshots', () => {
  it('returns empty list when no snapshots exist', async () => {
    const result = await listSnapshots({ cwd: '/fake', _readdir: async () => { throw new Error('ENOENT'); } });
    assert.deepEqual(result.snapshots, []);
  });

  it('returns snapshot names without .txt extension', async () => {
    const result = await listSnapshots({
      cwd: '/fake',
      _readdir: async () => ['score.txt', 'health.txt', 'other.json'],
    });
    assert.deepEqual(result.snapshots, ['score', 'health']);
  });
});
