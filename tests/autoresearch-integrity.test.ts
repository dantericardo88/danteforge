// autoresearch-integrity.test.ts — guards that stop autoresearch from reward-hacking (gutting the
// capability_test it optimizes) and from leaving untracked junk behind. Covers the P0/P1 fixes for
// the DanteSecurity DS-026 / DanteAgents field reports.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { DanteState } from '../src/core/state.js';
import type { AutoResearchConfig, ExperimentResult } from '../src/core/autoresearch-engine.js';
import { runMeasurement, NEEDS_SHELL } from '../src/core/autoresearch-engine.js';
import { autoResearch, gitUntracked, gitCleanCreatedUntracked } from '../src/cli/commands/autoresearch.js';
import {
  collectForbiddenTargets,
  forbiddenTargetReason,
  checkEditParses,
} from '../src/cli/commands/autoresearch-integrity.js';

const CWD = process.platform === 'win32' ? 'C:\\proj' : '/proj';

// ── collectForbiddenTargets ───────────────────────────────────────────────────

describe('collectForbiddenTargets', () => {
  it('protects path-like and script-extension tokens from the measurement command', () => {
    const forbidden = collectForbiddenTargets('node scripts/d23-proof.mjs --flag', CWD);
    assert.ok(forbidden.includes(path.resolve(CWD, 'scripts/d23-proof.mjs')), 'proof script is protected');
  });

  it('ignores the executable and flags', () => {
    const forbidden = collectForbiddenTargets('npm test', CWD);
    // "npm" and "test" are not path-like → nothing protected from a bare npm command.
    assert.equal(forbidden.length, 0);
  });
});

// ── forbiddenTargetReason ─────────────────────────────────────────────────────

describe('forbiddenTargetReason', () => {
  const forbidden = collectForbiddenTargets('node scripts/proof.mjs', CWD);

  it('blocks editing the measurement command’s own script (reward-hacking)', () => {
    const reason = forbiddenTargetReason('scripts/proof.mjs', CWD, forbidden);
    assert.match(reason ?? '', /yardstick/);
  });

  it('blocks path-escape outside the project tree', () => {
    assert.match(forbiddenTargetReason('../../etc/passwd', CWD, forbidden) ?? '', /outside the project/);
  });

  it('blocks kernel-owned score surfaces', () => {
    assert.match(forbiddenTargetReason('.danteforge/compete/matrix.json', CWD, forbidden) ?? '', /score surface/);
  });

  it('allows an ordinary source file', () => {
    assert.equal(forbiddenTargetReason('src/feature.ts', CWD, forbidden), null);
  });
});

// ── checkEditParses ───────────────────────────────────────────────────────────

describe('checkEditParses', () => {
  it('rejects invalid JSON', async () => {
    const reason = await checkEditParses('config.json', CWD, async () => '{ not json', async () => ({}));
    assert.match(reason ?? '', /invalid JSON/);
  });

  it('accepts valid JSON', async () => {
    const reason = await checkEditParses('config.json', CWD, async () => '{"ok":true}', async () => ({}));
    assert.equal(reason, null);
  });

  it('rejects a .mjs that fails node --check (e.g. a shell command pasted into a script)', async () => {
    const reason = await checkEditParses('scripts/x.mjs', CWD, async () => '', async () => {
      throw Object.assign(new Error('check failed'), { stderr: "SyntaxError: Unexpected identifier 'scripts'\n  at ..." });
    });
    assert.match(reason ?? '', /syntax error/i);
  });

  it('passes a .mjs that node --check accepts', async () => {
    const reason = await checkEditParses('scripts/x.mjs', CWD, async () => '', async () => ({ stdout: '' }));
    assert.equal(reason, null);
  });

  it('skips unknown file types (no cheap parser)', async () => {
    const reason = await checkEditParses('notes.txt', CWD, async () => 'anything', async () => { throw new Error('should not run'); });
    assert.equal(reason, null);
  });
});

// ── runMeasurement shell routing ──────────────────────────────────────────────

describe('runMeasurement shell routing', () => {
  it('NEEDS_SHELL detects pipes, redirects, separators, and 2>&1', () => {
    for (const cmd of ['npm test | tail -1', 'a && b', 'x > out', 'cmd 2>&1', 'a; b', 'echo `x`']) {
      assert.ok(NEEDS_SHELL.test(cmd), `should need shell: ${cmd}`);
    }
  });

  it('routes a piped command through the platform shell, not a token-split', async () => {
    let captured: { executable: string; args: string[] } | null = null;
    const execFn = async (executable: string, args: string[]) => {
      captured = { executable, args };
      return { stdout: '5' };
    };
    await runMeasurement({ measurementCommand: 'npm test 2>&1 | tail -1', cwd: CWD } as AutoResearchConfig, execFn);
    assert.ok(captured, 'execFn called');
    // The whole command is handed to the shell as a single argument, not split into argv tokens.
    assert.ok(captured!.args.includes('npm test 2>&1 | tail -1'), 'full command passed to shell');
    const shellish = /sh$|cmd\.exe$/i.test(captured!.executable);
    assert.ok(shellish, `executable should be a shell, got ${captured!.executable}`);
  });

  it('keeps the safe token-split for a plain command (no shell)', async () => {
    let captured: { executable: string; args: string[] } | null = null;
    const execFn = async (executable: string, args: string[]) => { captured = { executable, args }; return { stdout: '42' }; };
    await runMeasurement({ measurementCommand: 'echo 42', cwd: CWD } as AutoResearchConfig, execFn);
    assert.equal(captured!.executable, 'echo');
    assert.deepEqual(captured!.args, ['42']);
  });
});

