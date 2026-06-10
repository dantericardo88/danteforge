// capability-test-execute.test.ts — the conductor's ACTION layer, seam-driven.
//
// These tests prove the executor routes each dimension class to the right production action and that
// the honesty/budget rails hold: REAL dims are dynamically probed; stub dims try the cheap execution-
// proven repair BEFORE paying for full re-authoring; no-ladder dims research the ladder then author in
// the same pass; budget exhaustion SKIPs (never fails); market-capped dims are CEILING and are never
// authored. All expensive/external actions are injected via the options._* seams — no agent dispatch,
// no shell, no matrix writes touch the real repo.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCapabilityTestExecute, resolveTargetModule } from '../src/cli/commands/capability-test-execute.js';
import type { YardstickRepairResult } from '../src/matrix/engines/yardstick-repair.js';
import type { AuthorResult } from '../src/matrix/engines/capability-test-author.js';

const tempDirs: string[] = [];
after(async () => {
  for (const d of tempDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

const LADDER_MD = [
  '# Universe: test dim',
  '',
  '## Score Ladder',
  '',
  '| Score | Descriptor |',
  '|---|---|',
  '| 7 | solid baseline |',
  '| 9 | frontier capability bar |',
  '',
].join('\n');

function dim(id: string, command: string, outcomes: unknown[] = []): Record<string, unknown> {
  return {
    id, label: id, weight: 1, category: 'quality', frequency: 'high',
    scores: { self: 4 }, gap_to_leader: 0, leader: 'x',
    gap_to_closed_source_leader: 0, closed_source_leader: 'x',
    gap_to_oss_leader: 0, oss_leader: 'x', status: 'in-progress',
    sprint_history: [], next_sprint_target: 9,
    capability_test: { command },
    outcomes,
  };
}

/** Write a minimal real project: .danteforge/compete/matrix.json (+ optional universe ladder files). */
async function makeProject(dims: unknown[], universes: Record<string, string> = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cte-'));
  tempDirs.push(dir);
  const competeDir = path.join(dir, '.danteforge', 'compete');
  await fs.mkdir(path.join(competeDir, 'universe'), { recursive: true });
  const matrix = {
    project: 'cte-test', competitors: [], competitors_closed_source: [], competitors_oss: [],
    lastUpdated: new Date().toISOString(), overallSelfScore: 0, dimensions: dims,
  };
  await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix, null, 2), 'utf8');
  for (const [id, md] of Object.entries(universes)) {
    await fs.writeFile(path.join(competeDir, 'universe', `${id}.md`), md, 'utf8');
  }
  return dir;
}

const declineRepair = async (d: { id: string }): Promise<YardstickRepairResult> =>
  ({ dimId: d.id, repaired: false, reason: 'repair gates declined' });
const installAuthor = async (dimId: string): Promise<AuthorResult> =>
  ({ dimId, installed: true, reason: 'authored real RED yardstick' });

describe('runCapabilityTestExecute — conductor plan turned into action', () => {
  test('(1) a REAL dim is dynamically probed and PROCEEDs on a GENUINE verdict', async () => {
    // `node dist/index.js compete` audits as REAL_PRODUCT_PROBE — the executor must probe it, not author it.
    const project = await makeProject([dim('real_dim', 'node dist/index.js compete --json')]);
    const probed: string[] = [];
    const calls: string[] = [];
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async (audit) => { probed.push(audit.dimId); return 'GENUINE'; },
      _repairFn: async (d) => { calls.push(`repair:${d.id}`); return declineRepair(d); },
      _authorFn: async (dimId) => { calls.push(`author:${dimId}`); return installAuthor(dimId); },
    });
    assert.deepEqual(probed, ['real_dim'], 'the REAL dim must be probed exactly once');
    assert.equal(r.report.outcomes[0]!.status, 'PROCEED');
    assert.match(r.report.outcomes[0]!.detail ?? '', /GENUINE/);
    assert.deepEqual(calls, [], 'a GENUINE real metric is never repaired or re-authored');
    assert.equal(r.actionsUsed, 0, 'probes are free — no expensive action consumed');
  });

  test('(2) a STUB dim tries the repair engine FIRST, then falls through to authoring when it declines', async () => {
    // `bash scripts/check.sh` with no wired callsite audits as SELF_FULFILLING_STUB; ladder exists so the
    // route is AUTHOR_YARDSTICK — and the executor must attempt the cheap repair before paying to author.
    const project = await makeProject([dim('stub_dim', 'bash scripts/check.sh')], { stub_dim: LADDER_MD });
    const calls: string[] = [];
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async () => 'GENUINE',
      _repairFn: async (d) => { calls.push(`repair:${d.id}`); return declineRepair(d); },
      _authorFn: async (dimId) => { calls.push(`author:${dimId}`); return installAuthor(dimId); },
    });
    assert.deepEqual(calls, ['repair:stub_dim', 'author:stub_dim'], 'repair must be attempted BEFORE authoring');
    assert.equal(r.report.outcomes[0]!.status, 'AUTHORED');
    assert.equal(r.report.outcomes[0]!.action, 'AUTHOR_YARDSTICK');
    assert.equal(r.actionsUsed, 1, 'one expensive action: the authoring (repair is free)');
  });

  test('(2b) when repair SUCCEEDS the dim is fixed without authoring, and the repaired command is installed', async () => {
    const project = await makeProject([dim('masked_dim', 'bash scripts/old-stub.sh')], { masked_dim: LADDER_MD });
    const installed: string[] = [];
    let authored = false;
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async () => 'GENUINE',
      _repairFn: async (d) => ({
        dimId: d.id, repaired: true, newCommand: 'npx tsx --test tests/real.capability.test.ts',
        callsite: 'src/core/real.ts', reason: 'real wired outcome passes — repointed',
      }),
      _authorFn: async (dimId) => { authored = true; return installAuthor(dimId); },
      _installRepair: async (dimId, command) => { installed.push(`${dimId}:${command}`); },
    });
    assert.deepEqual(installed, ['masked_dim:npx tsx --test tests/real.capability.test.ts']);
    assert.equal(authored, false, 'a successful repair must NOT fall through to expensive re-authoring');
    assert.equal(r.report.outcomes[0]!.status, 'AUTHORED');
    assert.match(r.report.outcomes[0]!.detail ?? '', /repaired, not re-authored/);
    assert.equal(r.actionsUsed, 0, 'repair consumes no expensive-action budget');
  });

  test('(3) a no-ladder dim RESEARCHES the ladder then AUTHORS in the same pass', async () => {
    // No universe file → RESEARCH_LADDER route. The executor must research first, then author.
    const project = await makeProject([dim('no_ladder_dim', 'bash scripts/y.sh')]);
    const calls: string[] = [];
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async () => 'GENUINE',
      _researchFn: async (dimId) => { calls.push(`research:${dimId}`); return { ok: true, reason: 'ladder written' }; },
      _repairFn: async (d) => { calls.push(`repair:${d.id}`); return declineRepair(d); },
      _authorFn: async (dimId) => { calls.push(`author:${dimId}`); return installAuthor(dimId); },
    });
    const researchIdx = calls.indexOf('research:no_ladder_dim');
    const authorIdx = calls.indexOf('author:no_ladder_dim');
    assert.ok(researchIdx >= 0 && authorIdx >= 0, `both research and author must run (got: ${calls.join(', ')})`);
    assert.ok(researchIdx < authorIdx, 'research must precede authoring in the same pass');
    assert.equal(r.report.outcomes[0]!.status, 'AUTHORED');
    assert.equal(r.report.outcomes[0]!.ladderResearched, true);
    assert.equal(r.actionsUsed, 2, 'research + author = two expensive actions');
  });

  test('(3b) failed ladder research (no council member) is BLOCKED honestly — never authored against an invented bar', async () => {
    const project = await makeProject([dim('no_council_dim', 'bash scripts/z.sh')]);
    let authored = false;
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async () => 'GENUINE',
      _researchFn: async () => ({ ok: false, reason: 'no council member available' }),
      _repairFn: declineRepair,
      _authorFn: async (dimId) => { authored = true; return installAuthor(dimId); },
    });
    assert.equal(r.report.outcomes[0]!.status, 'BLOCKED');
    assert.match(r.report.outcomes[0]!.detail ?? '', /no council member available/);
    assert.equal(authored, false, 'authoring without a researched ladder would be a self-set bar');
  });

  test('(4) budget exhaustion SKIPs remaining work instead of failing', async () => {
    const project = await makeProject(
      [dim('s1', 'bash scripts/a.sh'), dim('s2', 'bash scripts/b.sh')],
      { s1: LADDER_MD, s2: LADDER_MD },
    );
    let authorCalls = 0;
    let repairCalls = 0;
    const r = await runCapabilityTestExecute({
      project,
      maxActions: 1,
      _verifyFn: async () => 'GENUINE',
      _repairFn: async (d) => { repairCalls++; return declineRepair(d); },
      _authorFn: async (dimId) => { authorCalls++; return installAuthor(dimId); },
    });
    assert.equal(authorCalls, 1, 'only one authoring fits a budget of 1');
    assert.equal(repairCalls, 1, 'the skipped dim is not even repair-probed — the engine skips before the wrapper');
    assert.equal(r.report.counts['AUTHORED'], 1);
    assert.equal(r.report.counts['SKIPPED'], 1);
    const skipped = r.report.outcomes.find(o => o.status === 'SKIPPED');
    assert.match(skipped?.detail ?? '', /budget exhausted/);
  });

  test('(5) a market-capped dim is CEILING — repair and author are NEVER invoked for it', async () => {
    const project = await makeProject([dim('community_adoption', 'bash scripts/adopt.sh')], { community_adoption: LADDER_MD });
    const calls: string[] = [];
    const r = await runCapabilityTestExecute({
      project,
      _verifyFn: async () => 'GENUINE',
      _repairFn: async (d) => { calls.push(`repair:${d.id}`); return declineRepair(d); },
      _authorFn: async (dimId) => { calls.push(`author:${dimId}`); return installAuthor(dimId); },
    });
    assert.equal(r.report.outcomes[0]!.status, 'CEILING');
    assert.deepEqual(calls, [], 'fabricating adoption evidence is structurally impossible — no action runs');
    assert.equal(r.actionsUsed, 0);
  });

  test('throws on a project with no compete matrix (the only crash case)', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cte-empty-'));
    tempDirs.push(dir);
    await assert.rejects(() => runCapabilityTestExecute({ project: dir }), /No compete matrix/);
  });
});

