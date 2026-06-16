import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHarvestedSignals } from '../src/core/harvest-loader.ts';

function tempCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'harvest-loader-'));
  mkdirSync(join(dir, '.danteforge', 'compete'), { recursive: true });
  return dir;
}

test('loadHarvestedSignals returns [] when no artifacts exist (no fabrication)', async () => {
  const dir = tempCwd();
  try {
    assert.deepEqual(await loadHarvestedSignals(dir, 'code_generation'), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadHarvestedSignals reads intel demand signals for the dimension', async () => {
  const dir = tempCwd();
  try {
    const report = {
      generatedAt: '2026-06-16T00:00:00Z', opportunities: [],
      signals: [
        { tool: 'Aider', source: 'github-issues', title: 'auto-retry', snippet: 'iterate', url: 'https://gh/1', demandScore: 40, category: 'code_generation', foundAt: '2026-06-16T00:00:00Z' },
        { tool: 'Aider', source: 'reddit', title: 'noise', snippet: '', url: 'https://r/2', demandScore: 1, category: 'code_generation', foundAt: '2026-06-16T00:00:00Z' },
        { tool: 'X', source: 'hackernews', title: 'other dim', snippet: '', url: 'https://hn/3', demandScore: 99, category: 'security', foundAt: '2026-06-16T00:00:00Z' },
      ],
    };
    writeFileSync(join(dir, '.danteforge', 'compete', 'weakness-intelligence.json'), JSON.stringify(report), 'utf8');
    const sigs = await loadHarvestedSignals(dir, 'code_generation'); // default minDemand 5 drops the noise row
    assert.equal(sigs.length, 1);
    assert.equal(sigs[0]!.kind, 'demand');
    assert.match(sigs[0]!.claim, /auto-retry/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadHarvestedSignals reads benchmark anchors from leaderboards.json (skips malformed rows)', async () => {
  const dir = tempCwd();
  try {
    const board = {
      code_generation: [
        { suite: 'swe-bench-lite', numeric: 0.65, source_url: 'https://swebench.com', fetched_at: '2026-06-16T00:00:00Z', verified_live: true },
        { numeric: 0.9 }, // malformed (no suite) → skipped
      ],
      security: [{ suite: 'other', numeric: 0.5 }],
    };
    writeFileSync(join(dir, '.danteforge', 'compete', 'leaderboards.json'), JSON.stringify(board), 'utf8');
    const sigs = await loadHarvestedSignals(dir, 'code_generation');
    const bench = sigs.filter(s => s.kind === 'benchmark');
    assert.equal(bench.length, 1);
    assert.equal(bench[0]!.suite, 'swe-bench-lite');
    assert.equal(bench[0]!.numeric, 0.65);
    assert.equal(bench[0]!.verified_live, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('loadHarvestedSignals fuses intel + benchmark for the same dimension', async () => {
  const dir = tempCwd();
  try {
    writeFileSync(join(dir, '.danteforge', 'compete', 'weakness-intelligence.json'), JSON.stringify({
      generatedAt: 'x', opportunities: [],
      signals: [{ tool: 'A', source: 'github-issues', title: 't', snippet: 's', url: 'u', demandScore: 20, category: 'code_generation', foundAt: 'x' }],
    }), 'utf8');
    writeFileSync(join(dir, '.danteforge', 'compete', 'leaderboards.json'), JSON.stringify({
      code_generation: [{ suite: 'humaneval', numeric: 0.85, source_url: 'https://he', fetched_at: 'x', verified_live: false }],
    }), 'utf8');
    const sigs = await loadHarvestedSignals(dir, 'code_generation');
    assert.equal(sigs.filter(s => s.kind === 'demand').length, 1);
    assert.equal(sigs.filter(s => s.kind === 'benchmark').length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
