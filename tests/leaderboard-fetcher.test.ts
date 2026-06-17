import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRows, rowRate, extractTopRate, fetchLeaderboardEntry, fetchLeaderboards,
  type LeaderboardSource,
} from '../src/core/leaderboard-fetcher.ts';
import { signalFromLeaderboardEntry } from '../src/core/harvest-loader.ts';
import { verifyHarvestedSignalSignature } from '../src/core/harvested-signal-signer.ts';
import { checkHarvestProvenance, seedLeaderTargetFromHarvest, type HarvestedSignal } from '../src/core/harvested-bar.ts';
import type { FrontierSpec } from '../src/core/frontier-spec.ts';

const liveSrc: LeaderboardSource = {
  dimId: 'code_generation', suite: 'swe-bench-live',
  url: 'https://example/reports.jsonl', format: 'jsonl',
  scoreField: 'resolved', scoreScale: 'count-over-total', totalField: 'total',
};
const mainSrc: LeaderboardSource = {
  dimId: 'code_generation', suite: 'swe-bench-lite',
  url: 'https://example/leaderboards.json', format: 'json', rowsPath: 'leaderboards.0.results',
  filter: undefined, scoreField: 'resolved', scoreScale: 'percent',
};

test('parseRows reads JSONL (skips blank lines)', () => {
  const rows = parseRows('{"a":1}\n\n{"a":2}', liveSrc);
  assert.equal(rows.length, 2);
});

test('parseRows reads JSON with a dotted rowsPath into a nested array', () => {
  const body = JSON.stringify({ leaderboards: [{ results: [{ resolved: 76.8 }, { resolved: 50 }] }] });
  const rows = parseRows(body, mainSrc);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.resolved, 76.8);
});

test('rowRate normalizes percent / fraction / count-over-total', () => {
  assert.equal(rowRate({ resolved: 76.8 }, mainSrc), 0.768);
  assert.equal(rowRate({ resolved: 97, total: 204 }, liveSrc), 97 / 204);
  assert.equal(rowRate({ resolved: 0.5 }, { ...liveSrc, scoreScale: 'fraction' }), 0.5);
  assert.equal(rowRate({ resolved: 5, total: 0 }, liveSrc), null); // no divide-by-zero
  assert.equal(rowRate({ resolved: 'x' }, mainSrc), null); // non-numeric
});

test('extractTopRate picks the frontier (max) row', () => {
  const rows = [{ total: 100, resolved: 40 }, { total: 204, resolved: 97 }, { total: 50, resolved: 10 }];
  assert.equal(extractTopRate(rows, liveSrc), 97 / 204);
});

test('extractTopRate applies the filter (e.g. one language set)', () => {
  const rows = [{ set: 'py', total: 100, resolved: 40 }, { set: 'tsjs', total: 204, resolved: 97 }];
  const pyOnly: LeaderboardSource = { ...liveSrc, filter: { field: 'set', equals: 'py' } };
  assert.equal(extractTopRate(rows, pyOnly), 0.4);
});

test('fetchLeaderboardEntry builds a SIGNED entry whose signature round-trips through the loader', async () => {
  const fetchText = async () => '{"name":"A","total":100,"resolved":40}\n{"name":"B","total":204,"resolved":97}';
  const got = await fetchLeaderboardEntry(liveSrc, fetchText, '2026-06-16T00:00:00Z');
  assert.ok(got);
  assert.equal(got!.dimId, 'code_generation');
  assert.equal(got!.topRate, 97 / 204);
  assert.equal(got!.entry.verified_live, true);
  assert.equal(typeof got!.entry.sig, 'string');
  // the loader reconstructs the SAME signal; its signature must verify (write→read→verify round-trip)
  assert.ok(verifyHarvestedSignalSignature(signalFromLeaderboardEntry(got!.entry)));
});

test('a fetched signed benchmark CLEARS the harvest gate under signature enforcement (end-to-end)', async () => {
  const fetchText = async () => '{"name":"B","total":204,"resolved":97}';
  const got = await fetchLeaderboardEntry(liveSrc, fetchText, '2026-06-16T00:00:00Z');
  const signal = signalFromLeaderboardEntry(got!.entry);
  const sp: FrontierSpec = {
    version: 1, target_score: 9.0, status: 'draft',
    leader_target: { competitor: 'frontier', score: 0, observed_capability: 'TODO', category_delta: 'TODO' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js solve', observable_artifacts: [{ kind: 'json', path: 'o.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'external-benchmark' },
  };
  seedLeaderTargetFromHarvest(sp, [signal]);
  const gate = checkHarvestProvenance(sp, [signal], { enabled: true, requireSigned: true });
  assert.ok(gate.ok, gate.errors.join('; '));
});

test('fetchLeaderboardEntry returns null when no usable number (no fabrication)', async () => {
  const fetchText = async () => '{"name":"A","resolved":"n/a"}';
  assert.equal(await fetchLeaderboardEntry(liveSrc, fetchText, '2026-06-16T00:00:00Z'), null);
});

test('fetchLeaderboards groups signed entries by dimension, skipping empty sources', async () => {
  const fetchText = async (url: string) =>
    url.endsWith('.jsonl') ? '{"total":204,"resolved":97}' : JSON.stringify({ leaderboards: [{ results: [{ resolved: 30 }] }] });
  const { byDim, fetched } = await fetchLeaderboards([liveSrc, mainSrc], fetchText, '2026-06-16T00:00:00Z');
  assert.equal(fetched.length, 2);
  assert.equal(byDim['code_generation']!.length, 2); // both suites land on the same dim
  assert.deepEqual(byDim['code_generation']!.map(e => e.suite).sort(), ['swe-bench-lite', 'swe-bench-live']);
});

// guard: parseRows on a body with a non-JSON line throws (documents that sources must be clean JSONL)
test('parseRows throws on a malformed JSONL line (caller fetches a clean source)', () => {
  assert.throws(() => parseRows('{"a":1}\nnot json', liveSrc));
});
