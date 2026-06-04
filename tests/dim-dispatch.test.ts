// dim-dispatch.test.ts — the router executes surgical routes (autoresearch→outcomes→promote) and
// hands off feature routes. Fully seamed: no real spawns, no real FS/LLM.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dimDispatch, type DispatchRunners } from '../src/cli/commands/dim-dispatch.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

function dim(id: string, scores: Record<string, number>, command?: string) {
  return {
    id, label: id, weight: 1, category: 'features', frequency: 'high', scores,
    status: 'in-progress', sprint_history: [], next_sprint_target: 9,
    gap_to_leader: 0, leader: '', gap_to_closed_source_leader: 0, closed_source_leader: '', gap_to_oss_leader: 0, oss_leader: '',
    ...(command ? { capability_test: { command } } : {}),
  };
}

function matrix(dims: unknown[]): CompeteMatrix {
  return { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0, dimensions: dims } as unknown as CompeteMatrix;
}

// LLM classifies 'surg' as surgical and 'feat' as feature_construction (by dim id in the prompt).
// Match the "Dimension: <id>" line, NOT the word "surgical" in the prompt's definitions.
const fakeLLM = async (prompt: string): Promise<string> =>
  prompt.includes('Dimension: surg') ? '{"category":"surgical","reason":"one-line fix"}' : '{"category":"feature_construction","reason":"needs a module"}';

function fakeRunners(log: string[], capPass: boolean): DispatchRunners {
  return {
    runAutoresearch: async (d) => { log.push(`autoresearch:${d.id}`); },
    runOutcomes: async (id) => { log.push(`outcomes:${id}`); },
    runCapabilityTest: async () => { log.push('captest'); return capPass; },
  };
}

