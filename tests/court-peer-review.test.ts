// Peer-review judging (CH-061): now that gemini is gone, the frontier court's 2nd independent opinion comes
// from a build-eligible member judging dims it did NOT build — authorized by a KERNEL-SIGNED builder-provenance
// token. These tests pin the INTEGRITY property (a verifying token seats peers; anything else holds the
// court-audit #4+#5 floor) and the authoritative provenance source (the merge court's SLOT_PROOF_LEDGER).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { computeExcludedJudges } from '../src/cli/commands/frontier-review.js';
import { buildersOfDimFromLedger, quorumPreflight } from '../src/cli/commands/ascend-frontier-push.js';
import { signBuilderProvenance } from '../src/core/frontier-spec.js';
import type { CouncilMemberId } from '../src/cli/commands/council.js';

// Real roster after gemini's removal: codex + claude-code build (and peer-judge), grok-build is judge-only.
const ROSTER: Array<{ id: CouncilMemberId; judgeOnly?: boolean }> = [
  { id: 'codex' }, { id: 'claude-code' }, { id: 'grok-build', judgeOnly: true },
];
const sorted = (s: Set<CouncilMemberId>) => [...s].sort();

describe('computeExcludedJudges — peer review vs the floor (the anti-self-certification core)', () => {
  test('a VERIFYING token excludes ONLY the real builder → the OTHER builder + grok seat as 2 peers', () => {
    const token = signBuilderProvenance('functionality', ['codex']);
    const excluded = computeExcludedJudges('functionality', ['codex'], undefined, token, ROSTER);
    assert.deepEqual(sorted(excluded), ['codex'], 'only codex excluded; claude-code + grok-build judge');
  });

  test('NO token → the floor excludes EVERY build-eligible member (only grok survives)', () => {
    const excluded = computeExcludedJudges('functionality', ['codex'], undefined, undefined, ROSTER);
    assert.deepEqual(sorted(excluded), ['claude-code', 'codex'], 'floor: a builder can never re-seat itself');
  });

  test('a FORGED token → the floor holds (an agent has no kernel secret)', () => {
    const excluded = computeExcludedJudges('functionality', ['codex'], undefined, 'deadbeefdeadbeefdeadbeefdeadbeef', ROSTER);
    assert.deepEqual(sorted(excluded), ['claude-code', 'codex'], 'a forged token cannot seat a builder as judge');
  });

  test('a token for a DIFFERENT dim → the floor holds (no cross-dim reuse)', () => {
    const wrongDim = signBuilderProvenance('security', ['codex']);
    const excluded = computeExcludedJudges('functionality', ['codex'], undefined, wrongDim, ROSTER);
    assert.deepEqual(sorted(excluded), ['claude-code', 'codex'], 'a token only authorizes its own dim');
  });

  test('a token naming the WRONG builder → the floor holds (no self-seating by lying about the builder)', () => {
    // claude-code (the would-be self-certifier) presents a token signed for codex but is itself the builder.
    const tokenForCodex = signBuilderProvenance('functionality', ['codex']);
    const excluded = computeExcludedJudges('functionality', ['claude-code'], undefined, tokenForCodex, ROSTER);
    assert.deepEqual(sorted(excluded), ['claude-code', 'codex'], 'the token must name exactly the excluded builder set');
  });
});

