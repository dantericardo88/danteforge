import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeLoopResult, type LoopResult } from '../src/core/autoforge-loop.js';

function makeLoopResult(overrides: Partial<LoopResult> = {}): LoopResult {
  return {
    startScore: 60,
    endScore: 75,
    delta: 15,
    cycles: 3,
    duration: 12000,
    terminationReason: 'target-reached',
    timestamp: '2026-04-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('writeLoopResult — evidence/autoforge directory', () => {
  it('creates evidence/autoforge/ directory on first call', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-autoforge-evidence-'));
    try {
      const written: string[] = [];
      const fakeFsWrite = async (p: string, _d: string) => {
        written.push(p);
        await fs.mkdir(path.dirname(p), { recursive: true });
        await fs.writeFile(p, _d, 'utf8');
      };

      await writeLoopResult(makeLoopResult(), dir, fakeFsWrite);

      const evidenceDir = path.join(dir, '.danteforge', 'evidence', 'autoforge');
      const stat = await fs.stat(evidenceDir);
      assert.ok(stat.isDirectory(), 'evidence/autoforge should be a directory');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('writes loop-${ts}.json with result data', async () => {
    const written: Record<string, string> = {};
    const fakeFsWrite = async (p: string, d: string) => { written[p] = d; };

    const result = makeLoopResult({ timestamp: '2026-04-15T10:30:00.000Z' });
    await writeLoopResult(result, '/fake/cwd', fakeFsWrite);

    const tsKey = Object.keys(written).find(k => k.includes('loop-2026-04-15_10-30-00.json'));
    assert.ok(tsKey !== undefined, `Timestamped loop file not found in: ${JSON.stringify(Object.keys(written))}`);

    const parsed = JSON.parse(written[tsKey!]!);
    assert.strictEqual(parsed.terminationReason, 'target-reached');
    assert.strictEqual(parsed.cycles, 3);
    assert.strictEqual(parsed.delta, 15);
  });

  it('evidence write failure is non-fatal (does not propagate)', async () => {
    let callCount = 0;
    const fakeFsWrite = async (p: string, _d: string) => {
      callCount++;
      if (p.includes('evidence')) throw new Error('disk full simulation');
      // main loop-result.json write succeeds, evidence fails
    };

    // Should not throw
    await assert.doesNotReject(async () => {
      await writeLoopResult(makeLoopResult(), '/fake/cwd', fakeFsWrite);
    });
    // The main write was still attempted
    assert.ok(callCount >= 1);
  });

  it('successive calls write distinct timestamped files', async () => {
    const written: string[] = [];
    const fakeFsWrite = async (p: string, _d: string) => { written.push(p); };

    await writeLoopResult(makeLoopResult({ timestamp: '2026-04-15T10:00:00.000Z' }), '/cwd', fakeFsWrite);
    await writeLoopResult(makeLoopResult({ timestamp: '2026-04-15T11:00:00.000Z' }), '/cwd', fakeFsWrite);

    const evidenceFiles = written.filter(p => p.includes('evidence') && p.includes('autoforge'));
    assert.strictEqual(evidenceFiles.length, 2, `Expected 2 evidence files, got: ${JSON.stringify(evidenceFiles)}`);
    assert.notStrictEqual(evidenceFiles[0], evidenceFiles[1]);
  });
});
