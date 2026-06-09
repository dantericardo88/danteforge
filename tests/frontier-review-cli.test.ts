import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runFrontierReviewCli } from '../src/cli/commands/frontier-review.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';
import type { FrontierSpec } from '../src/core/frontier-spec.js';
import { computeSpecHash } from '../src/core/frontier-spec.js';
import type { CouncilMemberId } from '../src/matrix/engines/council-scheduler.js';
import { makeEvidenceKey, type OutcomeEvidence, type OutcomeEvidenceEntry } from '../src/matrix/types/outcome.js';

const DIM = 'repo_level_context';

/** Evidence backing the 3 declared real-user-path outcomes. `sessions` maps outcomeId → session_id;
 *  vary it to exercise the deterministic pre-court receipt gate (≥3 passing T5+ across ≥2 sessions). */
function evidence(sessions: Record<string, string>, passed: Record<string, boolean> = {}): OutcomeEvidence {
  const m: OutcomeEvidence = new Map();
  for (const [oid, session] of Object.entries(sessions)) {
    const e: OutcomeEvidenceEntry = {
      dimensionId: DIM, outcomeId: oid, tier: 'T7', gitSha: 'sha', passed: passed[oid] ?? true,
      exitCode: 0, durationMs: 1500, stdoutTail: '', stderrTail: '', ranAt: '2026-06-03T00:00:00.000Z',
      evidencePath: `/x/${oid}.json`, session_id: session, evidenceQuality: 'EXTRACTED', confidenceScore: 1.0,
    };
    m.set(makeEvidenceKey(DIM, oid), e);
  }
  return m;
}

/** 3 passing T7 receipts across 2 distinct sessions — satisfies the gate. */
const goodEvidence = (): OutcomeEvidence => evidence({ o1: 'sess-A', o2: 'sess-A', o3: 'sess-B' });

