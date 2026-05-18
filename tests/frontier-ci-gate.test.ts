// frontier-ci-gate.test.ts — exit-code behavior of `danteforge frontier --require <state>`.
//
// The `--require` flag turns the frontier command into a CI gate: exit 0 iff the
// actual terminal state matches what the operator asserted; otherwise exit 1.
// Without --require, default behavior preserves the older contract (exit 0 only
// on frontier-reached).

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { runFrontierCommand } from '../src/cli/commands/frontier.js';
import { saveMatrix, type CompeteMatrix } from '../src/core/compete-matrix.js';

function makeProgressingMatrix(): CompeteMatrix {
  // No outcomes declared on any dim → frontier-state will report 'no-outcomes-declared'
  // for every dim, terminal state will be 'progressing'.
  return {
    project: 'ci-gate-test',
    competitors: ['cursor'],
    competitors_closed_source: ['cursor'],
    competitors_oss: [],
    lastUpdated: '2026-05-18T00:00:00.000Z',
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'security', label: 'Security', weight: 1.0, category: 'quality',
        frequency: 'high', scores: { self: 5.0, cursor: 8.0 },
        gap_to_leader: 3.0, leader: 'cursor',
        gap_to_closed_source_leader: 3.0, closed_source_leader: 'cursor',
        gap_to_oss_leader: 0, oss_leader: 'unknown',
        status: 'not-started', sprint_history: [], next_sprint_target: 7.0,
      },
    ],
  };
}

describe('frontier --require CI gate', () => {
  // Reset process.exitCode between tests since runFrontierCommand mutates it.
  afterEach(() => { process.exitCode = 0; });

  it('exits 0 when actual state matches required state (progressing)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-gate-'));
    try {
      const matrix = makeProgressingMatrix();
      await saveMatrix(matrix, cwd);
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (() => true) as never;
      try {
        await runFrontierCommand({
          cwd, json: true, requireState: 'progressing',
        });
      } finally {
        process.stdout.write = origWrite;
      }
      assert.equal(process.exitCode, 0, 'required=progressing && actual=progressing → exit 0');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('exits 1 when actual state does not match required state', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-gate-'));
    try {
      const matrix = makeProgressingMatrix();
      await saveMatrix(matrix, cwd);
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (() => true) as never;
      try {
        await runFrontierCommand({
          cwd, json: true, requireState: 'frontier-reached',
        });
      } finally {
        process.stdout.write = origWrite;
      }
      assert.equal(process.exitCode, 1, 'required=frontier-reached && actual=progressing → exit 1');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('without --require, exits 0 only on frontier-reached (legacy contract)', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'frontier-gate-'));
    try {
      const matrix = makeProgressingMatrix();
      await saveMatrix(matrix, cwd);
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = (() => true) as never;
      try {
        await runFrontierCommand({ cwd, json: true });
      } finally {
        process.stdout.write = origWrite;
      }
      assert.equal(process.exitCode, 1, 'no --require && actual=progressing → exit 1 (legacy)');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
