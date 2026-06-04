// autoresearch-edit.test.ts — Tier 1 anchored hypothesis apply + Tier 2 coding-agent dispatch.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AutoResearchConfig, ExperimentResult } from '../src/core/autoresearch-engine.js';
import { generateHypothesis, applyHypothesis, type Hypothesis } from '../src/cli/commands/autoresearch-hypothesis.js';
import { dispatchAgentEdit } from '../src/cli/commands/autoresearch-agent-edit.js';
import { autoResearch } from '../src/cli/commands/autoresearch.js';
import type { DanteState } from '../src/core/state.js';

const CWD = process.platform === 'win32' ? 'C:\\proj' : '/proj';
const cfg = (over: Partial<AutoResearchConfig> = {}): AutoResearchConfig =>
  ({ goal: 'g', metric: 'm', timeBudgetMinutes: 1, measurementCommand: 'node scripts/proof.mjs', cwd: CWD, ...over });

// In-memory fs seam for applyHypothesis.
function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    readFile: async (p: string) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p)!; },
    writeFile: async (p: string, c: string) => { files.set(p, c); },
    mkdir: async () => {},
    exists: async (p: string) => files.has(p),
  };
}

// ── applyHypothesis: anchored edits ───────────────────────────────────────────

describe('applyHypothesis — anchored edits', () => {
  const target = process.platform === 'win32' ? 'C:\\proj\\src\\a.ts' : '/proj/src/a.ts';

  it('applies an anchored edit when the anchor exists', async () => {
    const fs = fakeFs({ [target]: 'const x = 1;\n' });
    const h: Hypothesis = { description: 'd', fileToChange: 'src/a.ts', edits: [{ find: 'const x = 1;', replace: 'const x = 2;' }] };
    const r = await applyHypothesis(h, CWD, fs);
    assert.equal(r.applied, true);
    assert.deepEqual(r.changedFiles, ['src/a.ts']);
    assert.equal(fs.files.get(target), 'const x = 2;\n');
  });

  it('rejects when the anchor text is not present (no blind hallucination)', async () => {
    const fs = fakeFs({ [target]: 'const x = 1;\n' });
    const h: Hypothesis = { description: 'd', fileToChange: 'src/a.ts', edits: [{ find: 'NOT THERE', replace: 'y' }] };
    const r = await applyHypothesis(h, CWD, fs);
    assert.equal(r.applied, false);
    assert.match(r.rejectReason ?? '', /anchor not found/);
  });

  it('rejects anchored edits against a non-existent file', async () => {
    const fs = fakeFs();
    const h: Hypothesis = { description: 'd', fileToChange: 'src/a.ts', edits: [{ find: 'x', replace: 'y' }] };
    const r = await applyHypothesis(h, CWD, fs);
    assert.equal(r.applied, false);
    assert.match(r.rejectReason ?? '', /non-existent file/);
  });

  it('refuses to overwrite an EXISTING file with whole-file content', async () => {
    const fs = fakeFs({ [target]: 'real 468-line file' });
    const h: Hypothesis = { description: 'd', fileToChange: 'src/a.ts', change: 'tiny stub' };
    const r = await applyHypothesis(h, CWD, fs);
    assert.equal(r.applied, false);
    assert.match(r.rejectReason ?? '', /refusing to overwrite/);
    assert.equal(fs.files.get(target), 'real 468-line file', 'original file untouched');
  });

  it('allows whole-file content to CREATE a new file', async () => {
    const fs = fakeFs();
    const h: Hypothesis = { description: 'd', fileToChange: 'src/new.ts', change: 'export const ok = true;' };
    const r = await applyHypothesis(h, CWD, fs);
    assert.equal(r.applied, true);
    assert.deepEqual(r.changedFiles, ['src/new.ts']);
  });

  it('treats an empty fileToChange as a no-op', async () => {
    const r = await applyHypothesis({ description: 'd', fileToChange: '' }, CWD, fakeFs());
    assert.equal(r.applied, true);
    assert.deepEqual(r.changedFiles, []);
  });
});