// ── command-level: forbidden hypothesis is rejected + rolled back ──────────────

function makeState(): DanteState {
  return { project: 'test', workflowStage: 'tasks', currentPhase: 0, profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {} } as unknown as DanteState;
}

const originalExitCode = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = originalExitCode; });

describe('autoResearch: integrity guard at command level', () => {
  it('rejects a hypothesis that edits the measurement script — no commit, rollback cleans untracked', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    const state = makeState();
    await autoResearch('opt', { time: '30m', measurementCommand: 'node scripts/proof.mjs' }, {
      _loadState: async () => ({ ...state, auditLog: [] } as DanteState),
      _saveState: async () => {},
      _isLLMAvailable: async () => true,
      // The LLM tries to edit the very script the measurement runs — the classic reward-hack. Flip the
      // budget here (called once per experiment, AFTER startTime) so the loop runs exactly one rejected
      // experiment then exits — toggling in _git would poison startTime (gitIsDirty runs first).
      _callLLM: async () => { budgetExpired = true; return '{"description":"optimize proof","fileToChange":"scripts/proof.mjs","change":"node scripts/proof.mjs"}'; },
      _runBaseline: async () => 1,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => ({ id, description: 'x', metricValue: 0, status: 'keep' }),
      _git: async (args: string[]) => { gitCalls.push([...args]); return args[0] === 'status' ? '' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(!gitCalls.some(a => a[0] === 'commit'), 'forbidden experiment must NOT be committed');
    assert.ok(gitCalls.some(a => a[0] === 'reset'), 'forbidden experiment is rolled back');
  });

  it('rolls back tracked changes when an ordinary experiment is discarded', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    const state = makeState();
    await autoResearch('opt', { time: '30m', measurementCommand: 'echo 0' }, {
      _loadState: async () => ({ ...state, auditLog: [] } as DanteState),
      _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => '{"description":"x","fileToChange":"","change":""}',
      _runBaseline: async () => 50,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => { budgetExpired = true; return { id, description: 'x', metricValue: 200, status: 'discard' }; },
      _git: async (args: string[]) => { gitCalls.push([...args]); return args[0] === 'status' ? '' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {},
      _isAgentEditAvailable: async () => false,
      _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(gitCalls.some(a => a[0] === 'reset'), 'discard resets tracked changes');
  });
});

// ── targeted untracked cleanup — never delete pre-existing files (DanteCode --allow-dirty collateral) ──

describe('gitUntracked', () => {
  it('returns only untracked (??) paths, excluding tracked changes and .danteforge', async () => {
    const gitFn = async () => '?? a.py\n M src/x.ts\n?? sub/b.py\n?? .danteforge/autoresearch/results.tsv\n';
    const set = await gitUntracked('/proj', gitFn);
    assert.deepEqual([...set].sort(), ['a.py', 'sub/b.py']);
  });
});

describe('gitCleanCreatedUntracked', () => {
  it('cleans ONLY files that appeared after the pre-experiment snapshot', async () => {
    const calls: string[][] = [];
    // Post-rollback the tree has a pre-existing file (keep.py) AND a new one (junk.py).
    const gitFn = async (args: string[]) => { calls.push([...args]); return args[0] === 'status' ? '?? keep.py\n?? junk.py\n' : ''; };
    await gitCleanCreatedUntracked('/proj', new Set(['keep.py']), gitFn);
    const clean = calls.find(a => a[0] === 'clean');
    assert.ok(clean, 'git clean was invoked');
    assert.deepEqual(clean, ['clean', '-fd', '--', 'junk.py'], 'only the experiment-created file is cleaned — keep.py is spared');
  });

  it('does NOT invoke git clean when the experiment created nothing', async () => {
    const calls: string[][] = [];
    const gitFn = async (args: string[]) => { calls.push([...args]); return args[0] === 'status' ? '?? keep.py\n' : ''; };
    await gitCleanCreatedUntracked('/proj', new Set(['keep.py']), gitFn);
    assert.ok(!calls.some(a => a[0] === 'clean'), 'pre-existing untracked files are never cleaned');
  });
});
