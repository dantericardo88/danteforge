// CH-026 regression: session-record's --write must route through saveMatrix, so it can
// never bypass the score-surface gates (interrupt sentinel, market-cap clamp, provenance,
// lock). Before the fix the default writer was a raw fs.writeFile that ignored all of them.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { runSessionRecord, MIN_REAL_RUN_MS } from '../src/cli/commands/session-record.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function makeMatrix(): CompeteMatrix {
  return {
    project: 'test',
    competitors: [],
    dimensions: [{ id: 'forge', label: 'Forge', scores: { self: 0, derived: 0 }, outcomes: [] }],
  } as unknown as CompeteMatrix;
}

async function scratch(): Promise<string> {
  const dir = path.join(os.tmpdir(), `session-record-gates-${process.pid}-${randomUUID().slice(0, 8)}`);
  await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
  return dir;
}

const genuineRun = {
  run: 'node dist/index.js forge --project fixtures/sample',
  callsite: 'src/core/forge-engine.ts',
  artifact: 'fixtures/sample/out.md',
  _runCommand: async () => ({ exitCode: 0, durationMs: MIN_REAL_RUN_MS + 500, stdout: 'ok' }),
  _artifactProduced: async () => true,
};

const matrixFile = (dir: string) => path.join(dir, '.danteforge', 'compete', 'matrix.json');

describe('session-record — CH-026 routes the real write through saveMatrix', () => {
  test('default --write persists the outcome via saveMatrix (no _writeMatrix seam)', async () => {
    const dir = await scratch();
    try {
      const r = await runSessionRecord({
        cwd: dir, dimId: 'forge', ...genuineRun, write: true,
        _loadMatrix: async () => makeMatrix(),
        // no _writeMatrix -> exercises the real saveMatrix default path
      });
      assert.equal(r.accepted, true);
      assert.equal(r.wrote, true);
      const raw = JSON.parse(await fs.readFile(matrixFile(dir), 'utf8')) as
        { dimensions: Array<{ outcomes: Array<{ input_source?: { type?: string } }> }> };
      const outcomes = raw.dimensions[0]!.outcomes;
      assert.equal(outcomes.length, 1, 'the real outcome was written through saveMatrix');
      assert.equal(outcomes[0]!.input_source?.type, 'real-user-path');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('default --write is REFUSED when a score-interrupt sentinel is present (gate fires)', async () => {
    const dir = await scratch();
    await fs.writeFile(path.join(dir, '.danteforge', 'INTERRUPT'), 'paused for test', 'utf8');
    const prevAllow = process.env['DANTEFORGE_ALLOW_SCORE_WRITE'];
    delete process.env['DANTEFORGE_ALLOW_SCORE_WRITE'];
    try {
      const r = await runSessionRecord({
        cwd: dir, dimId: 'forge', ...genuineRun, write: true,
        _loadMatrix: async () => makeMatrix(),
      });
      assert.equal(r.accepted, false, 'a raw fs.writeFile would have ignored the interrupt; saveMatrix must refuse');
      assert.match(r.reason, /REFUSED/i);
      let exists = true;
      try { await fs.access(matrixFile(dir)); } catch { exists = false; }
      assert.equal(exists, false, 'the refused write left no matrix.json behind');
    } finally {
      if (prevAllow !== undefined) process.env['DANTEFORGE_ALLOW_SCORE_WRITE'] = prevAllow;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
