// outcome-acceptance-court.test.ts — tier-appropriate, independent acceptance of proposed outcomes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reviewProposedOutcome, reviewAllProposals, type AcceptanceCourtDeps } from '../src/matrix/courts/outcome-acceptance-court.js';
import { proposeOutcome, type ProposalFsDeps } from '../src/core/outcome-proposal.js';
import type { Outcome } from '../src/matrix/types/outcome.js';

function memFs(): ProposalFsDeps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files, mkdir: async () => {}, writeFile: async (p, c) => { files.set(p, c); },
    readFile: async (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
    readdir: async (dir) => [...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length + 1)),
    rm: async (p) => { files.delete(p); },
  };
}

const t5 = (id: string, callsite = 'src/x.ts'): Outcome => ({ id, tier: 'T5', description: 'd', kind: 'cli-smoke', cli_args: ['validate', 'x'], required_callsite: callsite } as unknown as Outcome);
const t7 = (id: string): Outcome => ({ id, tier: 'T7', description: 'd', kind: 'cli-smoke', cli_args: ['validate', 'x'], required_callsite: 'src/x.ts' } as unknown as Outcome);

function deps(fs: ProposalFsDeps, over: Partial<AcceptanceCourtDeps> = {}): AcceptanceCourtDeps {
  return { courtId: 'review-court', fs, passesHardenGate: async () => true, passesFrontierReview: async () => true, ...over };
}

describe('reviewProposedOutcome', () => {
  it('accepts a structurally-valid T5 once the harden gate is clean', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t5('o1'), 'builder', fs);
    const r = await reviewProposedOutcome('/p', 'dimA', 'o1', deps(fs));
    assert.equal(r.verdict, 'accepted');
    assert.equal(r.outcome?.acceptance?.acceptedBy, 'review-court');
  });

  it('defers a T5 when the harden gate is NOT clean', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t5('o1'), 'builder', fs);
    const r = await reviewProposedOutcome('/p', 'dimA', 'o1', deps(fs, { passesHardenGate: async () => false }));
    assert.equal(r.verdict, 'deferred');
    assert.match(r.reason, /harden gate/);
  });

  it('routes T7 to frontier-review and accepts only on VALIDATED', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t7('o7'), 'builder', fs);
    // Isolate the tier-ROUTING from the structural rules with a pass-through validate seam.
    const ok = await reviewProposedOutcome('/p', 'dimA', 'o7', deps(fs, { validate: () => [], passesFrontierReview: async () => true }));
    assert.equal(ok.verdict, 'accepted');
  });

  it('defers a T7 when frontier-review is not VALIDATED (harden alone is NOT enough for 9.0)', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t7('o7'), 'builder', fs);
    const r = await reviewProposedOutcome('/p', 'dimA', 'o7', deps(fs, { validate: () => [], passesHardenGate: async () => true, passesFrontierReview: async () => false }));
    assert.equal(r.verdict, 'deferred');
    assert.match(r.reason, /frontier-review/);
  });

  it('rejects a structurally-invalid proposal (T5 missing required_callsite)', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t5('o1', ''), 'builder', fs);
    const r = await reviewProposedOutcome('/p', 'dimA', 'o1', deps(fs));
    assert.equal(r.verdict, 'rejected');
    assert.match(r.reason, /structural/);
  });

  it('rejects when the court is also the proposer (independence)', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t5('o1'), 'review-court', fs);
    const r = await reviewProposedOutcome('/p', 'dimA', 'o1', deps(fs));
    assert.equal(r.verdict, 'rejected');
    assert.match(r.reason, /independence|proposer/);
  });

  it('rejects when there is no pending proposal', async () => {
    const r = await reviewProposedOutcome('/p', 'dimA', 'nope', deps(memFs()));
    assert.equal(r.verdict, 'rejected');
  });
});

describe('reviewAllProposals', () => {
  it('reviews every queued proposal for a dim', async () => {
    const fs = memFs();
    await proposeOutcome('/p', 'dimA', t5('o1'), 'builder', fs);
    await proposeOutcome('/p', 'dimA', t5('o2', ''), 'builder', fs); // invalid
    const results = await reviewAllProposals('/p', 'dimA', deps(fs));
    assert.equal(results.length, 2);
    assert.equal(results.filter(r => r.verdict === 'accepted').length, 1);
    assert.equal(results.filter(r => r.verdict === 'rejected').length, 1);
  });
});
