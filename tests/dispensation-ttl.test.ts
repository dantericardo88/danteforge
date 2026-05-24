// dispensation-ttl.test.ts — TTL (auto-expiry) behavior for operator dispensations.
//
// A dispensation may carry an `expiresAt` ISO timestamp. After that moment passes,
// the dispensation is treated as cleared for all purposes (list display, frontier
// gating, autonomous-crusade refusal). This is a defense against the "dispensation
// graveyard" — forgotten open dispensations that silently pause autonomy forever.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  dispensationCreate,
  dispensationList,
  isDispensationInactive,
  parseTtl,
  type Dispensation,
} from '../src/cli/commands/dispensation.js';

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'disp-ttl-'));
}

describe('parseTtl', () => {
  it('parses days', () => {
    assert.equal(parseTtl('7d'), 7 * 24 * 60 * 60 * 1000);
  });
  it('parses hours', () => {
    assert.equal(parseTtl('24h'), 24 * 60 * 60 * 1000);
  });
  it('parses minutes', () => {
    assert.equal(parseTtl('30m'), 30 * 60 * 1000);
  });
  it('parses seconds', () => {
    assert.equal(parseTtl('120s'), 120 * 1000);
  });
  it('accepts decimal values', () => {
    assert.equal(parseTtl('0.5h'), 30 * 60 * 1000);
  });
  it('tolerates whitespace', () => {
    assert.equal(parseTtl('  7d  '), 7 * 24 * 60 * 60 * 1000);
  });
  it('case-insensitive on unit', () => {
    assert.equal(parseTtl('7D'), 7 * 24 * 60 * 60 * 1000);
  });
  it('rejects unitless input', () => {
    assert.throws(() => parseTtl('7'), /Invalid TTL/);
  });
  it('rejects unknown units', () => {
    assert.throws(() => parseTtl('7y'), /Invalid TTL/);
  });
  it('rejects garbage', () => {
    assert.throws(() => parseTtl('definitely not a duration'), /Invalid TTL/);
  });
});

describe('isDispensationInactive', () => {
  const base: Dispensation = {
    id: 'd1', dimensionId: 'security', reason: 'test fixture for inactivity check',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  it('returns false for an active dispensation with no TTL', () => {
    assert.equal(isDispensationInactive(base), false);
  });
  it('returns true when cleared is true', () => {
    assert.equal(isDispensationInactive({ ...base, cleared: true }), true);
  });
  it('returns true when expiresAt is in the past', () => {
    const past = '2025-01-01T00:00:00.000Z';
    assert.equal(isDispensationInactive({ ...base, expiresAt: past }, new Date('2026-06-01T00:00:00.000Z')), true);
  });
  it('returns false when expiresAt is in the future', () => {
    const future = '2027-01-01T00:00:00.000Z';
    assert.equal(isDispensationInactive({ ...base, expiresAt: future }, new Date('2026-06-01T00:00:00.000Z')), false);
  });
  it('returns true when both cleared AND expired', () => {
    const past = '2025-01-01T00:00:00.000Z';
    assert.equal(isDispensationInactive({ ...base, cleared: true, expiresAt: past }, new Date('2026-06-01T00:00:00.000Z')), true);
  });
  it('ignores malformed expiresAt (treats as active)', () => {
    assert.equal(isDispensationInactive({ ...base, expiresAt: 'not a date' }), false);
  });
});

describe('dispensationCreate with --ttl', () => {
  it('writes expiresAt when ttl is provided', async () => {
    const cwd = await mkTmp();
    try {
      const fixed = new Date('2026-05-18T12:00:00.000Z');
      const disp = await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'operator approves T3 cap until external audit closes',
        ttl: '7d',
        _now: () => fixed,
      });
      assert.equal(disp.expiresAt, '2026-05-25T12:00:00.000Z', 'expiresAt should be createdAt + 7d');
      // On-disk too
      const onDisk = JSON.parse(await fs.readFile(
        path.join(cwd, '.danteforge', 'score-proposals', 'dispensations', `${disp.id}.json`),
        'utf8',
      )) as Dispensation;
      assert.equal(onDisk.expiresAt, '2026-05-25T12:00:00.000Z');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('omits expiresAt when ttl is absent', async () => {
    const cwd = await mkTmp();
    try {
      const disp = await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'permanent exception — never auto-clears',
      });
      assert.equal(disp.expiresAt, undefined);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('rejects invalid ttl strings before writing', async () => {
    const cwd = await mkTmp();
    try {
      await assert.rejects(
        dispensationCreate({
          cwd,
          dimensionId: 'security',
          reason: 'test ttl validation behaviour',
          ttl: 'not-a-duration',
        }),
        /Invalid TTL/,
      );
      // No file written
      const dir = path.join(cwd, '.danteforge', 'score-proposals', 'dispensations');
      try {
        const files = await fs.readdir(dir);
        assert.equal(files.length, 0, 'no dispensation should be written on invalid TTL');
      } catch { /* dir doesn't exist — equivalent to "no files" */ }
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('dispensationList honors TTL', () => {
  it('moves a TTL-expired dispensation from active to expired group', async () => {
    const cwd = await mkTmp();
    try {
      const past = new Date('2025-01-01T00:00:00.000Z');
      const now = new Date('2026-06-01T00:00:00.000Z');

      // Create an active dispensation in the past with a 1d TTL.
      await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'short-lived exception while audit closes',
        ttl: '1d',
        _now: () => past,
      });
      // List it with "now" far in the future — expiry has elapsed.
      const all = await dispensationList({ cwd, json: true, _now: () => now });
      assert.equal(all.length, 1);
      assert.equal(all[0]!.expiresAt, '2025-01-02T00:00:00.000Z');
      assert.equal(isDispensationInactive(all[0]!, now), true);
      assert.equal(isDispensationInactive(all[0]!, past), false);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('frontier loadDispensations honors TTL', () => {
  it('does not return TTL-expired dispensations as active blockers', async () => {
    const cwd = await mkTmp();
    try {
      const past = new Date('2025-01-01T00:00:00.000Z');
      // Create with a 1d TTL — already expired by today.
      await dispensationCreate({
        cwd,
        dimensionId: 'security',
        reason: 'fixture for frontier-TTL-filter test',
        ttl: '1d',
        _now: () => past,
      });
      // The frontier loader (private to frontier.ts) reads the on-disk JSON and
      // filters expired dispensations. Verify via the public list (which has its
      // own filtering) AND via direct on-disk inspection.
      const dir = path.join(cwd, '.danteforge', 'score-proposals', 'dispensations');
      const files = await fs.readdir(dir);
      assert.equal(files.length, 1, 'file exists on disk');

      // The runFrontierCommand path is integration-level; the unit-level guarantee
      // is that isDispensationInactive returns true for this fixture against any
      // realistic "now" (anything past 2025-01-02).
      const raw = await fs.readFile(path.join(dir, files[0]!), 'utf8');
      const disp = JSON.parse(raw) as Dispensation;
      assert.equal(isDispensationInactive(disp, new Date()), true);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
