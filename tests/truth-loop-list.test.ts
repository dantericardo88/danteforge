import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { truthLoopList } from '../src/cli/commands/truth-loop-list.js';

let workspace: string;
let originalStdoutWrite: typeof process.stdout.write;
let captured = '';

before(() => {
  workspace = mkdtempSync(resolve(tmpdir(), 'truth-loop-list-'));
  mkdirSync(resolve(workspace, '.danteforge', 'truth-loop'), { recursive: true });
});

function captureStdout(fn: () => Promise<void>): Promise<string> {
  captured = '';
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    return true;
  }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = originalStdoutWrite; }).then(() => captured);
}

test('truth-loop list: empty dir → JSON shows 0 runs', async () => {
  const out = await captureStdout(() => truthLoopList({ repo: workspace, json: true }).then(() => undefined));
  const parsed = JSON.parse(out);
  assert.equal(parsed.count, 0);
  assert.equal(parsed.runs.length, 0);
});

test('truth-loop list: missing dir → exit 0 + JSON includes reason', async () => {
  const empty = mkdtempSync(resolve(tmpdir(), 'tl-list-empty-'));
  // No .danteforge/truth-loop/ created
  const out = await captureStdout(() => truthLoopList({ repo: empty, json: true }).then(() => undefined));
  const parsed = JSON.parse(out);
  assert.match(parsed.reason ?? '', /does not exist/);
});

test('truth-loop list: 3 runs sorted newest first', async () => {
  // Create 3 fake runs with verdict.json files
  const runs = ['run_20260428_001', 'run_20260428_002', 'run_20260428_003'];
  for (const r of runs) {
    const dir = resolve(workspace, '.danteforge/truth-loop', r, 'verdict');
    mkdirSync(dir, { recursive: true });
    mkdirSync(resolve(workspace, '.danteforge/truth-loop', r, 'next_action'), { recursive: true });
    writeFileSync(resolve(workspace, '.danteforge/truth-loop', r, 'run.json'), JSON.stringify({
      runId: r,
      startedAt: '2026-04-28T20:00:00Z',
      objective: `pilot ${r}`
    }));
    writeFileSync(resolve(dir, 'verdict.json'), JSON.stringify({
      finalStatus: 'complete',
      score: 8.5
    }));
    writeFileSync(resolve(workspace, '.danteforge/truth-loop', r, 'report.md'), '# Report');
  }

  const out = await captureStdout(() => truthLoopList({ repo: workspace, json: true }).then(() => undefined));
  const parsed = JSON.parse(out);
  assert.equal(parsed.count, 3);
  // Newest first
  assert.equal(parsed.runs[0]!.runId, 'run_20260428_003');
  assert.equal(parsed.runs[1]!.runId, 'run_20260428_002');
  assert.equal(parsed.runs[2]!.runId, 'run_20260428_001');
  // Each run has populated fields
  for (const r of parsed.runs) {
    assert.equal(r.finalStatus, 'complete');
    assert.equal(r.score, 8.5);
    assert.equal(r.hasReport, true);
    assert.equal(r.hasVerdict, true);
  }
});

test('truth-loop list: --limit trims to N most recent', async () => {
  const out = await captureStdout(() => truthLoopList({ repo: workspace, json: true, limit: '2' }).then(() => undefined));
  const parsed = JSON.parse(out);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.totalCount, 3);
  assert.equal(parsed.runs[0]!.runId, 'run_20260428_003');
  assert.equal(parsed.runs[1]!.runId, 'run_20260428_002');
});