describe('resolveTargetModule — the production module an authored yardstick must exercise', () => {
  test('prefers the first outcome required_callsite that exists and is production src', () => {
    const d = {
      outcomes: [
        { required_callsite: 'TODO-set-real-callsite' },          // un-authored fiction — skipped
        { required_callsite: 'tests/foo.test.ts' },               // test file — skipped
        { required_callsite: 'src/core/missing.ts' },             // not on disk — skipped
        { required_callsite: 'src/core/real.ts' },
      ],
      capability_test: { command: 'bash scripts/x.sh' },
    };
    const exists = (p: string): boolean => p.replace(/\\/g, '/').endsWith('src/core/real.ts');
    assert.equal(resolveTargetModule(d, '/proj', exists), 'src/core/real.ts');
  });

  test('falls back to a src file referenced by the capability_test command', () => {
    const d = {
      outcomes: [],
      capability_test: { command: 'npx tsx --test tests/x.test.ts && node -e "require(0)" src/engines/widget.ts' },
    };
    const exists = (p: string): boolean => p.replace(/\\/g, '/').endsWith('src/engines/widget.ts');
    assert.equal(resolveTargetModule(d, '/proj', exists), 'src/engines/widget.ts');
  });

  test('returns null when nothing real exists on disk (honest decline, no invention)', () => {
    const d = { outcomes: [{ required_callsite: 'src/gone.ts' }], capability_test: { command: 'bash run.sh' } };
    assert.equal(resolveTargetModule(d, '/proj', () => false), null);
  });
});