// ── generateHypothesis: grounding + rejection feedback ────────────────────────

describe('generateHypothesis — grounding', () => {
  it('feeds rejection notes and the capability_test source into the prompt, and requests anchored edits', async () => {
    let prompt = '';
    const callLLM = async (p: string) => { prompt = p; return '{"description":"d","fileToChange":"src/a.ts","edits":[{"find":"a","replace":"b"}]}'; };
    // readFileFn returns source for the proof script, throws for program.md.
    const readFile = async (p: string) => { if (p.includes('proof.mjs')) return 'assert(real === expected)'; throw new Error('no'); };
    const rejections = ['scripts/proof.mjs is the yardstick'];
    const h = await generateHypothesis(cfg(), 3, [], rejections, callLLM, readFile);
    assert.ok(h.edits?.length, 'returns anchored edits');
    assert.match(prompt, /DO NOT repeat these rejected attempts/);
    assert.match(prompt, /scripts\/proof\.mjs is the yardstick/);
    assert.match(prompt, /assert\(real === expected\)/, 'includes capability_test source');
    assert.match(prompt, /"edits"/, 'asks for anchored edits');
  });

  it('falls back to a safe no-op hypothesis on unparseable JSON', async () => {
    const h = await generateHypothesis(cfg(), 1, [], [], async () => 'not json at all', async () => { throw new Error('no'); });
    assert.equal(h.fileToChange, '');
  });
});

// ── dispatchAgentEdit: Tier 2 adapter dispatch ────────────────────────────────

describe('dispatchAgentEdit', () => {
  const prev: ExperimentResult[] = [];

  it('reports a clean reject when no coding-agent CLI is available', async () => {
    const r = await dispatchAgentEdit(cfg(), 1, ['scripts/proof.mjs'], prev,
      (async () => { throw new Error('should not run'); }) as never,
      async () => null);
    assert.equal(r.ranOk, false);
    assert.match(r.rejectReason ?? '', /no coding-agent/);
  });

  it('dispatches the adapter and embeds the forbidden yardstick + goal in the objective', async () => {
    let objective = '';
    const fakeAdapter = { id: 'fake-claude' } as never;
    const resolve = async (wp: { objective: string }) => { objective = wp.objective; return fakeAdapter; };
    let ranWith: unknown = null;
    const run = (async (_a: unknown, input: unknown) => { ranWith = input; return { finalMessage: 'done' }; }) as never;
    const r = await dispatchAgentEdit(cfg({ goal: 'speed up' }), 7, ['scripts/proof.mjs'], prev, run, resolve as never);
    assert.equal(r.ranOk, true);
    assert.match(r.description, /fake-claude/);
    assert.match(objective, /speed up/);
    assert.match(objective, /scripts\/proof\.mjs/, 'yardstick is forbidden in the agent prompt');
    assert.ok(ranWith && typeof ranWith === 'object' && 'lease' in (ranWith as object), 'runAdapter received a lease');
  });

  it('returns a reject (never throws) when the adapter dispatch fails', async () => {
    const r = await dispatchAgentEdit(cfg(), 1, [], prev,
      (async () => { throw new Error('claude crashed'); }) as never,
      async () => ({ id: 'fake' } as never));
    assert.equal(r.ranOk, false);
    assert.match(r.rejectReason ?? '', /agent dispatch failed/);
  });
});

// ── command-level: agent mode drives the loop + the git guard catches yardstick edits ──

const makeState = (): DanteState => ({ project: 't', workflowStage: 'tasks', currentPhase: 0, profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {} } as unknown as DanteState);

