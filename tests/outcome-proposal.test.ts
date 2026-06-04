// outcome-proposal.test.ts — the propose-only gate: a T5+ outcome cannot affect the score until an
// INDEPENDENT reviewer accepts it. The structural keystone against self-authored goalposts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  proposeOutcome, listProposedOutcomes, rejectProposedOutcome, acceptProposedOutcome,
  installAcceptedOutcome, isAccepted, type ProposalFsDeps,
} from '../src/core/outcome-proposal.js';
import type { Outcome } from '../src/matrix/types/outcome.js';
import type { CompeteMatrix } from '../src/core/compete-matrix.js';

// In-memory fs seam.
function memFs(): ProposalFsDeps & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    mkdir: async () => {},
    writeFile: async (p, c) => { files.set(p, c); },
    readFile: async (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
    readdir: async (dir) => [...files.keys()].filter(k => k.startsWith(dir)).map(k => k.slice(dir.length + 1)),
    rm: async (p) => { files.delete(p); },
  };
}

const t5 = (id: string): Outcome => ({ id, tier: 'T5', description: 'd', kind: 'cli-smoke', cli_args: ['--version'], required_callsite: 'src/x.ts' } as unknown as Outcome);
const t2 = (id: string): Outcome => ({ id, tier: 'T2', description: 'd', command: 'npm test', required_callsite: 'src/x.ts' } as unknown as Outcome);

function matrixWith(dimId: string): CompeteMatrix {
  return { project: 'p', competitors: [], competitors_closed_source: [], competitors_oss: [], lastUpdated: '', overallSelfScore: 0,
    dimensions: [{ id: dimId, label: dimId, weight: 1, scores: { self: 6 }, outcomes: [] }] } as unknown as CompeteMatrix;
}

describe('propose / list / reject', () => {
  it('proposeOutcome writes to the pending queue and strips any self-applied acceptance', async () => {
    const fs = memFs();
    const sneaky = { ...t5('o1'), acceptance: { acceptedBy: 'me', acceptedAt: 'now' } } as Outcome;
    await proposeOutcome('/proj', 'dimA', sneaky, 'builder-agent', fs);
    const list = await listProposedOutcomes('/proj', 'dimA', fs);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.outcome.acceptance, undefined, 'proposer cannot self-stamp acceptance');
    assert.equal(list[0]!.proposedBy, 'builder-agent');
  });

  it('rejectProposedOutcome removes it from the queue', async () => {
    const fs = memFs();
    await proposeOutcome('/proj', 'dimA', t5('o1'), 'builder', fs);
    await rejectProposedOutcome('/proj', 'dimA', 'o1', fs);
    assert.equal((await listProposedOutcomes('/proj', 'dimA', fs)).length, 0);
  });
});

describe('accept (independence enforced)', () => {
  it('refuses a self-accept (acceptedBy === proposedBy)', async () => {
    const fs = memFs();
    await proposeOutcome('/proj', 'dimA', t5('o1'), 'builder', fs);
    const r = await acceptProposedOutcome('/proj', 'dimA', 'o1', 'builder', undefined, fs);
    assert.equal(r.accepted, false);
    assert.match(r.reason, /self-accept forbidden/);
  });

  it('accepts when an independent reviewer stamps it, and removes it from the queue', async () => {
    const fs = memFs();
    await proposeOutcome('/proj', 'dimA', t5('o1'), 'builder', fs);
    const r = await acceptProposedOutcome('/proj', 'dimA', 'o1', 'review-court', 'looks real', fs);
    assert.equal(r.accepted, true);
    assert.ok(isAccepted(r.outcome!), 'stamped outcome is accepted');
    assert.equal(r.outcome!.acceptance!.acceptedBy, 'review-court');
    assert.equal((await listProposedOutcomes('/proj', 'dimA', fs)).length, 0, 'removed from queue');
  });
});

describe('installAcceptedOutcome — THE gate', () => {
  it('refuses a T5+ outcome with no acceptance stamp', () => {
    const m = matrixWith('dimA');
    const r = installAcceptedOutcome(m, 'dimA', t5('o1'));
    assert.equal(r.installed, false);
    assert.match(r.reason, /no independent acceptance/);
    assert.equal((m.dimensions[0] as { outcomes?: unknown[] }).outcomes!.length, 0, 'not installed');
  });

  it('admits a T5+ outcome that carries a valid stamp', async () => {
    const fs = memFs();
    await proposeOutcome('/proj', 'dimA', t5('o1'), 'builder', fs);
    const accepted = (await acceptProposedOutcome('/proj', 'dimA', 'o1', 'court', undefined, fs)).outcome!;
    const m = matrixWith('dimA');
    const r = installAcceptedOutcome(m, 'dimA', accepted);
    assert.equal(r.installed, true);
    assert.equal((m.dimensions[0] as { outcomes?: unknown[] }).outcomes!.length, 1);
  });

  it('admits a T2 outcome WITHOUT a stamp (only T5+ are gated)', () => {
    const m = matrixWith('dimA');
    const r = installAcceptedOutcome(m, 'dimA', t2('o2'));
    assert.equal(r.installed, true);
  });
});