describe('buildersOfDimFromLedger — authoritative provenance from the merge court ledger', () => {
  async function scratchWithLedger(ledger: unknown): Promise<string> {
    const dir = path.join(os.tmpdir(), `court-prov-${process.pid}-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(dir, '.danteforge', 'SLOT_PROOF_LEDGER_round1.json'), JSON.stringify(ledger), 'utf8');
    return dir;
  }

  test('returns the member that built the dim (per the SLOT_PROOF_LEDGER)', async () => {
    const dir = await scratchWithLedger({
      slots: [
        { memberId: 'codex', assignedDims: ['functionality', 'security'] },
        { memberId: 'claude-code', assignedDims: ['testing'] },
      ],
    });
    try {
      assert.deepEqual(await buildersOfDimFromLedger(dir, 'functionality'), ['codex']);
      assert.deepEqual(await buildersOfDimFromLedger(dir, 'testing'), ['claude-code']);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('a dim no member built → [] (caller keeps the safe exclude-all floor)', async () => {
    const dir = await scratchWithLedger({ slots: [{ memberId: 'codex', assignedDims: ['functionality'] }] });
    try {
      assert.deepEqual(await buildersOfDimFromLedger(dir, 'never-built'), []);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('no ledger directory at all → [] (never throws)', async () => {
    const dir = path.join(os.tmpdir(), `court-prov-empty-${process.pid}-${randomUUID().slice(0, 8)}`);
    assert.deepEqual(await buildersOfDimFromLedger(dir, 'functionality'), []);
  });

  test('STALE LEDGER: only the NEWEST run names the builder; a stale prior-run entry is ignored (fail closed)', async () => {
    const dir = path.join(os.tmpdir(), `court-prov-stale-${process.pid}-${randomUUID().slice(0, 8)}`);
    await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
    const r1 = path.join(dir, '.danteforge', 'SLOT_PROOF_LEDGER_round1.json');
    const r2 = path.join(dir, '.danteforge', 'SLOT_PROOF_LEDGER_round2.json');
    // STALE prior run says codex built `functionality`; the CURRENT run built `planning_quality` with claude and
    // did NOT touch `functionality`. Deterministic mtimes so "newest run" is unambiguous on any filesystem.
    await fs.writeFile(r1, JSON.stringify({ runId: 'run-OLD', slots: [{ memberId: 'codex', assignedDims: ['functionality'] }] }));
    await fs.writeFile(r2, JSON.stringify({ runId: 'run-NEW', slots: [{ memberId: 'claude-code', assignedDims: ['planning_quality'] }] }));
    const base = Date.UTC(2026, 5, 22);
    await fs.utimes(r1, new Date(base - 10_000), new Date(base - 10_000)); // OLD
    await fs.utimes(r2, new Date(base), new Date(base));                   // NEW (most recent)
    try {
      assert.deepEqual(await buildersOfDimFromLedger(dir, 'planning_quality'), ['claude-code'], 'the current run names the real builder');
      assert.deepEqual(await buildersOfDimFromLedger(dir, 'functionality'), [], 'a dim only in the STALE run is unknown → fail closed (the court will use the safe floor)');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('END-TO-END: ledger builder → signed token → court seats peers (the full orchestrator path)', async () => {
    const dir = await scratchWithLedger({ slots: [{ memberId: 'codex', assignedDims: ['functionality'] }] });
    try {
      const realBuilders = await buildersOfDimFromLedger(dir, 'functionality'); // ['codex']
      const token = signBuilderProvenance('functionality', realBuilders);        // what defaultPromoteOne signs
      const excluded = computeExcludedJudges('functionality', realBuilders, undefined, token, ROSTER);
      assert.deepEqual(sorted(excluded), ['codex'], 'the real builder is excluded; claude-code + grok judge as peers');
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('quorumPreflight — fail LOUD + actionable instead of a silent generator-ceiling (council #1 must-fix)', () => {
  const AVAILABLE: CouncilMemberId[] = ['codex', 'claude-code', 'grok-build'];
  const BUILD_ELIGIBLE: CouncilMemberId[] = ['codex', 'claude-code'];

  test('peer review (one real builder) → the other builder + grok seatable = 2 → ok', () => {
    assert.equal(quorumPreflight('functionality', AVAILABLE, ['codex'], BUILD_ELIGIBLE).ok, true);
  });

  test('no provenance → exclude-all floor → only grok → FAIL, pointing at --parallel (not a capability wall)', () => {
    const pf = quorumPreflight('functionality', AVAILABLE, [], BUILD_ELIGIBLE);
    assert.equal(pf.ok, false);
    if (!pf.ok) {
      assert.match(pf.detail, /Cannot convene 2 independent judges/);
      assert.match(pf.detail, /--parallel/);
      assert.match(pf.detail, /capability ceiling/i);
    }
  });

  test('a dim BOTH members built → only grok → FAIL, pointing at a 3rd judge / --parallel', () => {
    const pf = quorumPreflight('functionality', AVAILABLE, ['codex', 'claude-code'], BUILD_ELIGIBLE);
    assert.equal(pf.ok, false);
    if (!pf.ok) assert.match(pf.detail, /3rd independent judge|--parallel/);
  });

  test('grok outage + one builder → only the lone peer survives → FAIL (2-of-2 has no redundancy)', () => {
    // available is just the 2 builders (grok down); excluding the one real builder leaves a single peer.
    assert.equal(quorumPreflight('functionality', ['codex', 'claude-code'], ['codex'], BUILD_ELIGIBLE).ok, false);
  });
});
