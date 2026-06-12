// Pins for outcome-author v1 (self-challenge #6): the productized scout recipe — stable
// metachar-free patterns from dual runs, product-run guards, honest refusals.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { authorProductOutcome, selectStablePatterns } from '../src/matrix/engines/outcome-author.js';

describe('outcome-author — the proven scout recipe as a product primitive', () => {
  test('selectStablePatterns: stable + metachar-free + volatile-free only (the regex-seam pin)', () => {
    const runA = [
      'DanteForge Lessons — Self-Improving Knowledge Base', // stable, clean → selected
      '97 lesson(s) recorded',                              // metachars () → excluded (the live trap)
      'Generated 2026-06-12T03:14:11.000Z',                 // ISO timestamp → excluded
      'took 1432 ms',                                       // duration → excluded
      'Rule: prefer seams over mocks',                      // stable, clean → selected
      'unstable line A',                                    // not in run B → excluded
    ].join('\n');
    const runB = [
      'DanteForge Lessons — Self-Improving Knowledge Base',
      '97 lesson(s) recorded',
      'Generated 2026-06-12T03:15:02.000Z',
      'took 1391 ms',
      'Rule: prefer seams over mocks',
      'unstable line B',
    ].join('\n');
    const patterns = selectStablePatterns(runA, runB);
    assert.deepEqual(patterns, ['DanteForge Lessons — Self-Improving Knowledge Base', 'Rule: prefer seams over mocks']);
  });

  test('authors a cli-smoke declaration from a dist command with verified-stable output', async () => {
    const stdout = 'Honest Banner Line For The Receipt\nSecond Stable Marker Line\n';
    const r = await authorProductOutcome({
      cwd: 'X:/tmp', dimId: 'demo_dim',
      command: 'node dist/index.js lessons --view',
      callsite: 'src/cli/commands/lessons.ts',
      _run: async () => ({ exitCode: 0, stdoutText: stdout, ms: 1500 }),
    });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.outcome!['kind'], 'cli-smoke');
    assert.deepEqual(r.outcome!['cli_args'], ['lessons', '--view']);
    assert.equal((r.outcome!['expected_stdout_patterns'] as string[]).length, 2);
    assert.equal(r.wrote, false, 'dry-run by default');
  });

  test('honest refusals: test runners, help screens, test-file callsites, flaky exits, weak patterns', async () => {
    const base = { cwd: 'X:/tmp', dimId: 'd', callsite: 'src/x.ts' };
    assert.equal((await authorProductOutcome({ ...base, command: 'npx tsx --test tests/x.test.ts' })).ok, false);
    assert.equal((await authorProductOutcome({ ...base, command: 'node dist/index.js lessons --help' })).ok, false);
    assert.equal((await authorProductOutcome({ ...base, command: 'node dist/index.js lessons', callsite: 'tests/x.test.ts' })).ok, false);
    let n = 0;
    const flaky = await authorProductOutcome({ ...base, command: 'node dist/index.js lessons',
      _run: async () => ({ exitCode: n++ === 0 ? 0 : 1, stdoutText: 'Stable Banner Line Here\nAnother Stable Line\n', ms: 100 }) });
    assert.equal(flaky.ok, false);
    assert.match(flaky.reason, /differ across consecutive runs/);
    const weak = await authorProductOutcome({ ...base, command: 'node dist/index.js lessons',
      _run: async () => ({ exitCode: 0, stdoutText: 'ok 12 ms\n2026-06-12T00:00:00Z\n', ms: 100 }) });
    assert.equal(weak.ok, false);
    assert.match(weak.reason, /stable, runner-safe/);
  });
});
