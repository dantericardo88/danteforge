// Phase 8 — Mailbox tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendMessage, getPending, ackMessage, writeMailboxIndex } from '../../src/matrix/engines/mailbox.js';

const tmpDirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-mailbox-'));
  tmpDirs.push(d);
  return d;
}
after(async () => { for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {}); });

describe('Mailbox', () => {
  it('appends a message and retrieves it via getPending', async () => {
    const cwd = await tmp();
    const msg = await appendMessage({
      cwd,
      type: 'interface_changed',
      fromLease: 'lease.a',
      toLease: 'lease.b',
      summary: 'API renamed',
      requiresAck: true,
    });
    assert.ok(msg.messageId);
    assert.equal(msg.status, 'pending_ack');
    const pending = await getPending(cwd, 'lease.b');
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.summary, 'API renamed');
  });

  it('filters by recipient', async () => {
    const cwd = await tmp();
    await appendMessage({ cwd, type: 'merge_ready', fromLease: 'a', toLease: 'b', summary: '1' });
    await appendMessage({ cwd, type: 'merge_ready', fromLease: 'a', toLease: 'c', summary: '2' });
    const forC = await getPending(cwd, 'c');
    assert.equal(forC.length, 1);
    assert.equal(forC[0]!.summary, '2');
  });

  it('ackMessage transitions status to acked', async () => {
    const cwd = await tmp();
    const msg = await appendMessage({ cwd, type: 'merge_ready', fromLease: 'a', toLease: 'b', summary: 's' });
    const acked = await ackMessage(cwd, msg.messageId);
    assert.equal(acked!.status, 'acked');
    assert.ok(acked!.ackedAt);
    const pending = await getPending(cwd, 'b');
    assert.equal(pending.length, 0, 'acked messages should not be pending');
  });

  it('broadcast recipient is delivered to anyone', async () => {
    const cwd = await tmp();
    await appendMessage({ cwd, type: 'human_decision_required', fromLease: 'system', toLease: 'broadcast', summary: 'attention all' });
    const forX = await getPending(cwd, 'lease.x');
    assert.equal(forX.length, 1);
  });

  it('writeMailboxIndex aggregates all messages to canonical path', async () => {
    const cwd = await tmp();
    await appendMessage({ cwd, type: 'merge_ready', fromLease: 'a', toLease: 'b', summary: '1' });
    const outPath = await writeMailboxIndex(cwd);
    assert.ok(outPath.endsWith('matrix.mailbox.json'));
    const raw = await fs.readFile(outPath, 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.messages.length, 1);
  });
});
