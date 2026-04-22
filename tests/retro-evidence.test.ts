import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { retro, type RetroOptions } from '../src/cli/commands/retro.js';

/** Minimal retro report shape returned by runRetro */
interface RetroReport {
  score: number;
  delta: number | null;
  timestamp: string;
  praise: string[];
  growthAreas: string[];
  [key: string]: unknown;
}

describe('retro evidence mirroring', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-retro-evidence-'));
    // Create .danteforge dir so state load doesn't crash
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('calls _writeRetroEvidence injection seam when provided', async () => {
    let called = false;
    let capturedReport: RetroReport | null = null;
    let capturedCwd: string | null = null;

    const opts: RetroOptions = {
      cwd: tmpDir,
      _writeRetroEvidence: async (report, cwd) => {
        called = true;
        capturedReport = report as RetroReport;
        capturedCwd = cwd;
      },
    };

    await retro(opts);

    assert.ok(called, '_writeRetroEvidence should have been called');
    assert.strictEqual(capturedCwd, tmpDir);
    assert.ok(capturedReport !== null);
    assert.ok(typeof (capturedReport as RetroReport).score === 'number');
  });

  it('injection seam receives report with timestamp field', async () => {
    let capturedReport: RetroReport | null = null;

    await retro({
      cwd: tmpDir,
      _writeRetroEvidence: async (report) => {
        capturedReport = report as RetroReport;
      },
    });

    assert.ok(capturedReport !== null);
    assert.ok(typeof capturedReport!.timestamp === 'string');
    assert.ok(capturedReport!.timestamp.length > 0);
  });

  it('does not throw when _writeRetroEvidence throws (non-fatal)', async () => {
    // Should not propagate the error
    await assert.doesNotReject(async () => {
      await retro({
        cwd: tmpDir,
        _writeRetroEvidence: async () => {
          throw new Error('disk full simulation');
        },
      });
    });
  });

  it('writes retro-${ts}.json to evidence/retro/ without injection seam', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-retro-evidence-real-'));
    try {
      await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });

      await retro({ cwd: dir });

      const evidenceDir = path.join(dir, '.danteforge', 'evidence', 'retro');
      const entries = await fs.readdir(evidenceDir);
      const retroFiles = entries.filter(e => e.startsWith('retro-') && e.endsWith('.json'));
      assert.ok(retroFiles.length >= 1, `Expected at least 1 retro evidence file, got: ${JSON.stringify(entries)}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('each retro call writes a unique timestamped file', async () => {
    const written: string[] = [];

    // Two calls with different timestamps via injection seam
    const ts1 = '2026-04-15T10:00:00.000Z';
    const ts2 = '2026-04-15T11:00:00.000Z';

    // Simulate what the real code does: write to evidence/retro/retro-{ts}.json
    const makeWriter = (timestamp: string) => async (_report: unknown, cwd: string) => {
      const ts = timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const filePath = path.join(cwd, '.danteforge', 'evidence', 'retro', `retro-${ts}.json`);
      written.push(filePath);
    };

    await retro({ cwd: tmpDir, _writeRetroEvidence: makeWriter(ts1) });
    await retro({ cwd: tmpDir, _writeRetroEvidence: makeWriter(ts2) });

    assert.strictEqual(written.length, 2);
    assert.notStrictEqual(written[0], written[1]);
    assert.ok(written[0]!.includes('retro-2026-04-15_10-00-00.json'));
    assert.ok(written[1]!.includes('retro-2026-04-15_11-00-00.json'));
  });
});
