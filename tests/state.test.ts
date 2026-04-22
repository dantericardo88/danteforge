import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { loadState, saveState, appendScoreHistory } from '../src/core/state.js';
import type { DanteState, ScoreHistoryEntry } from '../src/core/state.js';

describe('state management', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('loads state with all required fields', async () => {
    const state = await loadState({ cwd: tmpDir });
    assert.strictEqual(typeof state.project, 'string');
    assert.strictEqual(typeof state.lastHandoff, 'string');
    assert.strictEqual(typeof state.workflowStage, 'string');
    assert.strictEqual(typeof state.currentPhase, 'number');
    assert.ok(typeof state.tasks === 'object');
    assert.ok(Array.isArray(state.auditLog));
    assert.strictEqual(typeof state.profile, 'string');
  });

  it('round-trips state through save and load', async () => {
    const state = await loadState({ cwd: tmpDir });
    const marker = `test-roundtrip-${Date.now()}`;
    state.auditLog.push(marker);
    await saveState(state, { cwd: tmpDir });

    const reloaded = await loadState({ cwd: tmpDir });
    assert.ok(reloaded.auditLog.includes(marker));
  });

  it('preserves optional fields through save/load', async () => {
    const state = await loadState({ cwd: tmpDir });
    state.tddEnabled = true;
    state.lightMode = false;
    await saveState(state, { cwd: tmpDir });

    const reloaded = await loadState({ cwd: tmpDir });
    assert.strictEqual(reloaded.tddEnabled, true);
    assert.strictEqual(reloaded.lightMode, false);
  });

  it('derives the project name from package.json when present', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'battle-station' }, null, 2),
      'utf8',
    );

    const state = await loadState({ cwd: tmpDir });
    assert.strictEqual(state.project, 'battle-station');
  });

  it('defaults workflowStage to initialized for a new workspace', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-fresh-'));
    try {
      const state = await loadState({ cwd: freshDir });
      assert.strictEqual(state.workflowStage, 'initialized');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('reconciles stale workflowStage values upward when receipt or artifact evidence is newer', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-stage-'));
    try {
      const stateDir = path.join(freshDir, '.danteforge');
      const verifyDir = path.join(stateDir, 'evidence', 'verify');
      await fs.mkdir(verifyDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, 'TASKS.md'), '# TASKS.md\n', 'utf8');
      await fs.writeFile(
        path.join(stateDir, 'STATE.yaml'),
        [
          'project: stage-reconcile-test',
          'lastHandoff: clarify -> next',
          'workflowStage: clarify',
          'currentPhase: 0',
          'tasks: {}',
          'auditLog: []',
          'profile: balanced',
        ].join('\n'),
        'utf8',
      );
      await fs.writeFile(
        path.join(verifyDir, 'latest.json'),
        JSON.stringify({
          status: 'pass',
          timestamp: '2026-04-20T00:00:00.000Z',
          gitSha: null,
          currentStateFresh: true,
        }),
        'utf8',
      );

      const state = await loadState({ cwd: freshDir });
      assert.strictEqual(state.workflowStage, 'verify');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('normalizes legacy workflow stage aliases from persisted state', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-legacy-stage-'));
    try {
      const stateDir = path.join(freshDir, '.danteforge');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(
        path.join(stateDir, 'STATE.yaml'),
        [
          'project: legacy-stage-test',
          'lastHandoff: planned -> next',
          'workflowStage: planned',
          'currentPhase: 0',
          'tasks: {}',
          'auditLog: []',
          'profile: balanced',
        ].join('\n'),
        'utf8',
      );

      const state = await loadState({ cwd: freshDir });
      assert.strictEqual(state.workflowStage, 'plan');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });

  it('derives the constitution pointer from CONSTITUTION.md when STATE.yaml is missing it', async () => {
    const freshDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-state-constitution-'));
    try {
      const stateDir = path.join(freshDir, '.danteforge');
      await fs.mkdir(stateDir, { recursive: true });
      await fs.writeFile(path.join(stateDir, 'CONSTITUTION.md'), '# DanteForge Constitution\n', 'utf8');
      await fs.writeFile(
        path.join(stateDir, 'STATE.yaml'),
        [
          'project: constitution-reconcile-test',
          'lastHandoff: constitution -> next',
          'workflowStage: constitution',
          'currentPhase: 0',
          'tasks: {}',
          'auditLog: []',
          'profile: balanced',
        ].join('\n'),
        'utf8',
      );

      const state = await loadState({ cwd: freshDir });
      assert.strictEqual(state.constitution, 'CONSTITUTION.md');
    } finally {
      await fs.rm(freshDir, { recursive: true, force: true });
    }
  });
});

describe('appendScoreHistory', () => {
  function makeState(history?: ScoreHistoryEntry[]): DanteState {
    return {
      project: 'test',
      lastHandoff: new Date().toISOString(),
      workflowStage: 'initialized',
      currentPhase: 0,
      tasks: {},
      auditLog: [],
      profile: 'default',
      scoreHistory: history,
    };
  }

  it('prepends entry and initialises scoreHistory when undefined', () => {
    const state = makeState(undefined);
    const entry: ScoreHistoryEntry = { timestamp: '2026-04-13T00:00:00.000Z', displayScore: 7.4 };
    const next = appendScoreHistory(state, entry);
    assert.ok(Array.isArray(next.scoreHistory));
    assert.strictEqual(next.scoreHistory![0].displayScore, 7.4);
    assert.strictEqual(next.scoreHistory!.length, 1);
  });

  it('trims to maxEntries and does not mutate original state', () => {
    const existing: ScoreHistoryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: `2026-04-0${i + 1}T00:00:00.000Z`,
      displayScore: i + 1,
    }));
    const state = makeState(existing);
    const entry: ScoreHistoryEntry = { timestamp: '2026-04-13T00:00:00.000Z', displayScore: 9.0 };
    const next = appendScoreHistory(state, entry, 4);
    assert.strictEqual(next.scoreHistory!.length, 4);
    assert.strictEqual(next.scoreHistory![0].displayScore, 9.0);
    // original not mutated
    assert.strictEqual(state.scoreHistory!.length, 5);
  });
});
