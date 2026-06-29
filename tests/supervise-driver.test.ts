import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeEngineRun, engineArgs } from '../src/cli/commands/supervise.js';
import { buildKeepalivePlan, keepaliveArgs } from '../src/core/supervisor-keepalive.js';
import { writeEscalation } from '../src/core/supervisor-notify.js';

describe('summarizeEngineRun — pure exit→summary mapper', () => {
  test('clean exit with a frontier marker → targetReached', () => {
    const { summary, targetReached } = summarizeEngineRun(0, 'building...\nFRONTIER_REACHED for security\n');
    assert.equal(targetReached, true);
    assert.equal(summary.ceilingHit, false);
    assert.equal(summary.status, 'stopped');
  });

  test('a ceiling marker → ceilingHit (status stopped)', () => {
    const { summary, targetReached } = summarizeEngineRun(0, 'dim stalled: generator-ceiling minted\n');
    assert.equal(summary.ceilingHit, true);
    assert.equal(targetReached, false);
  });

  test('non-zero exit carries the output tail into finalReason (so the classifier sees outages)', () => {
    const { summary } = summarizeEngineRun(1, 'ERROR: You have hit your usage limit, try again at 8:45 PM');
    assert.equal(summary.status, 'paused');
    assert.match(summary.finalReason, /usage limit/);
  });

  test('plain clean run → stopped, no ceiling, no target', () => {
    const { summary, targetReached } = summarizeEngineRun(0, 'wave 1 complete');
    assert.equal(summary.status, 'stopped');
    assert.equal(summary.ceilingHit, false);
    assert.equal(targetReached, false);
  });
});

describe('engineArgs — engine → CLI argv', () => {
  test('maps each engine', () => {
    assert.deepEqual(engineArgs('autoforge', 8), ['autoforge', '--auto', '--target', '8']);
    assert.deepEqual(engineArgs('crusade', 9), ['crusade', '--target', '9']);
    assert.deepEqual(engineArgs('frontier', 8.5), ['ascend', '--frontier', '--target', '8.5']);
  });
});

describe('buildKeepalivePlan — host-sleep survival artifacts (pure)', () => {
  const opts = { cwd: '/proj', goal: 'ship it', target: 8, engine: 'autoforge', posture: 'tiered' as const, nodePath: '/usr/bin/node', entryPath: '/bin/df.js' };

  test('windows → Task Scheduler XML + schtasks register', () => {
    const p = buildKeepalivePlan('win32', opts);
    assert.equal(p.filename, 'danteforge-supervisor.xml');
    assert.match(p.content, /<Task /);
    assert.match(p.content, /MultipleInstancesPolicy>IgnoreNew/);
    assert.match(p.registerCmd, /schtasks \/Create/);
  });

  test('macOS → launchd plist + launchctl', () => {
    const p = buildKeepalivePlan('darwin', opts);
    assert.match(p.content, /com\.danteforge\.supervisor/);
    assert.match(p.registerCmd, /launchctl load/);
  });

  test('linux → systemd units + systemctl', () => {
    const p = buildKeepalivePlan('linux', opts);
    assert.match(p.content, /OnUnitActiveSec/);
    assert.match(p.registerCmd, /systemctl --user/);
  });

  test('keepaliveArgs includes the goal when present', () => {
    assert.ok(keepaliveArgs(opts).includes('--goal'));
    assert.ok(!keepaliveArgs({ ...opts, goal: '' }).includes('--goal'));
  });
});

describe('writeEscalation — durable operator queue', () => {
  test('appends a dated, leveled entry via injected sink', async () => {
    let written = '';
    await writeEscalation('/proj', 'escalate', 'capability ceiling: generator-ceiling',
      async (_p, d) => { written += d; }, '2026-06-29T00:00:00.000Z');
    assert.match(written, /ESCALATE/);
    assert.match(written, /generator-ceiling/);
    assert.match(written, /2026-06-29/);
  });
});
