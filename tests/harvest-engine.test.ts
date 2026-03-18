import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  generateTrackId,
  computeTrackHash,
  writeTrackFiles,
  loadTrackCount,
  shouldTriggerMetaEvolution,
  createEmptyTrack,
  type HarvestTrack,
} from '../src/core/harvest-engine.js';

// ─── generateTrackId ──────────────────────────────────────────────────────────

describe('generateTrackId', () => {
  it('includes the system slug in the ID', () => {
    const id = generateTrackId('My System');
    assert.match(id, /my-system/);
  });

  it('follows the format TH-{slug}-{YYYYMMDD}-{hex}', () => {
    const id = generateTrackId('Auth Engine');
    assert.match(id, /^TH-auth-engine-\d{8}-[0-9a-f]{6}$/);
  });

  it('slugifies special characters', () => {
    const id = generateTrackId('API  v2.0 (prod)');
    assert.match(id, /^TH-api-v2-0-prod-\d{8}-[0-9a-f]{6}$/);
  });

  it('generates unique IDs for repeated calls with the same system', () => {
    const id1 = generateTrackId('SameSystem');
    const id2 = generateTrackId('SameSystem');
    // The random suffix makes them different
    assert.notStrictEqual(id1, id2);
  });

  it('truncates very long system names to a reasonable slug length', () => {
    const longName = 'A'.repeat(200);
    const id = generateTrackId(longName);
    // slug portion is capped at 32 chars
    const parts = id.split('-');
    // Join slug parts (everything between TH- and the 8-digit date)
    const slugEnd = id.lastIndexOf('-', id.lastIndexOf('-') - 1);
    const slug = id.slice(3, slugEnd);
    assert.ok(slug.length <= 32, `Slug too long: ${slug.length}`);
  });
});

// ─── computeTrackHash ────────────────────────────────────────────────────────

