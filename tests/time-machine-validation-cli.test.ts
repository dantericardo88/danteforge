import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { timeMachine } from '../src/cli/commands/time-machine.js';

describe('time-machine validate CLI command', () => {
  let workspace: string;

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'df-tm-validation-cli-'));
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('emits JSON for A/B/C PRD-scale validation', async () => {
    const lines: string[] = [];
    await timeMachine({
      action: 'validate',
      cwd: workspace,
      classes: 'A,B,C',
      scale: 'prd',
      json: true,
      out: resolve(workspace, 'out'),
      _stdout: line => lines.push(line),
      _now: () => '2026-04-29T10:00:00.000Z',
    });

    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.schemaVersion, 'danteforge.time-machine.validation.v1');
    assert.equal(parsed.classes.A.commitCount, 1000);
    assert.equal(parsed.classes.C.commitCount, 100);
  });

  it('keeps DELEGATE-52 live replication opt-in', async () => {
    const lines: string[] = [];
    await timeMachine({
      action: 'validate',
      cwd: workspace,
      classes: 'D',
      delegate52Mode: 'harness',
      maxDomains: 2,
      json: true,
      out: resolve(workspace, 'out'),
      _stdout: line => lines.push(line),
      _now: () => '2026-04-29T10:00:00.000Z',
    });

    const parsed = JSON.parse(lines.join('\n'));
    assert.equal(parsed.classes.D.status, 'harness_ready_not_live_validated');
    assert.match(parsed.summary.claimsNotAllowed.join('\n'), /DELEGATE-52/i);
  });
});
