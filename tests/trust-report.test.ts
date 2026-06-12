// Pin: trust-report renders scores NEXT TO their replayable receipts, read-only, from a synthetic
// repo — the externally-verifiable answer to "honest numbers read lower than self-graded ones".
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runTrustReport } from '../src/cli/commands/trust-report.js';

const ROOT = path.join('X:\\tmp', `trust-report-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

describe('trust-report — the score and its receipts, side by side', () => {
  test('renders receipt commands, court status, ceilings, and market caps from on-disk truth', async () => {
    const dir = path.join(ROOT, 'repo');
    await fs.mkdir(path.join(dir, '.danteforge', 'compete'), { recursive: true });
    await fs.mkdir(path.join(dir, '.danteforge', 'outcome-evidence'), { recursive: true });
    await fs.mkdir(path.join(dir, '.danteforge', 'ceilings'), { recursive: true });

    await fs.writeFile(path.join(dir, '.danteforge', 'compete', 'matrix.json'), JSON.stringify({
      project: 'trust-pin', competitors: [], competitors_closed_source: [], competitors_oss: [],
      lastUpdated: new Date().toISOString(), overallSelfScore: 6,
      dimensions: [
        { id: 'proven_dim', label: 'p', weight: 1, scores: { self: 8 }, gap_to_leader: 1, leader: 'c', status: 'in-progress', sprint_history: [],
          outcomes: [{ id: 'p_t5', tier: 'T5', kind: 'runtime-exec', command: 'node dist/index.js real-product-run --flag', required_callsite: 'src/x.ts' }] },
        { id: 'token_economy', label: 't', weight: 1, scores: { self: 4 }, gap_to_leader: 5, leader: 'c', status: 'in-progress', sprint_history: [] },
        { id: 'walled_dim', label: 'w', weight: 1, scores: { self: 7 }, gap_to_leader: 2, leader: 'c', status: 'in-progress', sprint_history: [] },
      ],
    }), 'utf8');
    await fs.writeFile(path.join(dir, '.danteforge', 'outcome-evidence', 'nogit-proven_dim-p_t5.json'), JSON.stringify({
      dimensionId: 'proven_dim', outcomeId: 'p_t5', tier: 'T5', gitSha: null, passed: true, exitCode: 0,
      durationMs: 1500, ranAt: new Date().toISOString(), session_id: 'pin-session-1',
    }), 'utf8');
    await fs.writeFile(path.join(dir, '.danteforge', 'ceilings', 'walled_dim.json'), JSON.stringify({
      dimId: 'walled_dim', cap: 7, cause: 'spec-incomplete', detail: 'author the real-user-path (pin)',
      failedGates: ['spec-incomplete'], recordedAt: new Date().toISOString(),
    }), 'utf8');

    const r = await runTrustReport({ cwd: dir });
    assert.equal(r.dims, 3);
    assert.equal(r.receiptsShown, 1);

    const md = await fs.readFile(r.outputPath, 'utf8');
    assert.match(md, /node dist\/index\.js real-product-run --flag/, 'the replayable command is IN the report');
    assert.match(md, /pin-session-1/, 'session provenance shown');
    assert.match(md, /spec-incomplete.*author the real-user-path \(pin\)/s, 'ceilings quoted verbatim');
    assert.match(md, /market-cap/i, 'market-capped dims labeled as done-at-cap');
    assert.match(md, /LOWER than self-declared/, 'the honesty framing is the headline, not a footnote');
    assert.match(md, /How to verify any number here/, 'replay instructions present');
  });
});