describe('autoResearch — agent mode integration', () => {
  it('selects the agent path and commits a clean (.ts) change it made', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false, dispatched = 0;
    await autoResearch('opt', { time: '30m', measurementCommand: 'node scripts/proof.mjs', allowDirty: true }, {
      _loadState: async () => makeState(), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => "- insight",
      _isAgentEditAvailable: async () => true,
      _dispatchAgentEdit: async (_c, id) => { dispatched++; budgetExpired = true; return { description: `agent exp ${id}`, ranOk: true }; },
      _runBaseline: async () => 100,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => ({ id, description: 'x', metricValue: 50, status: 'keep' }),
      _git: async (args: string[]) => { gitCalls.push([...args]); return args[0] === 'status' ? ' M src/feature.ts' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {}, _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(dispatched >= 1, 'coding agent was dispatched');
    assert.ok(gitCalls.some(a => a[0] === 'commit'), 'a kept clean change is committed');
  });

  it('runs the agent path even when NO json-provider LLM is available (claude/codex uses its own auth)', async () => {
    let dispatched = 0, budgetExpired = false;
    await autoResearch('opt', { time: '30m', measurementCommand: 'node scripts/proof.mjs', allowDirty: true }, {
      _loadState: async () => makeState(), _saveState: async () => {},
      _isLLMAvailable: async () => false, // no Ollama / API key configured
      _isAgentEditAvailable: async () => true,
      _dispatchAgentEdit: async (_c, id) => { dispatched++; budgetExpired = true; return { description: `agent exp ${id}`, ranOk: true }; },
      _runBaseline: async () => 100,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => ({ id, description: 'x', metricValue: 50, status: 'keep' }),
      _git: async (args: string[]) => (args[0] === 'status' ? '' : 'abc1234'),
      _writeFile: async () => {}, _appendFile: async () => {}, _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(dispatched >= 1, 'agent ran without a configured json LLM — did not abort "No LLM available"');
  });

  it('stages ONLY the experiment path on keep — never git add -A, never pre-existing untracked', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    // Tree has a pre-existing untracked file (LEGACY.txt) plus the agent's tracked edit (src/feature.ts).
    await autoResearch('opt', { time: '30m', measurementCommand: 'node scripts/proof.mjs', allowDirty: true }, {
      _loadState: async () => makeState(), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _isAgentEditAvailable: async () => true,
      _dispatchAgentEdit: async (_c, id) => { budgetExpired = true; return { description: `agent exp ${id}`, ranOk: true }; },
      _runBaseline: async () => 100,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => ({ id, description: 'x', metricValue: 50, status: 'keep' }),
      _git: async (args: string[]) => { gitCalls.push([...args]); return args[0] === 'status' ? ' M src/feature.ts\n?? LEGACY.txt' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {}, _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    const add = gitCalls.find(a => a[0] === 'add');
    assert.ok(add, 'git add was called with an explicit pathspec');
    assert.ok(!add!.includes('-A'), 'must not be git add -A');
    assert.ok(add!.includes('src/feature.ts'), 'stages the experiment edit');
    assert.ok(!add!.includes('LEGACY.txt'), 'never stages the pre-existing untracked file');
  });

  it('rejects (no commit) when the agent touches the yardstick — git guard catches it', async () => {
    const gitCalls: string[][] = [];
    let budgetExpired = false;
    await autoResearch('opt', { time: '30m', measurementCommand: 'node scripts/proof.mjs', allowDirty: true }, {
      _loadState: async () => makeState(), _saveState: async () => {},
      _isLLMAvailable: async () => true,
      _callLLM: async () => "- insight",
      _isAgentEditAvailable: async () => true,
      // The agent ran fine but edited the measurement script itself — the git guard must catch it.
      _dispatchAgentEdit: async (_c, id) => { budgetExpired = true; return { description: `agent exp ${id}`, ranOk: true }; },
      _runBaseline: async () => 1,
      _runExperiment: async (_c, id): Promise<ExperimentResult> => ({ id, description: 'x', metricValue: 0, status: 'keep' }),
      _git: async (args: string[]) => { gitCalls.push([...args]); return args[0] === 'status' ? ' M scripts/proof.mjs' : 'abc1234'; },
      _writeFile: async () => {}, _appendFile: async () => {}, _now: () => budgetExpired ? 31 * 60 * 1000 : 0,
    });
    assert.ok(!gitCalls.some(a => a[0] === 'commit'), 'a yardstick edit is never committed');
    assert.ok(gitCalls.some(a => a[0] === 'reset'), 'the rejected experiment is rolled back');
  });
});
