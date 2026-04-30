import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { runTimeMachineValidation } from '../src/core/time-machine-validation.js';

describe('time-machine validation options', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'df-tm-validation-options-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('honors commitCountOverride for fresh-chain false-positive measurements', async () => {
    const report = await runTimeMachineValidation({
      cwd: workspace,
      classes: ['A'],
      scale: 'smoke',
      outDir: resolve(workspace, 'validation-out'),
      runId: 'tmval_override_001',
      commitCountOverride: 7,
      now: () => '2026-04-29T10:00:00.000Z',
    });

    assert.equal(report.classes.A?.commitCount, 7);
    assert.equal(report.classes.A?.adversarialDetections.length, 7);
    assert.ok(report.classes.A?.adversarialDetections.every(item => item.detected));
  });
});
