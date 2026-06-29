// fleet-stability-fixes.test.ts — regressions for the council-diagnosed fleet failures (2026-06-10).
//
// The three live autopilot runs (DanteCode/DanteAgents/DanteSecurity) surfaced one root cause with
// many symptoms: build-to-7 ran autoresearch in the operator's MAIN checkout (branch hijack +
// git-reset of uncommitted declarations), the planner read stale self-scores after HEAD moved
// (premature done), and gate subprocesses could not resolve per-user toolchains (cargo/go). These
// tests pin the fixes.
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { toolchainEnv } from '../src/core/toolchain-path.js';
import { mergeBackIsolatedBranch } from '../src/cli/commands/harden-crusade.js';

const ROOT = path.join(os.tmpdir(), `fleet-fixes-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function makeRepo(name: string): Promise<string> {
  const dir = path.join(ROOT, name);
  await fs.mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  await fs.writeFile(path.join(dir, 'base.txt'), 'base\n', 'utf8');
  git(dir, 'add', 'base.txt');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}

describe('toolchainEnv — gate subprocesses resolve per-user toolchains (the cargo/go PATH gap)', () => {
  test('preserves every existing PATH entry as a prefix (augment-only, never reorder)', () => {
    const base = { PATH: 'C:\\one;C:\\two' } as NodeJS.ProcessEnv;
    const out = toolchainEnv(base);
    assert.ok((out.PATH ?? '').startsWith('C:\\one;C:\\two'), `existing PATH must lead: ${out.PATH}`);
  });
  test('idempotent — applying twice adds nothing the second time', () => {
    const once = toolchainEnv({ PATH: 'C:\\one' } as NodeJS.ProcessEnv);
    const twice = toolchainEnv({ ...once });
    assert.equal(twice[Object.keys(twice).find(k => k.toLowerCase() === 'path')!],
      once[Object.keys(once).find(k => k.toLowerCase() === 'path')!]);
  });
  test('preserves the Windows-style "Path" key casing instead of forking a second PATH variable', () => {
    const out = toolchainEnv({ Path: 'C:\\one' } as NodeJS.ProcessEnv);
    assert.equal(out['PATH'], undefined);
    assert.ok((out['Path'] ?? '').startsWith('C:\\one'));
  });
});

describe('mergeBackIsolatedBranch — isolated work lands WITHOUT touching the operator checkout', () => {
  test('kept commits merge into the CURRENT branch and the work branch is pruned', async () => {
    const dir = await makeRepo('merge-clean');
    // Simulate an isolated run that kept one commit on its deterministic branch.
    git(dir, 'branch', 'autoresearch/hc-d1-1');
    git(dir, 'switch', '-q', 'autoresearch/hc-d1-1');
    await fs.writeFile(path.join(dir, 'won.txt'), 'kept experiment\n', 'utf8');
    git(dir, 'add', 'won.txt');
    git(dir, 'commit', '-qm', 'kept');
    git(dir, 'switch', '-q', 'main');

    await mergeBackIsolatedBranch(dir, 'autoresearch/hc-d1-1', 'd1');

    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main', 'checkout must stay on the operator branch');
    assert.equal(readFileSync(path.join(dir, 'won.txt'), 'utf8'), 'kept experiment\n', 'kept work landed');
    assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/autoresearch/hc-d1-1'),
      'merged branch is pruned');
  });

  test('a conflicting branch aborts cleanly: checkout untouched, work preserved on the branch', async () => {
    const dir = await makeRepo('merge-conflict');
    git(dir, 'branch', 'autoresearch/hc-d2-1');
    git(dir, 'switch', '-q', 'autoresearch/hc-d2-1');
    await fs.writeFile(path.join(dir, 'base.txt'), 'agent version\n', 'utf8');
    git(dir, 'add', 'base.txt');
    git(dir, 'commit', '-qm', 'agent edit');
    git(dir, 'switch', '-q', 'main');
    await fs.writeFile(path.join(dir, 'base.txt'), 'operator version\n', 'utf8');
    git(dir, 'add', 'base.txt');
    git(dir, 'commit', '-qm', 'operator edit');

    await mergeBackIsolatedBranch(dir, 'autoresearch/hc-d2-1', 'd2');

    assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
    assert.equal(readFileSync(path.join(dir, 'base.txt'), 'utf8'), 'operator version\n', 'operator content intact after abort');
    assert.equal(git(dir, 'status', '--porcelain'), '', 'no in-progress merge left behind');
    assert.equal(git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/autoresearch/hc-d2-1').length > 0, true,
      'conflicting work survives on its branch for review');
  });

  test('no kept commits → no-op, branch pruned, nothing merged', async () => {
    const dir = await makeRepo('merge-empty');
    git(dir, 'branch', 'autoresearch/hc-d3-1'); // same commit as HEAD — nothing kept
    const headBefore = git(dir, 'rev-parse', 'HEAD');
    await mergeBackIsolatedBranch(dir, 'autoresearch/hc-d3-1', 'd3');
    assert.equal(git(dir, 'rev-parse', 'HEAD'), headBefore, 'HEAD unchanged');
    assert.throws(() => git(dir, 'rev-parse', '--verify', '--quiet', 'refs/heads/autoresearch/hc-d3-1'));
  });
});

describe('parallel push honesty — a court that never ran is NEVER a court rejection', () => {
  test('a promote crash yields courtRan:false (build failure, not rejection provenance)', async () => {
    const { runParallelRound } = await import('../src/core/ascend-frontier-parallel.js');
    const r = await runParallelRound(path.join(os.tmpdir(), 'nowhere'), [{ memberId: 'codex' as never, dimId: 'd1' }], {
      buildAll: async () => {},
      promoteOne: async () => { throw new Error('worktree exploded'); },
      _enqueueAudit: async () => {},
      nowIso: new Date().toISOString(),
    });
    assert.equal(r.outcomes[0]!.verdict, 'REJECTED');
    assert.equal(r.outcomes[0]!.courtRan, false, 'a crash means the judges never convened');
    assert.equal(r.validated.length, 0);
  });
});

describe('ascend-frontier pre-flight — broken environments fail fast with a named remedy', () => {
  test('Node repo WITH declared deps but no node_modules → ok:false naming the install remedy', async () => {
    const { defaultPreflight } = await import('../src/cli/commands/ascend-frontier-bootstrap.js');
    const dir = path.join(ROOT, 'pf-node');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'package.json'), '{"name":"x","dependencies":{"left-pad":"^1.0.0"}}', 'utf8');
    const pf = await defaultPreflight(dir, false, async () => ['codex']);
    assert.equal(pf.ok, false);
    assert.match(pf.remedy ?? '', /node_modules is missing/);
  });

  test('Node repo with ZERO declared deps passes without node_modules (zero-dep repos never have one)', async () => {
    const { defaultPreflight } = await import('../src/cli/commands/ascend-frontier-bootstrap.js');
    const dir = path.join(ROOT, 'pf-zerodep');
    await fs.mkdir(dir, { recursive: true });
    // BOM included deliberately — Windows shells write package.json with one and JSON.parse throws
    // on it; the BOM-blind parse flipped zero-dep repos into "assume deps" (caught on the live E2E).
    await fs.writeFile(path.join(dir, 'package.json'), '﻿{"name":"x","bin":{"x":"index.js"}}', 'utf8');
    const pf = await defaultPreflight(dir, false, async () => ['codex']);
    assert.equal(pf.ok, true);
    assert.ok(pf.notes.some(n => /zero declared dependencies/.test(n)), pf.notes.join(' | '));
  });
  test('non-Node repo skips the dependency check and reports agent count honestly', async () => {
    const { defaultPreflight } = await import('../src/cli/commands/ascend-frontier-bootstrap.js');
    const dir = path.join(ROOT, 'pf-rust');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'Cargo.toml'), '[package]\nname="x"\n', 'utf8');
    const pf = await defaultPreflight(dir, false, async () => []);
    assert.equal(pf.ok, true, 'zero agents is a loud warning, not a hard failure');
    assert.ok(pf.notes.some(n => /non-Node repo/.test(n)));
    assert.ok(pf.notes.some(n => /WARNING: no claude\/codex/.test(n)));
  });
  test('agent discovery crash degrades to a note — pre-flight never invents a verdict', async () => {
    const { defaultPreflight } = await import('../src/cli/commands/ascend-frontier-bootstrap.js');
    const dir = path.join(ROOT, 'pf-crash');
    await fs.mkdir(dir, { recursive: true });
    const pf = await defaultPreflight(dir, false, async () => { throw new Error('probe died'); });
    assert.equal(pf.ok, true);
    assert.ok(pf.notes.some(n => /agent discovery failed/.test(n)));
  });
});

describe('source pins — the main-tree and stale-score regressions cannot quietly return', () => {
  const read = (rel: string) => readFileSync(path.join(path.resolve('.'), rel), 'utf8');

  test('harden-crusade drives autoresearch ISOLATED, never --allow-dirty on the main tree', () => {
    const src = read('src/cli/commands/harden-crusade.ts');
    const fn = /async function defaultRunAutoResearch[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    assert.match(fn, /--isolate/, 'defaultRunAutoResearch must pass --isolate');
    assert.match(fn, /--isolate-branch/, 'deterministic branch so kept work can be merged back');
    // Quoted-literal match: the explanatory comment may NAME the forbidden flag; the args array may not PASS it.
    assert.doesNotMatch(fn, /'--allow-dirty'/, 'main-tree dirty runs are the fleet self-sabotage class');
  });

  test('harden-crusade measures by EXIT CODE: --exit-code-metric always accompanies --measurement-command', () => {
    // The measurement IS the dim's capability_test — pass/fail, never a number scraped from stdout.
    // Without --exit-code-metric the harness greps stdout for digits (DanteSecurity parsed a bogus
    // "-7" out of dates in dante.py's banner and the metric could never improve).
    const src = read('src/cli/commands/harden-crusade.ts');
    const fn = /async function defaultRunAutoResearch[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    assert.match(fn, /'--measurement-command',\s*measurementCommand,\s*'--exit-code-metric'/,
      'the same args.push must pass --exit-code-metric whenever it passes --measurement-command');
  });

  test('ascend-frontier plans on decisionDimScore (unverified dims can never read done off stale self)', () => {
    const src = read('src/cli/commands/ascend-frontier.ts');
    const fn = /async function defaultBuildState[\s\S]*?\n\}/.exec(src)?.[0] ?? '';
    assert.match(fn, /decisionDimScore/, 'the planner is a WORK decision and must use the work-decision score');
    assert.doesNotMatch(fn, /effectiveScore: effectiveDimScore/, 'effectiveDimScore falls back to raw self when derived is unset');
  });
});
