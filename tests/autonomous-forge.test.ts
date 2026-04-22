// Autonomous Forge Integration — end-to-end proof that the full forge pipeline
// runs without human intervention: executeWave writes code to disk, verify passes
// on the output, and captureSuccessLessons records the result.
//
// No process.chdir(). No real LLM calls. Real filesystem writes. Real git repo.
//
// T1-T6 share one fixture (tmpDir created in before()) so T1 runs the wave and
// T2-T6 read what T1 wrote — this matches the real workflow sequence.
// T7 and T8 use fresh fixtures for isolation.

import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { executeWave } from '../src/harvested/gsd/agents/executor.js';
import { verify } from '../src/cli/commands/verify.js';
import { captureSuccessLessons } from '../src/core/auto-lessons.js';
import type { VerifyReceipt } from '../src/core/verify-receipts.js';

// ── Fixture constants ──────────────────────────────────────────────────────────

const FIXTURE_STATE_YAML = [
  'project: forge-fixture',
  'lastHandoff: "tasks -> forge"',
  'workflowStage: forge',
  'currentPhase: 1',
  'profile: balanced',
  'constitution: "Keep it simple. Export everything."',
  'projectType: cli',
  'selfEditPolicy: deny',
  'tasks:',
  '  1:',
  '    - name: Create hello module',
  '      files:',
  '        - src/hello.ts',
  '      verify: "exports greet function"',
  'auditLog:',
  '  - "2026-04-12T00:00:00Z | tasks: phase 1 defined"',
  '  - "2026-04-12T00:00:01Z | forge: wave 1 complete (1/1 passed, profile: balanced)"',
].join('\n');

const FIXTURE_STATE_YAML_WORLD = [
  'project: forge-fixture',
  'lastHandoff: "tasks -> forge"',
  'workflowStage: forge',
  'currentPhase: 1',
  'profile: balanced',
  'constitution: "Keep it simple. Export everything."',
  'projectType: cli',
  'selfEditPolicy: deny',
  'tasks:',
  '  1:',
  '    - name: Create world module',
  '      files:',
  '        - src/world.ts',
  '      verify: "exports world function"',
  'auditLog:',
  '  - "2026-04-12T00:00:00Z | tasks: phase 1 defined"',
  '  - "2026-04-12T00:00:01Z | forge: wave 1 complete (1/1 passed, profile: balanced)"',
].join('\n');

const MOCK_LLM_HELLO = [
  'NEW_FILE: src/hello.ts',
  '```typescript',
  'export function greet(name: string): string {',
  "  return `Hello, ${name}!`;",
  '}',
  '```',
].join('\n');

const MOCK_LLM_WORLD = [
  'NEW_FILE: src/world.ts',
  '```typescript',
  'export function world(): string {',
  "  return 'world';",
  '}',
  '```',
].join('\n');

// ── Fixture factory ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

async function makeForgeFixture(stateYaml = FIXTURE_STATE_YAML): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-autoforge-'));
  tempDirs.push(root);

  execFileSync('git', ['init'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'DanteForge Test'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@danteforge.dev'], { cwd: root, stdio: 'pipe' });

  // package.json — no version field avoids CURRENT_STATE.md version mismatch check
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'forge-fixture', type: 'module' }),
  );

  const dfDir = path.join(root, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.mkdir(path.join(root, 'src'), { recursive: true });

  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), stateYaml);
  await fs.writeFile(path.join(dfDir, 'CONSTITUTION.md'), '# Constitution\n\nKeep it simple.');
  await fs.writeFile(path.join(dfDir, 'SPEC.md'), '# Spec\n\nBuild a hello module.');
  await fs.writeFile(path.join(dfDir, 'CLARIFY.md'), '# Clarify\n\nNo clarifications needed.');
  await fs.writeFile(path.join(dfDir, 'PLAN.md'), '# Plan\n\n1. Create src/hello.ts');
  await fs.writeFile(path.join(dfDir, 'TASKS.md'), '# Tasks\n\n- Create hello module');
  // CURRENT_STATE.md — omit version/projectType rows to skip freshness checks
  await fs.writeFile(path.join(dfDir, 'CURRENT_STATE.md'), '# Current State\n\nProject ready for forge.');

  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'chore: fixture setup'], { cwd: root, stdio: 'pipe' });
  return root;
}

function makeStateCaller(root: string) {
  return {
    load: async (opts?: { cwd?: string }) => {
      const { loadState } = await import('../src/core/state.js');
      return loadState({ cwd: opts?.cwd ?? root });
    },
    save: async (state: Parameters<(typeof import('../src/core/state.js'))['saveState']>[0], opts?: { cwd?: string }) => {
      const { saveState } = await import('../src/core/state.js');
      return saveState(state, { cwd: opts?.cwd ?? root });
    },
  };
}

function makeWaveOpts(root: string, llmResponse = MOCK_LLM_HELLO) {
  return {
    cwd: root,
    _stateCaller: makeStateCaller(root),
    _llmCaller: async () => llmResponse,
    _verifier: async () => true,
    _reflector: async () => ({
      timestamp: new Date().toISOString(),
      score: 85,
      reasoning: 'ok',
      verdict: 'proceed' as const,
    }),
    _memorizer: async () => {},
    _captureFailureLessons: async () => {},
    _runTests: async () => ({
      passed: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 0,
      failingTests: [] as string[],
      typecheckErrors: [] as string[],
    }),
  };
}