function frozenSpec(): FrontierSpec {
  const s: FrontierSpec = {
    version: 1, target_score: 9.0, status: 'frozen',
    leader_target: { competitor: 'Cursor', score: 9.5, observed_capability: 'repo map' },
    real_user_path: { required_callsite: 'src/x.ts', run_command: 'node dist/index.js context inspect', observable_artifacts: [{ kind: 'json', path: 'out/x.json' }] },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
  s.frozen_hash = computeSpecHash(s);
  return s;
}

function matrix(spec: FrontierSpec): CompeteMatrix {
  return { dimensions: [{ id: DIM, label: 'Repo Context', frontier_spec: spec,
    outcomes: [
      { id: 'o1', tier: 'T7', input_source: { type: 'real-user-path', description: 'x' } },
      { id: 'o2', tier: 'T7', input_source: { type: 'real-user-path', description: 'y' } },
      { id: 'o3', tier: 'T7', input_source: { type: 'real-user-path', description: 'z' } },
    ] }] } as unknown as CompeteMatrix;
}

const MEMBERS: CouncilMemberId[] = ['codex', 'claude-code'];

describe('frontier-review CLI — court verdict drives validated/ceiling', () => {
  test('VALIDATED + --write sets frontier_spec.status = validated', async () => {
    const m = matrix(frozenSpec());
    let saved: CompeteMatrix | null = null;
    const r = await runFrontierReviewCli({
      dimId: 'repo_level_context', write: true,
      _loadMatrix: async () => m, _saveMatrix: async (mm) => { saved = mm; },
      _discoverMembers: async () => MEMBERS,
      _runJudge: async () => 'VERDICT: PASS\nCONFIDENCE: HIGH\nREASON: genuine repo map matching Cursor',
      _readArtifact: async () => '{"symbols":990}',
      _loadEvidence: async () => goodEvidence(),
      _enqueueAudit: async () => {},
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.result.verdict, 'VALIDATED');
    assert.equal(r.validatedWritten, true);
    const dim = (saved as unknown as { dimensions: Array<{ frontier_spec: FrontierSpec }> })!.dimensions[0]!;
    assert.equal(dim.frontier_spec.status, 'validated');
  });

  test('REJECTED does NOT set validated (builder cannot self-certify)', async () => {
    const m = matrix(frozenSpec());
    let saved = false;
    const r = await runFrontierReviewCli({
      dimId: 'repo_level_context', write: true,
      _loadMatrix: async () => m, _saveMatrix: async () => { saved = true; },
      _discoverMembers: async () => MEMBERS,
      _runJudge: async (id) => id === 'codex' ? 'VERDICT: PASS\nREASON: ok' : 'VERDICT: FAIL\nREASON: prepared fixture, not real usage',
      _readArtifact: async () => '{}',
      _loadEvidence: async () => goodEvidence(),
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.result.verdict, 'REJECTED');
    assert.equal(r.validatedWritten, false);
    assert.equal(saved, false);
  });

  test('agreed CEILING signal + --write records a ceiling receipt', async () => {
    const m = matrix(frozenSpec());
    let ceilingPath = '';
    const r = await runFrontierReviewCli({
      dimId: 'repo_level_context', write: true,
      _loadMatrix: async () => m, _saveMatrix: async () => {},
      _discoverMembers: async () => MEMBERS,
      _runJudge: async () => 'VERDICT: FAIL\nCEILING: yes\nREASON: genuine R&D gap, cannot reach frontier yet',
      _readArtifact: async () => '{}',
      _loadEvidence: async () => goodEvidence(),
      _writeCeiling: async (p) => { ceilingPath = p; },
      _enqueueAudit: async () => {},
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.result.verdict, 'REJECTED');
    assert.equal(r.result.ceilingSignal, 2);
    assert.equal(r.ceilingWritten, true);
    assert.match(ceilingPath, /ceilings[/\\]repo_level_context\.json$/);
  });

  test('pre-court receipt gate: one distinct session → REJECTED, judges NOT convened', async () => {
    const m = matrix(frozenSpec());
    let judged = false;
    const r = await runFrontierReviewCli({
      dimId: 'repo_level_context', write: true,
      _loadMatrix: async () => m, _saveMatrix: async () => {},
      _discoverMembers: async () => MEMBERS,
      _runJudge: async () => { judged = true; return 'VERDICT: PASS\nREASON: x'; },
      _readArtifact: async () => '{}',
      // 3 passing T7 receipts but ALL in the SAME session → fails the ≥2-distinct-sessions gate.
      _loadEvidence: async () => evidence({ o1: 'sess-A', o2: 'sess-A', o3: 'sess-A' }),
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.result.verdict, 'REJECTED');
    assert.equal(judged, false, 'a single-session fixture must be blocked by the deterministic gate BEFORE the council');
    assert.match(r.result.vote.summary, /receipt gate/);
  });

  test('pre-court receipt gate: a FAILING receipt → REJECTED, judges NOT convened', async () => {
    const m = matrix(frozenSpec());
    let judged = false;
    const r = await runFrontierReviewCli({
      dimId: 'repo_level_context', write: true,
      _loadMatrix: async () => m, _saveMatrix: async () => {},
      _discoverMembers: async () => MEMBERS,
      _runJudge: async () => { judged = true; return 'VERDICT: PASS'; },
      _readArtifact: async () => '{}',
      _loadEvidence: async () => evidence({ o1: 'sess-A', o2: 'sess-A', o3: 'sess-B' }, { o3: false }),
      _now: '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.result.verdict, 'REJECTED');
    assert.equal(judged, false, 'a failing receipt blocks the court deterministically');
  });

  test('throws if the spec is only draft (not frozen)', async () => {
    const draft = frozenSpec(); draft.status = 'draft';
    const m = matrix(draft);
    await assert.rejects(() => runFrontierReviewCli({
      dimId: 'repo_level_context', _loadMatrix: async () => m, _saveMatrix: async () => {},
      _discoverMembers: async () => MEMBERS, _runJudge: async () => 'VERDICT: PASS', _readArtifact: async () => '{}',
    }), /not frozen/);
  });
});
