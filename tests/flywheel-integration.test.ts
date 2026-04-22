// Flywheel Integration — end-to-end proof that the self-improvement loop turns
// with real git I/O. No process.chdir(). No LLM calls.
//
// Each test gets an isolated temp git repo via makeGitRepo().
// captureSuccessLessons() is called with only _isLLMAvailable injected (forces
// deterministic path). All other deps (git diff, appendLesson) are real.
//
// Tests prove:
//   1. Disk changes are detected by git diff HEAD
//   2. Lessons are written to .danteforge/lessons.md in the right directory
//   3. Those lessons are read back by injectRelevantLessons(prompt, maxLessons, cwd)
//   4. The full write → capture → inject cycle produces enriched prompts

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { captureSuccessLessons } from '../src/core/auto-lessons.js';
import { injectRelevantLessons } from '../src/core/lessons-index.js';
import type { VerifyReceipt } from '../src/core/verify-receipts.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()!;
    await fs.rm(root, { recursive: true, force: true });
  }
});

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${r.stderr}`);
}

async function makeGitRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-flywheel-'));
  tempRoots.push(root);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'DanteForge Test']);
  git(root, ['config', 'user.email', 'test@danteforge.dev']);
  await fs.writeFile(path.join(root, 'README.md'), '# Test\n', 'utf8');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'chore: initial']);
  return root;
}

function makeReceipt(status: 'pass' | 'warn' | 'fail'): VerifyReceipt {
  return {
    status,
    passed: ['typecheck', 'tests'],
    warnings: [],
    failures: [],
    project: 'flywheel-test',
    version: '0.0.1',
    gitSha: 'abc123',
    platform: process.platform,
    nodeVersion: process.version,
    cwd: '/tmp/flywheel-test',
    projectType: 'cli',
    workflowStage: 'verify',
    timestamp: new Date().toISOString(),
    commandMode: { release: false, live: false, recompute: false },
    counts: { passed: 2, warnings: 0, failures: 0 },
    releaseCheckPassed: null,
    liveCheckPassed: null,
    currentStateFresh: true,
    selfEditPolicyEnforced: false,
  };
}

const lessonsPath = (d: string) => path.join(d, '.danteforge', 'lessons.md');

async function lessonsExist(d: string): Promise<boolean> {
  return fs.access(lessonsPath(d)).then(() => true).catch(() => false);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Flywheel Integration — captureSuccessLessons with real git', () => {

  it('T1: new exported function (staged) → captured >= 1 and lessons.md is created', async () => {
    const tmpDir = await makeGitRepo();

    await fs.writeFile(
      path.join(tmpDir, 'helper.ts'),
      'export function myNewHelper(x: number): number { return x * 2; }\n',
      'utf8',
    );
    // Mirrors the forge skill workflow: git add -A before verify
    git(tmpDir, ['add', '.']);

    const result = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    assert.ok(result.captured >= 1, `expected captured >= 1, got ${result.captured}`);
    assert.ok(await lessonsExist(tmpDir), 'lessons.md must be created in the project temp dir');
  });

  it('T2: lessons.md content contains "CAPTURED — deterministic" marker', async () => {
    const tmpDir = await makeGitRepo();

    await fs.writeFile(
      path.join(tmpDir, 'util.ts'),
      'export function computeScore(): number { return 100; }\n',
      'utf8',
    );
    git(tmpDir, ['add', '.']);

    await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    const content = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(
      content.includes('CAPTURED — deterministic'),
      'lessons.md must contain the deterministic CAPTURED marker',
    );
  });

  it('T3: lessons.md references the exported function name from the diff', async () => {
    const tmpDir = await makeGitRepo();

    await fs.writeFile(
      path.join(tmpDir, 'feature.ts'),
      'export function buildFlywheelWidget(): void {}\n',
      'utf8',
    );
    git(tmpDir, ['add', '.']);

    await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    const content = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(
      content.includes('buildFlywheelWidget'),
      'lessons.md must reference the exported function name',
    );
  });

  it('T4: second capture call appends to lessons.md (does not overwrite)', async () => {
    const tmpDir = await makeGitRepo();

    // First change + capture
    await fs.writeFile(
      path.join(tmpDir, 'first.ts'),
      'export function firstExport(): string { return "a"; }\n',
      'utf8',
    );
    git(tmpDir, ['add', '.']);
    const r1 = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });
    assert.ok(r1.captured >= 1, 'first capture must record a lesson');

    const after1 = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    const countAfter1 = (after1.match(/CAPTURED — deterministic/g) ?? []).length;

    // Commit the first change so git diff HEAD is clean for Strategy 1
    git(tmpDir, ['add', 'first.ts']);
    git(tmpDir, ['commit', '-m', 'feat: first export']);

    // Second change + capture
    await fs.writeFile(
      path.join(tmpDir, 'second.ts'),
      'export function secondExport(): number { return 42; }\n',
      'utf8',
    );
    const r2 = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });
    assert.ok(r2.captured >= 1, 'second capture must record a lesson');

    const after2 = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    const countAfter2 = (after2.match(/CAPTURED — deterministic/g) ?? []).length;

    assert.ok(
      countAfter2 > countAfter1,
      `second capture must append (count ${countAfter1} → ${countAfter2})`,
    );
  });

  it('T5: staged changes (git add, no commit) are captured by git diff HEAD', async () => {
    const tmpDir = await makeGitRepo();

    // Write and stage a file with an exported function
    await fs.writeFile(
      path.join(tmpDir, 'staged.ts'),
      'export function stagedFunction(): boolean { return true; }\n',
      'utf8',
    );
    git(tmpDir, ['add', 'staged.ts']);

    const result = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    assert.ok(result.captured >= 1, 'staged export must be captured');
    const content = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(
      content.includes('stagedFunction'),
      'lesson must reference the staged export name',
    );
  });

  it('T6: committed changes (clean working tree) are captured via HEAD~1 HEAD strategy', async () => {
    const tmpDir = await makeGitRepo();

    // Write, stage, and commit — working tree is clean after this
    await fs.writeFile(
      path.join(tmpDir, 'committed.ts'),
      'export function committedExport(): string { return "committed"; }\n',
      'utf8',
    );
    git(tmpDir, ['add', 'committed.ts']);
    git(tmpDir, ['commit', '-m', 'feat: committed export']);
    // Now: git diff HEAD = empty, git diff --cached = empty,
    //      git diff HEAD~1 HEAD = shows the committed change

    const result = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    assert.ok(result.captured >= 1, 'committed export must be captured via HEAD~1 HEAD strategy');
    const content = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(
      content.includes('committedExport'),
      'lesson must reference the committed export name',
    );
  });

  it('T7: fail receipt → captured: 0 and lessons.md is NOT created', async () => {
    const tmpDir = await makeGitRepo();

    await fs.writeFile(
      path.join(tmpDir, 'fail-case.ts'),
      'export function failedExport(): void {}\n',
      'utf8',
    );

    const result = await captureSuccessLessons(makeReceipt('fail'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    assert.strictEqual(result.captured, 0, 'fail receipt must produce captured: 0');
    assert.strictEqual(
      await lessonsExist(tmpDir),
      false,
      'lessons.md must NOT be created for a fail receipt',
    );
  });

  it('T8: injection seam pattern (_callFn?:) in diff → architecture lesson captured', async () => {
    const tmpDir = await makeGitRepo();

    await fs.writeFile(
      path.join(tmpDir, 'injectable.ts'),
      [
        'export interface MyOpts {',
        '  _callFn?: () => Promise<string>;',
        '  _logger?: (msg: string) => void;',
        '}',
        'export async function doWork(opts: MyOpts = {}): Promise<string> {',
        '  return (opts._callFn ?? defaultFn)();',
        '}',
        'async function defaultFn(): Promise<string> { return ""; }',
        '',
      ].join('\n'),
      'utf8',
    );
    git(tmpDir, ['add', '.']);

    const result = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    assert.ok(result.captured >= 1, 'injection seam pattern must trigger a lesson');
    const content = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    // The architecture lesson uses one of: "injection", "underscore", "testab"
    const hasArchitectureLesson =
      content.includes('injection') ||
      content.includes('underscore') ||
      content.includes('testab') ||
      content.includes('optional');
    assert.ok(hasArchitectureLesson, 'lesson must describe the injection seam pattern');
  });

  it('T9: captured lessons are read back by injectRelevantLessons with cwd param', async () => {
    const tmpDir = await makeGitRepo();

    // Write a file with a new exported function (then stage it, matching forge workflow)
    await fs.writeFile(
      path.join(tmpDir, 'api.ts'),
      'export function buildApiClient(): object { return {}; }\n',
      'utf8',
    );
    git(tmpDir, ['add', '.']);
    await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });

    // Verify lessons.md was written before attempting injection
    const lessonContent = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(lessonContent.length > 0, 'lessons.md must have content before inject test');

    // Inject — pass tmpDir as cwd so it reads from the isolated project directory
    const basePrompt = 'Build a new module with export functions and proper module boundary';
    const enriched = await injectRelevantLessons(basePrompt, 5, tmpDir);

    assert.notStrictEqual(enriched, basePrompt, 'prompt must be enriched with lesson content');
    assert.ok(
      enriched.includes('Lessons Learned'),
      'enriched prompt must contain the auto-injected Lessons Learned section',
    );
  });

  it('T10: full flywheel cycle — write export → capture → inject → prompt is enriched', async () => {
    const tmpDir = await makeGitRepo();

    // Step 1: Write source file (simulates forge AI using Edit/Write) + stage (git add -A)
    await fs.writeFile(
      path.join(tmpDir, 'flywheel.ts'),
      'export function flywheelProof(): boolean { return true; }\n',
      'utf8',
    );
    git(tmpDir, ['add', '.']);

    // Step 2: Capture (simulates post-verify hook)
    const captureResult = await captureSuccessLessons(makeReceipt('pass'), tmpDir, {
      _isLLMAvailable: async () => false,
    });
    assert.ok(captureResult.captured >= 1, 'Step 2: capture must record at least one lesson');

    // Step 3: Confirm the lesson file contains the right content
    const rawLessons = await fs.readFile(lessonsPath(tmpDir), 'utf8');
    assert.ok(rawLessons.includes('flywheelProof'), 'Step 3: lesson must name the exported function');
    assert.ok(rawLessons.includes('CAPTURED — deterministic'), 'Step 3: must be marked as deterministic CAPTURED');

    // Step 4: Inject into the next forge prompt (simulates next forge cycle reading lessons)
    const nextForgePrompt = 'Implement a new export function for the flywheel module and architecture';
    const enrichedPrompt = await injectRelevantLessons(nextForgePrompt, 5, tmpDir);

    // Step 5: Verify flywheel turned — prompt is enriched
    assert.notStrictEqual(enrichedPrompt, nextForgePrompt, 'Step 5: prompt must be enriched');
    assert.ok(
      enrichedPrompt.includes('Lessons Learned'),
      'Step 5: enriched prompt must contain the auto-injected Lessons Learned section',
    );
    assert.ok(
      enrichedPrompt.length > nextForgePrompt.length,
      'Step 5: enriched prompt must be longer than the base prompt',
    );
  });
});