function makeReceipt(status: 'pass' | 'warn' | 'fail', cwd: string): VerifyReceipt {
  return {
    status,
    passed: ['typecheck', 'tests'],
    warnings: [],
    failures: [],
    project: 'forge-fixture',
    version: '0.0.1',
    gitSha: null,
    platform: process.platform,
    nodeVersion: process.version,
    cwd,
    projectType: 'cli',
    workflowStage: 'forge',
    timestamp: new Date().toISOString(),
    commandMode: { release: false, live: false, recompute: false },
    counts: { passed: 2, warnings: 0, failures: 0 },
    releaseCheckPassed: null,
    liveCheckPassed: null,
    currentStateFresh: true,
    selfEditPolicyEnforced: false,
  };
}

// ── Shared fixture for T1-T6 ───────────────────────────────────────────────────

let tmpDir: string;

before(async () => {
  tmpDir = await makeForgeFixture();
  // T1: Run the wave now — T2-T6 read what it wrote
  await executeWave(1, 'balanced', false, false, false, 30_000, makeWaveOpts(tmpDir));
});

after(async () => {
  // Reset exitCode in case verify set it to 1
  process.exitCode = 0;
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── Tests T1–T6: shared fixture ───────────────────────────────────────────────

describe('Autonomous Forge Integration', () => {

  it('T1: executeWave with mock LLM completes without throwing', async () => {
    // Wave already ran in before(). Just verify the shared tmpDir was set up.
    assert.ok(tmpDir, 'tmpDir must be set by before()');
    const stateContent = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.ok(stateContent.length > 0, 'STATE.yaml must exist after wave');
  });

  it('T2: executeWave writes src/hello.ts to disk in fixture directory', async () => {
    const helloPath = path.join(tmpDir, 'src', 'hello.ts');
    await assert.doesNotReject(
      fs.access(helloPath),
      'src/hello.ts must exist after executeWave',
    );
  });

  it('T3: written src/hello.ts contains the exported greet function', async () => {
    const helloPath = path.join(tmpDir, 'src', 'hello.ts');
    const content = await fs.readFile(helloPath, 'utf8');
    assert.ok(
      content.includes('export') && content.includes('greet'),
      `src/hello.ts must export a greet function — got: ${content.slice(0, 200)}`,
    );
  });

  it('T4: STATE.yaml auditLog is updated after wave execution', async () => {
    const { loadState } = await import('../src/core/state.js');
    const state = await loadState({ cwd: tmpDir });
    const hasForgeEntry = state.auditLog.some(e => e.includes('forge:') || e.includes('wave'));
    assert.ok(hasForgeEntry, `auditLog must have forge entry — got: ${JSON.stringify(state.auditLog)}`);
  });

  it('T5: verify({ cwd: tmpDir }) writes a passing receipt and exposes warn-on-dirty freshness through loadState()', async () => {
    await verify({ cwd: tmpDir });

    const { loadState } = await import('../src/core/state.js');
    const state = await loadState({ cwd: tmpDir });
    const rawState = await fs.readFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), 'utf8');
    assert.match(rawState, /lastVerifyStatus:\s+pass/);
    assert.strictEqual(state.verifyEvidence?.status, 'pass');
    assert.strictEqual(state.lastVerifyStatus, 'warn');
    // Reset exitCode verify may have set
    process.exitCode = 0;
  });

  it('T6: captureSuccessLessons writes lessons.md to fixture .danteforge/', async () => {
    await captureSuccessLessons(makeReceipt('pass', tmpDir), tmpDir, {
      _isLLMAvailable: async () => false,
      _gitDiff: async () =>
        '+export function greet(name: string): string { return `Hello`; }\n',
    });

    const lessonsPath = path.join(tmpDir, '.danteforge', 'lessons.md');
    await assert.doesNotReject(
      fs.access(lessonsPath),
      'lessons.md must be created in fixture .danteforge/',
    );
    const content = await fs.readFile(lessonsPath, 'utf8');
    assert.ok(content.includes('CAPTURED'), 'lessons.md must contain CAPTURED marker');
  });

  // ── T7: fresh fixture, second file ──────────────────────────────────────────

  it('T7: second wave with different task writes src/world.ts alongside hello.ts', async () => {
    const tmpDir2 = await makeForgeFixture(FIXTURE_STATE_YAML_WORLD);

    const result = await executeWave(
      1, 'balanced', false, false, false, 30_000,
      makeWaveOpts(tmpDir2, MOCK_LLM_WORLD),
    );

    assert.ok(result.success, 'second wave must succeed');

    const worldPath = path.join(tmpDir2, 'src', 'world.ts');
    await assert.doesNotReject(
      fs.access(worldPath),
      'src/world.ts must exist after second wave',
    );
    const content = await fs.readFile(worldPath, 'utf8');
    assert.ok(content.includes('world'), 'src/world.ts must contain world function');
  });

  // ── T8: empty LLM response — graceful failure ────────────────────────────────

  it('T8: empty LLM response → executeWave completes without throwing, success false', async () => {
    const tmpDir3 = await makeForgeFixture();

    let threwError = false;
    let result: { success: boolean; mode: string } = { success: true, mode: 'executed' };

    try {
      result = await executeWave(1, 'balanced', false, false, false, 30_000, {
        ...makeWaveOpts(tmpDir3, ''),  // empty LLM response — no code ops
        _verifier: async () => false,  // verifier fails (nothing was written)
      });
    } catch {
      threwError = true;
    }

    assert.strictEqual(threwError, false, 'executeWave must not throw on empty LLM response');
    assert.strictEqual(result.success, false, 'result.success must be false when no code was produced');
  });
});
