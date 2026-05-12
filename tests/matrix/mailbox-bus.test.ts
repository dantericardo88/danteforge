// Mailbox bus tests — post/poll/list CLI handlers + atomic-write race coverage.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mailboxPost, mailboxPoll, mailboxList } from '../../src/cli/commands/matrix-mailbox.js';
import { saveGraph, appendToCollection } from '../../src/matrix/engines/matrix-state.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

async function tmpProject(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-mailbox-'));
  tmpDirs.push(d);
  return d;
}

describe('mailbox post', () => {
  it('writes a message and updates the aggregated index', async () => {
    const cwd = await tmpProject();
    const msg = await mailboxPost({
      cwd,
      from: 'lease.a',
      to: 'broadcast',
      type: 'merge_ready',
      summary: 'A finished.',
    });
    assert.equal(msg.fromLease, 'lease.a');
    assert.equal(msg.toLease, 'broadcast');
    assert.equal(msg.type, 'merge_ready');

    const indexPath = path.join(cwd, '.danteforge', 'matrix', 'matrix.mailbox.json');
    const indexJson = JSON.parse(await fs.readFile(indexPath, 'utf8'));
    assert.equal(indexJson.messages.length, 1);
    assert.equal(indexJson.messages[0].messageId, msg.messageId);
  });

  it('rejects invalid message types', async () => {
    const cwd = await tmpProject();
    await assert.rejects(
      () => mailboxPost({ cwd, from: 'lease.a', to: 'broadcast', type: 'totally_made_up', summary: 'x' }),
      /Invalid --type/,
    );
  });

  it('rejects invalid impact values', async () => {
    const cwd = await tmpProject();
    await assert.rejects(
      () => mailboxPost({ cwd, from: 'lease.a', to: 'broadcast', type: 'merge_ready', summary: 'x', impact: 'extremely-blocking' }),
      /Invalid --impact/,
    );
  });
});

describe('mailbox poll', () => {
  it('returns pending messages immediately when they already exist', async () => {
    const cwd = await tmpProject();
    await mailboxPost({ cwd, from: 'lease.a', to: 'lease.b', type: 'dependency_notice', summary: 'b needs to wait' });
    const result = await mailboxPoll({ cwd, lease: 'lease.b', timeoutMs: 1_000 });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.fromLease, 'lease.a');
  });

  it('respects type filter', async () => {
    const cwd = await tmpProject();
    await mailboxPost({ cwd, from: 'a', to: 'broadcast', type: 'merge_ready', summary: 'm' });
    await mailboxPost({ cwd, from: 'a', to: 'broadcast', type: 'conflict_detected', summary: 'c' });
    const result = await mailboxPoll({ cwd, timeoutMs: 500, types: 'conflict_detected' });
    assert.equal(result.length, 1);
    assert.equal(result[0]!.type, 'conflict_detected');
  });

  it('returns empty list after timeout when nothing pending', async () => {
    const cwd = await tmpProject();
    const start = Date.now();
    const result = await mailboxPoll({
      cwd,
      timeoutMs: 200,
      _sleep: () => new Promise(r => setTimeout(r, 5)),
    });
    assert.equal(result.length, 0);
    assert.ok(Date.now() - start >= 150, 'should wait close to the timeout');
  });
});

describe('mailbox list', () => {
  it('returns all messages sorted by createdAt, with status filter applied', async () => {
    const cwd = await tmpProject();
    await mailboxPost({ cwd, from: 'a', to: 'broadcast', type: 'merge_ready', summary: 'old' });
    await new Promise(r => setTimeout(r, 5));
    await mailboxPost({ cwd, from: 'b', to: 'broadcast', type: 'conflict_detected', summary: 'new' });
    const all = await mailboxList({ cwd });
    assert.equal(all.length, 2);
    assert.equal(all[0]!.fromLease, 'a');
    assert.equal(all[1]!.fromLease, 'b');

    const pending = await mailboxList({ cwd, status: 'pending_ack' });
    assert.equal(pending.length, 2);

    const acked = await mailboxList({ cwd, status: 'acked' });
    assert.equal(acked.length, 0);
  });
});

describe('matrix-state atomic locks', () => {
  it('concurrent appendToCollection writes do not lose entries', async () => {
    const cwd = await tmpProject();
    // Seed the collection.
    await saveGraph(cwd, 'agentRuns', { generatedAt: new Date().toISOString(), runs: [] });

    // Fan out 10 concurrent appenders. Without the lock, the inner read-
    // modify-write would race and most appends would be lost. With the
    // lock, all 10 land.
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      appendToCollection(cwd, 'agentRuns', 'runs', { leaseId: `lease.${i}`, status: 'completed' }),
    ));

    const raw = await fs.readFile(path.join(cwd, '.danteforge', 'matrix', 'matrix.agent-runs.json'), 'utf8');
    const json = JSON.parse(raw);
    assert.equal(json.runs.length, 10, `expected 10 runs, found ${json.runs.length}`);
    const ids = new Set<string>(json.runs.map((r: { leaseId: string }) => r.leaseId));
    assert.equal(ids.size, 10, 'each appender should land a unique leaseId');
  });
});