describe('computeTrackHash', () => {
  function makeMinimalTrack(system = 'TestSystem'): HarvestTrack {
    return createEmptyTrack(system, 'full');
  }

  it('returns a 64-character hex string (SHA-256)', () => {
    const track = makeMinimalTrack();
    const hash = computeTrackHash(track);
    assert.strictEqual(typeof hash, 'string');
    assert.strictEqual(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('is deterministic for the same track contents', () => {
    const track = makeMinimalTrack();
    // Override trackId to make it stable (generateTrackId has a random suffix)
    track.trackId = 'TH-test-system-20260318-abcdef';
    track.summary.trackId = track.trackId;

    const hash1 = computeTrackHash(track);
    const hash2 = computeTrackHash(track);
    assert.strictEqual(hash1, hash2);
  });

  it('excludes the existing hash field from the computation', () => {
    const track = makeMinimalTrack();
    track.trackId = 'TH-test-20260318-aabbcc';
    track.summary.trackId = track.trackId;

    const hash1 = computeTrackHash(track);
    // Set a different hash value — the computation should remain the same
    track.step5Ratification.hash = 'some-previous-hash-value';
    const hash2 = computeTrackHash(track);
    assert.strictEqual(hash1, hash2);
  });

  it('produces different hashes for tracks with different content', () => {
    const track1 = makeMinimalTrack('SystemA');
    track1.trackId = 'TH-systema-20260318-aabbcc';
    track1.summary.trackId = track1.trackId;

    const track2 = makeMinimalTrack('SystemB');
    track2.trackId = 'TH-systemb-20260318-ddeeff';
    track2.summary.trackId = track2.trackId;

    assert.notStrictEqual(computeTrackHash(track1), computeTrackHash(track2));
  });
});

// ─── shouldTriggerMetaEvolution ───────────────────────────────────────────────

describe('shouldTriggerMetaEvolution', () => {
  it('returns true at multiples of 5 (positive)', () => {
    assert.strictEqual(shouldTriggerMetaEvolution(5), true);
    assert.strictEqual(shouldTriggerMetaEvolution(10), true);
    assert.strictEqual(shouldTriggerMetaEvolution(15), true);
    assert.strictEqual(shouldTriggerMetaEvolution(100), true);
  });

  it('returns false at non-multiples of 5', () => {
    assert.strictEqual(shouldTriggerMetaEvolution(1), false);
    assert.strictEqual(shouldTriggerMetaEvolution(3), false);
    assert.strictEqual(shouldTriggerMetaEvolution(7), false);
    assert.strictEqual(shouldTriggerMetaEvolution(11), false);
    assert.strictEqual(shouldTriggerMetaEvolution(99), false);
  });

  it('returns false at 0', () => {
    assert.strictEqual(shouldTriggerMetaEvolution(0), false);
  });
});

// ─── createEmptyTrack ─────────────────────────────────────────────────────────

describe('createEmptyTrack', () => {
  it('initializes all required fields for full mode', () => {
    const track = createEmptyTrack('My Machine', 'full');

    assert.strictEqual(track.system, 'My Machine');
    assert.strictEqual(track.mode, 'full');
    assert.ok(typeof track.trackId === 'string' && track.trackId.length > 0);

    // Step 1
    assert.strictEqual(track.step1Discovery.objective, '');
    assert.ok(Array.isArray(track.step1Discovery.donors));
    assert.ok(Array.isArray(track.step1Discovery.superpowerClusters));
    assert.ok(Array.isArray(track.step1Discovery.organs));

    // Step 2
    assert.ok(typeof track.step2Constitution.organBehaviors === 'object');
    assert.ok(Array.isArray(track.step2Constitution.globalMandates));
    assert.ok(Array.isArray(track.step2Constitution.globalProhibitions));

    // Step 3
    assert.ok(Array.isArray(track.step3Wiring.signals));
    assert.strictEqual(typeof track.step3Wiring.wiringMap, 'string');
    assert.strictEqual(typeof track.step3Wiring.dependencyGraph, 'string');
    assert.ok(typeof track.step3Wiring.spineCompliance === 'object');

    // Step 4 (present in full mode)
    assert.ok(track.step4Evidence !== undefined);
    assert.ok(Array.isArray(track.step4Evidence!.evidenceRules));
    assert.ok(Array.isArray(track.step4Evidence!.testCharters));
    assert.ok(Array.isArray(track.step4Evidence!.goldenFlows));

    // Step 5
    assert.ok(Array.isArray(track.step5Ratification.metacodeCatalog.patterns));
    assert.ok(Array.isArray(track.step5Ratification.metacodeCatalog.antiPatterns));
    assert.ok(typeof track.step5Ratification.gateSheet === 'object');
    assert.strictEqual(typeof track.step5Ratification.expansionReadiness, 'number');
    assert.strictEqual(typeof track.step5Ratification.reflection, 'string');
    assert.strictEqual(typeof track.step5Ratification.hash, 'string');

    // Summary
    assert.strictEqual(track.summary.trackId, track.trackId);
    assert.ok(Array.isArray(track.summary.organs));
    assert.ok(Array.isArray(track.summary.goldenFlows));
    assert.strictEqual(typeof track.summary.expansionReadiness, 'number');
  });

  it('does not include step4Evidence in sep-lite mode', () => {
    const track = createEmptyTrack('Lite Machine', 'sep-lite');
    assert.strictEqual(track.mode, 'sep-lite');
    assert.strictEqual(track.step4Evidence, undefined);
  });

  it('assigns a trackId that starts with TH-', () => {
    const track = createEmptyTrack('Some System', 'full');
    assert.ok(track.trackId.startsWith('TH-'));
  });

  it('summary.trackId matches trackId', () => {
    const track = createEmptyTrack('Sync Check', 'full');
    assert.strictEqual(track.summary.trackId, track.trackId);
  });
});

// ─── writeTrackFiles ─────────────────────────────────────────────────────────

describe('writeTrackFiles', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-harvest-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates track.json and summary.json in .danteforge/harvest/{trackId}/', async () => {
    const track = createEmptyTrack('WriteTest', 'full');
    track.trackId = 'TH-writetest-20260318-ff1122';
    track.summary.trackId = track.trackId;

    const { trackPath, summaryPath } = await writeTrackFiles(track, tmpDir);

    assert.ok(trackPath.includes('TH-writetest-20260318-ff1122'));
    assert.ok(trackPath.endsWith('track.json'));
    assert.ok(summaryPath.endsWith('summary.json'));

    // Files must exist and be parseable JSON
    const trackContent = JSON.parse(await fs.readFile(trackPath, 'utf8')) as HarvestTrack;
    const summaryContent = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as HarvestTrack['summary'];

    assert.strictEqual(trackContent.trackId, 'TH-writetest-20260318-ff1122');
    assert.strictEqual(summaryContent.trackId, 'TH-writetest-20260318-ff1122');
  });

  it('track.json contains all top-level HarvestTrack fields', async () => {
    const track = createEmptyTrack('FieldTest', 'sep-lite');
    track.trackId = 'TH-fieldtest-20260318-aa9900';
    track.summary.trackId = track.trackId;
    track.step1Discovery.objective = 'Test objective for field validation';

    const { trackPath } = await writeTrackFiles(track, tmpDir);
    const loaded = JSON.parse(await fs.readFile(trackPath, 'utf8')) as HarvestTrack;

    assert.strictEqual(loaded.system, 'FieldTest');
    assert.strictEqual(loaded.mode, 'sep-lite');
    assert.strictEqual(loaded.step1Discovery.objective, 'Test objective for field validation');
    assert.strictEqual(loaded.step4Evidence, undefined);
  });

  it('summary.json matches the track.summary object', async () => {
    const track = createEmptyTrack('SummaryTest', 'full');
    track.trackId = 'TH-summarytest-20260318-bb8811';
    track.summary = {
      trackId: track.trackId,
      organs: ['Organ-A', 'Organ-B'],
      goldenFlows: ['FlowX'],
      expansionReadiness: 9,
    };

    const { summaryPath } = await writeTrackFiles(track, tmpDir);
    const loadedSummary = JSON.parse(await fs.readFile(summaryPath, 'utf8')) as HarvestTrack['summary'];

    assert.deepStrictEqual(loadedSummary, track.summary);
  });

  it('creates the harvest directory hierarchy if it does not exist', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-harvest-fresh-'));
    try {
      const track = createEmptyTrack('FreshDir', 'full');
      track.trackId = 'TH-freshdir-20260318-cc7722';
      track.summary.trackId = track.trackId;

      await writeTrackFiles(track, freshDir);

      const harvestDir = path.join(freshDir, '.danteforge', 'harvest', 'TH-freshdir-20260318-cc7722');
      const stat = await fs.stat(harvestDir);
      assert.ok(stat.isDirectory());
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });
});

// ─── loadTrackCount ───────────────────────────────────────────────────────────

describe('loadTrackCount', () => {
  it('returns 0 when the harvest directory does not exist', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-count-'));
    try {
      const count = await loadTrackCount(freshDir);
      assert.strictEqual(count, 0);
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('returns the correct count after writing multiple tracks', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-count-multi-'));
    try {
      for (let i = 0; i < 3; i++) {
        const track = createEmptyTrack(`System${i}`, 'full');
        track.trackId = `TH-system${i}-20260318-cc${i}${i}${i}${i}${i}${i}`;
        track.summary.trackId = track.trackId;
        await writeTrackFiles(track, dir);
      }

      const count = await loadTrackCount(dir);
      assert.strictEqual(count, 3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
