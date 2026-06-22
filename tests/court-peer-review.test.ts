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
import { buildersOfDimFromLedger } from '../src/cli/commands/ascend-frontier-push.js';
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
