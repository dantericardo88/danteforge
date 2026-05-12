// Phase 14 — Tests for per-role agent memory (harvested from CrewAI)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadMemory,
  saveMemory,
  appendMemoryEntry,
  buildMemoryPromptBlock,
} from '../../src/matrix/engines/agent-memory.js';

const tmpDirs: string[] = [];
async function makeTmpDir(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-memory-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

describe('loadMemory', () => {
  it('returns an empty file when no memory exists yet', async () => {
    const cwd = await makeTmpDir();
    const mem = await loadMemory('red-team', cwd);
    assert.equal(mem.roleId, 'red-team');
    assert.equal(mem.entries.length, 0);
    assert.equal(mem.maxEntries, 50);
  });

  it('reads entries from a previously-saved memory file', async () => {
    const cwd = await makeTmpDir();
    await saveMemory({
      roleId: 'red-team',
      entries: [{ ts: '2026-05-12T00:00:00Z', runId: 'run.x', note: 'caught a stub once', tag: 'lesson' }],
      maxEntries: 50,
    }, cwd);
    const mem = await loadMemory('red-team', cwd);
    assert.equal(mem.entries.length, 1);
    assert.equal(mem.entries[0]?.note, 'caught a stub once');
  });
});

describe('saveMemory', () => {
  it('trims entries to maxEntries (newest kept)', async () => {
    const cwd = await makeTmpDir();
    const entries = Array.from({ length: 12 }, (_, i) => ({
      ts: `2026-05-12T00:00:${String(i).padStart(2, '0')}Z`,
      runId: `run.${i}`, note: `note ${i}`,
    }));
    await saveMemory({ roleId: 'red-team', entries, maxEntries: 5 }, cwd);
    const reloaded = await loadMemory('red-team', cwd);
    assert.equal(reloaded.entries.length, 5);
    assert.equal(reloaded.entries[0]?.note, 'note 7');
    assert.equal(reloaded.entries[4]?.note, 'note 11');
  });

  it('writes to the canonical .danteforge/matrix/agent-memory/ path', async () => {
    const cwd = await makeTmpDir();
    const outPath = await saveMemory({ roleId: 'red-team', entries: [], maxEntries: 10 }, cwd);
    assert.ok(outPath.replace(/\\/g, '/').includes('.danteforge/matrix/agent-memory/red-team.json'));
  });
});

describe('appendMemoryEntry', () => {
  it('writes when the role has persistentMemory=true (red-team)', async () => {
    const cwd = await makeTmpDir();
    await appendMemoryEntry('red-team', {
      ts: '2026-05-12T00:00:00Z', runId: 'run.x', note: 'first entry',
    }, cwd);
    const reloaded = await loadMemory('red-team', cwd);
    assert.equal(reloaded.entries.length, 1);
  });

  it('silently skips when the role is stateless (dimension-engineer)', async () => {
    const cwd = await makeTmpDir();
    await appendMemoryEntry('dimension-engineer', {
      ts: '2026-05-12T00:00:00Z', runId: 'run.x', note: 'should not persist',
    }, cwd);
    const reloaded = await loadMemory('dimension-engineer', cwd);
    assert.equal(reloaded.entries.length, 0);
  });
});

describe('buildMemoryPromptBlock', () => {
  it('returns empty string when role has no entries', async () => {
    const cwd = await makeTmpDir();
    const block = await buildMemoryPromptBlock('red-team', cwd);
    assert.equal(block, '');
  });

  it('emits formatted bullets for recent entries', async () => {
    const cwd = await makeTmpDir();
    await saveMemory({
      roleId: 'red-team',
      entries: [
        { ts: '2026-05-12T00:00:00Z', runId: 'r1', note: 'always check for fake completion', tag: 'lesson' },
        { ts: '2026-05-12T00:01:00Z', runId: 'r2', note: 'beware comment-only deletions', tag: 'caution' },
      ],
      maxEntries: 50,
    }, cwd);
    const block = await buildMemoryPromptBlock('red-team', cwd);
    assert.ok(block.includes('Prior Memory'));
    assert.ok(block.includes('fake completion'));
    assert.ok(block.includes('comment-only deletions'));
  });

  it('returns empty string for a role with persistentMemory=false', async () => {
    const cwd = await makeTmpDir();
    const block = await buildMemoryPromptBlock('dimension-engineer', cwd);
    assert.equal(block, '');
  });
});