describe('dimDispatch', () => {
  it('runs the surgical pipeline and PROMOTES the score when the capability_test passes', async () => {
    const log: string[] = [];
    let saved: CompeteMatrix | null = null;
    let call = 0;
    // call 1 = classify (derived unset); call 2 = reload after outcomes (derived=7).
    const load = async (): Promise<CompeteMatrix> => {
      call++;
      const surgScores = call >= 2 ? { self: 4, derived: 7 } : { self: 4 };
      return matrix([dim('surg', surgScores, 'node scripts/surg.mjs'), dim('done', { self: 8 })]);
    };
    await dimDispatch({
      _loadMatrix: load as never,
      _saveMatrix: async (m) => { saved = m; },
      _isLLMAvailable: async () => true,
      _callLLM: fakeLLM,
      _fileExists: async () => true,
      _readFile: async () => 'assert(x)',
      _writeFile: async () => {}, _mkdir: async () => {},
      _runners: fakeRunners(log, true),
    });
    assert.deepEqual(log, ['autoresearch:surg', 'outcomes:surg', 'captest'], 'surgical pipeline ran in order');
    assert.ok(saved, 'matrix saved after a promote');
    assert.equal(saved!.dimensions.find(d => d.id === 'surg')!.scores.self, 7, 'self promoted to derived');
  });

  it('does NOT promote (or save) when there is no fresh evidence and the capability_test fails', async () => {
    const log: string[] = [];
    let saved = false;
    // No derived score is ever produced (outcomes did not pass) and the capability_test fails → nothing to promote.
    const load = async (): Promise<CompeteMatrix> => matrix([dim('surg', { self: 4 }, 'node scripts/surg.mjs')]);
    await dimDispatch({
      _loadMatrix: load as never, _saveMatrix: async () => { saved = true; },
      _isLLMAvailable: async () => true, _callLLM: fakeLLM,
      _fileExists: async () => true, _readFile: async () => 'x',
      _writeFile: async () => {}, _mkdir: async () => {},
      _runners: fakeRunners(log, false), // capability_test FAILS
    });
    assert.ok(log.includes('captest'), 'the pipeline still ran');
    assert.equal(saved, false, 'no win → no score write');
  });

  it('queues a feature work-packet for feature_construction dims, without executing them', async () => {
    const load = async (): Promise<CompeteMatrix> => matrix([dim('feat', { self: 4 }, 'node scripts/feat.mjs')]);
    let captured: unknown;
    const writes: string[] = [];
    await dimDispatch({
      _loadMatrix: load as never, _saveMatrix: async () => {},
      _isLLMAvailable: async () => true, _callLLM: fakeLLM,
      _fileExists: async () => true, _readFile: async () => 'x',
      _writeFile: async (p) => { writes.push(p); }, _mkdir: async () => {},
      _runners: { runAutoresearch: async () => { captured = 'ran'; }, runOutcomes: async () => {}, runCapabilityTest: async () => true },
      json: true,
    });
    assert.equal(captured, undefined, 'feature dim was NOT executed via autoresearch');
    assert.ok(writes.some(p => p.includes('feature-queue') && p.includes('feat.json')), 'a feature work-packet was queued');
  });

  it('5→7 bridge: a promoted dim with a DIRTY harden gate is re-routed to feature work', async () => {
    const writes: string[] = [];
    let call = 0;
    // promote 4 → 6 (derived 6 on reload), landing in the [5,7) bridge band.
    const load = async (): Promise<CompeteMatrix> => { call++; return matrix([dim('surg', call >= 2 ? { self: 4, derived: 6 } : { self: 4 }, 'node scripts/surg.mjs')]); };
    await dimDispatch({
      _loadMatrix: load as never, _saveMatrix: async () => {},
      _isLLMAvailable: async () => true, _callLLM: fakeLLM,
      _fileExists: async () => true, _readFile: async () => 'x',
      _writeFile: async (p) => { writes.push(p); }, _mkdir: async () => {},
      _runners: { runAutoresearch: async () => {}, runOutcomes: async () => {}, runCapabilityTest: async () => true,
        runHardenCheck: async () => ({ clean: false, failedChecks: ['orphan-audit'] }) },
    });
    assert.ok(writes.some(p => p.includes('feature-queue') && p.includes('surg.json')), 'dirty harden → re-routed to the feature queue');
  });

  it('depth-guard: a dim already at ≥7 is delegated to ascend-frontier, never autoresearched', async () => {
    let autoresearched = false;
    // 'surg' classifies surgical but is already at 7.5 → must be delegated, not run.
    const load = async (): Promise<CompeteMatrix> => matrix([dim('surg', { self: 7.5 }, 'node scripts/surg.mjs')]);
    await dimDispatch({
      target: 9, // include the [7,9) band
      _loadMatrix: load as never, _saveMatrix: async () => {},
      _isLLMAvailable: async () => true, _callLLM: fakeLLM,
      _fileExists: async () => true, _readFile: async () => 'x',
      _writeFile: async () => {}, _mkdir: async () => {},
      _runners: { runAutoresearch: async () => { autoresearched = true; }, runOutcomes: async () => {}, runCapabilityTest: async () => true, runHardenCheck: async () => ({ clean: true, failedChecks: [] }) },
      json: true,
    });
    assert.equal(autoresearched, false, 'dim-dispatch does NOT run its surgical loop on a ≥7 dim');
  });

  it('--dry-run classifies and plans without running anything', async () => {
    const log: string[] = [];
    const load = async (): Promise<CompeteMatrix> => matrix([dim('surg', { self: 4 }, 'node scripts/surg.mjs')]);
    await dimDispatch({
      dryRun: true,
      _loadMatrix: load as never, _saveMatrix: async () => {},
      _isLLMAvailable: async () => true, _callLLM: fakeLLM,
      _fileExists: async () => true, _readFile: async () => 'x',
      _writeFile: async () => {}, _mkdir: async () => {},
      _runners: fakeRunners(log, true),
    });
    assert.deepEqual(log, [], 'no runners invoked in dry-run');
  });
});
