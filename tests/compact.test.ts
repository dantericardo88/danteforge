// compact command tests — audit log compaction logic
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compact } from '../src/cli/commands/compact.js';
import { loadState, saveState } from '../src/core/state.js';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function makeTmpProjectDir(auditLog: string[] = []): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-compact-test-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  const yaml = [
    `project: compact-test`,
    `workflowStage: initialized`,
    `currentPhase: 0`,
    `profile: balanced`,
    `lastHandoff: none`,
    `auditLog:`,
    ...auditLog.map(e => `  - '${e.replace(/'/g, "''")}'`),
    `tasks: {}`,
    `gateResults: {}`,
    `autoforgeFailedAttempts: 0`,
  ].join('\n');
  await fs.writeFile(path.join(dir, '.danteforge', 'STATE.yaml'), yaml, 'utf8');
  return dir;
}

describe('compact — no-op when audit log is small', () => {
  it('does nothing when auditLog.length <= 20', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => `2026-01-0${(i % 9) + 1} | command: step ${i}`);
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    assert.strictEqual(state.auditLog.length, 10, 'should not compact when under threshold');
    assert.ok(!state.auditLog[0]?.startsWith('[COMPACTED]'), 'should not add COMPACTED prefix');
  });

  it('does nothing when auditLog.length === 20 exactly', async () => {
    const entries = Array.from({ length: 20 }, (_, i) => `2026-01-01 | command: step ${i}`);
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    assert.strictEqual(state.auditLog.length, 20);
  });

  it('does nothing for empty audit log', async () => {
    const cwd = await makeTmpProjectDir([]);

    await assert.doesNotReject(() => compact(cwd));

    const state = await loadState({ cwd });
    assert.strictEqual(state.auditLog.length, 0);
  });
});

describe('compact — compacts when audit log exceeds threshold', () => {
  it('reduces 25 entries to 6 (1 summary + 20 recent)', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => `2026-01-01 | command: step ${i}`);
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    // 5 old entries → 1 compacted + 20 recent = 21 total
    assert.strictEqual(state.auditLog.length, 21, 'should be 1 summary + 20 recent');
    assert.ok(state.auditLog[0]!.startsWith('[COMPACTED]'), 'first entry should be the compacted summary');
  });

  it('summary line contains [COMPACTED] prefix and entry count', async () => {
    const entries = Array.from({ length: 22 }, (_, i) => `2026-01-01 | command: step ${i}`);
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    const summary = state.auditLog[0]!;
    assert.ok(summary.startsWith('[COMPACTED]'), 'should start with [COMPACTED]');
    assert.ok(summary.includes('2 entries'), 'should mention 2 compacted entries (22 - 20 = 2)');
  });

  it('preserves exactly the last 20 entries verbatim', async () => {
    const entries = Array.from({ length: 25 }, (_, i) => `entry-${i}`);
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    // entries 5..24 should be preserved (the last 20)
    const expected = entries.slice(5);
    assert.deepStrictEqual(state.auditLog.slice(1), expected);
  });

  it('groups old entries by type in the summary', async () => {
    const entries = [
      ...Array.from({ length: 3 }, (_, i) => `2026-01-01 | command: do ${i}`),
      ...Array.from({ length: 20 }, (_, i) => `2026-01-02 | recent: entry ${i}`),
    ];
    const cwd = await makeTmpProjectDir(entries);

    await compact(cwd);

    const state = await loadState({ cwd });
    const summary = state.auditLog[0]!;
    assert.ok(summary.includes('command(3)'), `summary should include command count, got: ${summary}`);
  });
});
