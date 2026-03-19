import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { getMediumOPString } from './helpers/mock-op.js';

const tempRoots: string[] = [];
const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = path.resolve('src', 'cli', 'index.ts');

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-cli-test-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  tempRoots.push(root);
  return { cwd, home };
}

function runCli(cwd: string, home: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    env: {
      ...process.env,
      DANTEFORGE_HOME: home,
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function createAntigravityFixture(root: string) {
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'react-patterns'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'docs', 'BUNDLES.md'),
    [
      '# Bundles',
      '',
      '### The "Web Wizard" Pack',
      '- [`react-patterns`](../skills/react-patterns/): React patterns.',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'skills', 'react-patterns', 'SKILL.md'),
    '---\nname: react-patterns\ndescription: React patterns.\n---\n\n# React Patterns\n\nUpstream body\n',
    'utf8',
  );
}

async function readProjectFile(cwd: string, relativePath: string) {
  return fs.readFile(path.join(cwd, relativePath), 'utf8');
}

async function writeUIFixture(cwd: string) {
  await fs.mkdir(path.join(cwd, 'src', 'components'), { recursive: true });
  await fs.writeFile(
    path.join(cwd, 'package.json'),
    JSON.stringify({
      name: 'ui-project',
      private: true,
      version: '0.0.0',
      dependencies: {
        react: '^19.0.0',
      },
    }, null, 2),
    'utf8',
  );
  await fs.writeFile(
    path.join(cwd, 'src', 'components', 'App.tsx'),
    'export function App() { return <main>Hello</main>; }\n',
    'utf8',
  );
}

describe('CLI release readiness', () => {
  it('offline specify generates a real SPEC.md artifact', async () => {
    const { cwd, home } = await makeWorkspace();

    const constitutionResult = runCli(cwd, home, ['constitution']);
    assert.strictEqual(constitutionResult.status, 0, constitutionResult.stderr);

    const specifyResult = runCli(cwd, home, ['specify', 'Build offline release flow']);
    assert.strictEqual(specifyResult.status, 0, specifyResult.stderr);
    assert.match(specifyResult.stdout + specifyResult.stderr, /danteforge clarify/i);
    assert.doesNotMatch(specifyResult.stdout + specifyResult.stderr, /danteforge forge 1/i);

    const spec = await readProjectFile(cwd, path.join('.danteforge', 'SPEC.md'));
    assert.match(spec, /# SPEC\.md/);
    assert.match(spec, /Build offline release flow/);
  });

  it('constitution writes a real CONSTITUTION.md artifact and records the workflow stage', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['constitution']);
    assert.strictEqual(result.status, 0, result.stderr);

    const constitution = await readProjectFile(cwd, path.join('.danteforge', 'CONSTITUTION.md'));
    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(constitution, /# DanteForge Constitution/);
    assert.match(state, /workflowStage: constitution/);
  });

  it('offline plan generates a real PLAN.md artifact from the existing spec', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);

    const planResult = runCli(cwd, home, ['plan']);
    assert.strictEqual(planResult.status, 0, planResult.stderr);

    const plan = await readProjectFile(cwd, path.join('.danteforge', 'PLAN.md'));
    assert.match(plan, /# PLAN\.md/);
    assert.match(plan, /Architecture Overview/);
  });

  it('offline tasks generates TASKS.md and stores executable tasks in state', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const tasksResult = runCli(cwd, home, ['tasks']);
    assert.strictEqual(tasksResult.status, 0, tasksResult.stderr);

    const tasks = await readProjectFile(cwd, path.join('.danteforge', 'TASKS.md'));
    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(tasks, /# TASKS\.md/);
    assert.match(tasks, /1\./);
    assert.match(state, /Implement/);
    assert.match(state, /lastHandoff: tasks -> next/);
  });

  it('forge fails closed without a live execution path unless --prompt is explicit', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['tasks']).status, 0);

    const beforeState = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(beforeState, /currentPhase: 1/);

    const forgeResult = runCli(cwd, home, ['forge', '1']);
    assert.notStrictEqual(forgeResult.status, 0);
    assert.match(forgeResult.stdout + forgeResult.stderr, /--prompt|LLM/i);

    await assert.rejects(
      () => fs.readdir(path.join(cwd, '.danteforge', 'prompts')),
      /ENOENT/i,
    );
  });

  it('forge --prompt generates task prompts without advancing the phase', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['tasks']).status, 0);

    const beforeState = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(beforeState, /currentPhase: 1/);

    const forgeResult = runCli(cwd, home, ['forge', '1', '--prompt']);
    assert.strictEqual(forgeResult.status, 0, forgeResult.stderr);

    const afterState = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    const promptDir = path.join(cwd, '.danteforge', 'prompts');
    const promptFiles = await fs.readdir(promptDir);

    assert.match(afterState, /currentPhase: 1/);
    assert.ok(promptFiles.some(file => file.includes('forge-phase1-task1')));
    assert.doesNotMatch(forgeResult.stdout, /Wave 1 complete/);
  });

  it('plan fails closed until clarify has been generated', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);

    const planResult = runCli(cwd, home, ['plan']);
    assert.notStrictEqual(planResult.status, 0);
    assert.match(planResult.stdout + planResult.stderr, /clarify/i);
  });

  it('review is blocked once the workflow has advanced past the review stage', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const reviewResult = runCli(cwd, home, ['review']);
    assert.notStrictEqual(reviewResult.status, 0);
    assert.match(reviewResult.stdout + reviewResult.stderr, /workflow blocked|cannot run 'review'/i);
  });

  it('workflow enforcement still allows explicit light-mode backtracking', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const blockedResult = runCli(cwd, home, ['specify', 'Redo the spec after planning']);
    assert.notStrictEqual(blockedResult.status, 0);
    assert.match(blockedResult.stdout + blockedResult.stderr, /workflow blocked|cannot run 'specify'/i);

    const lightResult = runCli(cwd, home, ['specify', 'Redo the spec after planning', '--light']);
    assert.strictEqual(lightResult.status, 0, lightResult.stderr);
  });

  it('verify exits non-zero when the project is incomplete', async () => {
    const { cwd, home } = await makeWorkspace();

    const verifyResult = runCli(cwd, home, ['verify']);
    assert.notStrictEqual(verifyResult.status, 0);
    assert.match(verifyResult.stdout, /Verification Report/);
  });

  it('verify exposes a release mode from the CLI', async () => {
    const { cwd, home } = await makeWorkspace();

    const verifyHelp = runCli(cwd, home, ['verify', '--help']);
    assert.strictEqual(verifyHelp.status, 0, verifyHelp.stderr);
    assert.match(verifyHelp.stdout, /--release/);
  });

  it('verify fails closed when CURRENT_STATE.md metadata drifts from the real repo state', async () => {
    const { cwd, home } = await makeWorkspace();
    const stateDir = path.join(cwd, '.danteforge');

    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({
        name: 'verify-freshness-test',
        version: '2.0.0',
        type: 'module',
        bin: {
          verifyfresh: 'dist/index.js',
        },
      }, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(stateDir, 'CURRENT_STATE.md'),
      [
        '# CURRENT_STATE.md',
        '> Generated by DanteForge on 2026-03-18T00:00:00.000Z',
        '',
        '## Project Overview',
        '- **Name**: verify-freshness-test',
        '- **Version**: 1.9.0',
        '- **Detected project type**: `web`',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(path.join(stateDir, 'CONSTITUTION.md'), '# DanteForge Constitution\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'SPEC.md'), '# SPEC.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'CLARIFY.md'), '# CLARIFY.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'PLAN.md'), '# PLAN.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'TASKS.md'), '# TASKS.md\n\n## Phase 1\n1. Ship the workflow\n', 'utf8');
    await fs.writeFile(
      path.join(stateDir, 'STATE.yaml'),
      [
        'project: verify-freshness-test',
        'lastHandoff: synthesize -> next (2026-03-18T00:00:00.000Z)',
        'workflowStage: synthesize',
        'currentPhase: 1',
        'tasks:',
        '  "1":',
        '    - name: Ship the workflow',
        'auditLog:',
        '  - "2026-03-18T00:00:00.000Z | forge: wave 1 - shipped"',
        'profile: balanced',
        'constitution: |-',
        '  # DanteForge Constitution',
        '',
      ].join('\n'),
      'utf8',
    );

    const verifyResult = runCli(cwd, home, ['verify']);
    assert.notStrictEqual(verifyResult.status, 0);
    assert.match(verifyResult.stdout + verifyResult.stderr, /CURRENT_STATE\.md version .*1\.9\.0.*2\.0\.0/i);
    assert.match(verifyResult.stdout + verifyResult.stderr, /CURRENT_STATE\.md project type .*web.*cli/i);
  });

  it('ship help is framed as release guidance instead of PR automation', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({ name: 'ship-help-fixture', version: '0.0.1', type: 'module' }, null, 2),
      'utf8',
    );

    const shipHelp = runCli(cwd, home, ['ship', '--help']);
    assert.strictEqual(shipHelp.status, 0, shipHelp.stderr);
    assert.match(shipHelp.stdout, /release guidance|release planning/i);
    assert.doesNotMatch(shipHelp.stdout, /Target branch for PR/i);
    assert.doesNotMatch(shipHelp.stdout, /bisectable commits \+ PR/i);
  });

  it('verify --release succeeds on Windows when npm_execpath is unavailable', async () => {
    if (process.platform !== 'win32') return;

    const { cwd, home } = await makeWorkspace();
    const stateDir = path.join(cwd, '.danteforge');
    const binDir = path.join(cwd, 'bin');

    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'CURRENT_STATE.md'), '# CURRENT_STATE.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'CONSTITUTION.md'), '# DanteForge Constitution\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'SPEC.md'), '# SPEC.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'CLARIFY.md'), '# CLARIFY.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'PLAN.md'), '# PLAN.md\n', 'utf8');
    await fs.writeFile(path.join(stateDir, 'TASKS.md'), '# TASKS.md\n\n## Phase 1\n1. Ship the workflow\n', 'utf8');
    await fs.writeFile(
      path.join(stateDir, 'STATE.yaml'),
      [
        'project: verify-release-test',
        'lastHandoff: synthesize -> next (2026-03-17T00:00:00.000Z)',
        'workflowStage: synthesize',
        'currentPhase: 1',
        'tasks:',
        '  "1":',
        '    - name: Ship the workflow',
        'auditLog:',
        '  - "2026-03-17T00:00:00.000Z | forge: wave 1 - shipped"',
        'profile: balanced',
        'constitution: |-',
        '  # DanteForge Constitution',
        '',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(
      path.join(binDir, 'npm.cmd'),
      [
        '@echo off',
        'if "%1"=="run" if "%2"=="release:check" exit /b 0',
        'exit /b 1',
        '',
      ].join('\r\n'),
      'utf8',
    );

    const result = runCli(cwd, home, ['verify', '--release'], {
      npm_execpath: '',
      PATH: `${binDir};${process.env.PATH ?? ''}`,
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /Release verification succeeded/i);
  });

  it('review resets stale execution state from older workflow sessions', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['tasks']).status, 0);

    const staleState = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(staleState, /currentPhase: 1/);
    assert.match(staleState, /Implement/);

    const reviewResult = runCli(cwd, home, ['review']);
    assert.strictEqual(reviewResult.status, 0, reviewResult.stderr);

    const refreshedState = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(refreshedState, /workflowStage: review/);
    assert.match(refreshedState, /currentPhase: 0/);
    assert.doesNotMatch(refreshedState, /Implement/);
  });

  it('review writes recommended next steps that match the fail-closed workflow chain', async () => {
    const { cwd, home } = await makeWorkspace();

    const reviewResult = runCli(cwd, home, ['review']);
    assert.strictEqual(reviewResult.status, 0, reviewResult.stderr);

    const currentState = await readProjectFile(cwd, path.join('.danteforge', 'CURRENT_STATE.md'));
    const constitutionIndex = currentState.indexOf('danteforge constitution');
    const specifyIndex = currentState.indexOf('danteforge specify');
    const clarifyIndex = currentState.indexOf('danteforge clarify');
    const planIndex = currentState.indexOf('danteforge plan');
    const tasksIndex = currentState.indexOf('danteforge tasks');
    const forgeIndex = currentState.indexOf('danteforge forge 1');
    const verifyIndex = currentState.indexOf('danteforge verify');
    const synthesizeIndex = currentState.indexOf('danteforge synthesize');

    assert.ok(constitutionIndex >= 0, 'review should recommend constitution');
    assert.ok(specifyIndex > constitutionIndex, 'specify should come after constitution');
    assert.ok(clarifyIndex > specifyIndex, 'clarify should come after specify');
    assert.ok(planIndex > clarifyIndex, 'plan should come after clarify');
    assert.ok(tasksIndex > planIndex, 'tasks should come after plan');
    assert.ok(forgeIndex > tasksIndex, 'forge should come after tasks');
    assert.ok(verifyIndex > forgeIndex, 'verify should come after forge');
    assert.ok(synthesizeIndex > verifyIndex, 'synthesize should come after verify');
  });

  it('review records the detected project type in CURRENT_STATE.md', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({
        name: 'review-project-type-test',
        version: '0.1.0',
        type: 'module',
        bin: {
          reviewtype: 'dist/index.js',
        },
      }, null, 2),
      'utf8',
    );

    const reviewResult = runCli(cwd, home, ['review']);
    assert.strictEqual(reviewResult.status, 0, reviewResult.stderr);

    const currentState = await readProjectFile(cwd, path.join('.danteforge', 'CURRENT_STATE.md'));
    assert.match(currentState, /\*\*Detected project type\*\*: `cli`/i);
  });

  it('importing CURRENT_STATE.md points the user to constitution before specification', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'CURRENT_STATE.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# CURRENT_STATE.md\n\nImported review.\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'CURRENT_STATE.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge constitution/i);
    assert.match(result.stdout + result.stderr, /danteforge specify/i);
  });

  it('importing CONSTITUTION.md records the constitution stage and points the user to specify', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'CONSTITUTION.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# DanteForge Constitution\n- Truth first\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'CONSTITUTION.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge specify/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: constitution/);
    assert.match(state, /Truth first/);
  });

  it('importing SPEC.md records the specification stage and points the user to clarify', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'SPEC.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, [
      '# SPEC.md',
      '',
      '## Feature Name',
      'Imported spec',
      '',
      '## Task Breakdown',
      '1. Implement the imported workflow - files: src/cli/ - verify: CLI behavior matches the spec',
      '2. Test the imported workflow - files: tests/ - verify: CLI coverage exists',
      '',
    ].join('\n'), 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'SPEC.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge clarify/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: specify/);
    assert.match(state, /Implement the imported workflow/);
  });

  it('importing CLARIFY.md records the clarify stage and points the user to plan', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'CLARIFY.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# CLARIFY.md\n\n## Ambiguities Found\n- Imported gap.\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'CLARIFY.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge plan/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: clarify/);
  });

  it('importing PLAN.md records the plan stage and points the user to tasks', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'PLAN.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# PLAN.md\n\n## Architecture Overview\n- Imported plan.\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'PLAN.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge tasks/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: plan/);
  });

  it('importing TASKS.md records phase 1 tasks and points the user to forge', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'TASKS.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, [
      '# TASKS.md',
      '',
      '## Phase 1',
      '1. Implement imported tasks - files: src/core/ - verify: Runtime behavior is correct - effort: M',
      '2. Test imported tasks - files: tests/ - verify: Coverage exists - effort: M',
      '',
    ].join('\n'), 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'TASKS.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge forge 1/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: tasks/);
    assert.match(state, /Implement imported tasks/);
    assert.match(state, /currentPhase: 1/);
  });

  it('importing DESIGN.op records the design stage and points the user to ux-refine', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'DESIGN.op');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, getMediumOPString(), 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'DESIGN.op']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /ux-refine --openpencil/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: design/);
    assert.match(state, /designFilePath: DESIGN\.op/);
  });

  it('importing UPR.md records the synthesize stage and points the user to feedback', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'UPR.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# UPR.md\n\nImported synthesis.\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'UPR.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge feedback/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: synthesize/);
  });

  it('importing UX_REFINE.md records the ux-refine stage and points the user to verify', async () => {
    const { cwd, home } = await makeWorkspace();
    const externalDir = path.join(cwd, 'external');
    const sourceFile = path.join(externalDir, 'UX_REFINE.md');

    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(sourceFile, '# UX_REFINE.md\n\n## Refinements\n- Imported UX pass.\n', 'utf8');

    const result = runCli(cwd, home, ['import', sourceFile, '--as', 'UX_REFINE.md']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /danteforge verify/i);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(state, /workflowStage: ux-refine/);
  });

  it('help reports workflow stage and suggests the next required command', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);

    const helpResult = runCli(cwd, home, ['help']);
    assert.strictEqual(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /Current workflow stage: clarify/i);
    assert.match(helpResult.stdout, /danteforge plan/i);
    assert.doesNotMatch(helpResult.stdout, /Current phase:/i);
  });

  it('synthesize fails closed until verify succeeds for the current workflow stage', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['review']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);

    const synthesizeResult = runCli(cwd, home, ['synthesize']);
    assert.notStrictEqual(synthesizeResult.status, 0);

    await assert.rejects(
      () => readProjectFile(cwd, path.join('.danteforge', 'UPR.md')),
      /ENOENT/i,
    );
  });

  it('synthesize writes a UPR that reflects the real default workflow and next step', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'CURRENT_STATE.md'), '# CURRENT_STATE.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'CONSTITUTION.md'), '# DanteForge Constitution\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'SPEC.md'), '# SPEC.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'CLARIFY.md'), '# CLARIFY.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'PLAN.md'), '# PLAN.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'TASKS.md'), '# TASKS.md\n\n## Phase 1\n1. Ship the workflow\n', 'utf8');
    await fs.writeFile(
      path.join(cwd, '.danteforge', 'STATE.yaml'),
      [
        'project: synth-test',
        'lastHandoff: verify -> next (2026-03-12T00:00:00.000Z)',
        'workflowStage: verify',
        'currentPhase: 1',
        'tasks:',
        '  "1":',
        '    - name: Ship the workflow',
        'auditLog:',
        '  - "2026-03-12T00:00:00.000Z | verify: 10 passed, 0 warnings, 0 failures"',
        'profile: balanced',
        'constitution: |-',
        '  # DanteForge Constitution',
        'lastVerifiedAt: 2026-03-12T00:00:00.000Z',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = runCli(cwd, home, ['synthesize']);
    assert.strictEqual(result.status, 0, result.stderr);

    const upr = await readProjectFile(cwd, path.join('.danteforge', 'UPR.md'));
    assert.match(upr, /review -> constitution -> specify -> clarify -> plan -> tasks -> forge -> verify -> synthesize/i);
    assert.doesNotMatch(upr, /verify -> party -> synthesize/i);
    assert.match(upr, /danteforge feedback/i);
  });

  it('design fails closed without a live LLM and does not create DESIGN.op', async () => {
    const { cwd, home } = await makeWorkspace();

    assert.strictEqual(runCli(cwd, home, ['review']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Build offline release flow']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const designResult = runCli(cwd, home, ['design', 'Create a launch page']);
    assert.notStrictEqual(designResult.status, 0);
    assert.match(designResult.stderr + designResult.stdout, /LLM|prompt/i);

    await assert.rejects(
      () => readProjectFile(cwd, path.join('.danteforge', 'DESIGN.op')),
      /ENOENT/i,
    );
  });

  it('doctor --fix performs real repairs without creating project-local Cursor bootstrap files', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['doctor', '--fix']);
    assert.strictEqual(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    await assert.doesNotReject(() => readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.claude', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.codex', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.codex', 'skills', 'danteforge-cli', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.codex', 'AGENTS.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.gemini', 'antigravity', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.gemini', 'antigravity', 'skills', 'danteforge-cli', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.config', 'opencode', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.rejects(() => fs.access(path.join(cwd, '.cursor', 'rules', 'danteforge.mdc')));
    assert.match(output, /setup assistants --assistants cursor/i);
  });

  it('doctor --live fails closed when live dependencies cannot be verified', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['doctor', '--live']);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /live/i);
    assert.match(result.stdout + result.stderr, /DANTEFORGE_LIVE_PROVIDERS|Selected providers:/i);
    assert.doesNotMatch(result.stdout + result.stderr, /prompt fallback/i);
  });

  it('ux-refine fails closed unless an explicit GA mode is selected', async () => {
    const { cwd, home } = await makeWorkspace();

    await writeUIFixture(cwd);
    await fs.mkdir(path.join(cwd, 'build'), { recursive: true });
    assert.strictEqual(runCli(cwd, home, ['review']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Refine a UI shell']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const result = runCli(cwd, home, ['ux-refine']);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /--openpencil|--prompt/i);

    await assert.rejects(
      () => readProjectFile(cwd, path.join('.danteforge', 'FALLBACK_TOKENS.css')),
      /ENOENT/i,
    );
  });

  it('ux-refine --prompt tells the operator to import UX_REFINE.md and then verify', async () => {
    const { cwd, home } = await makeWorkspace();

    await writeUIFixture(cwd);
    assert.strictEqual(runCli(cwd, home, ['review']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['constitution']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['specify', 'Refine a UI shell']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['clarify']).status, 0);
    assert.strictEqual(runCli(cwd, home, ['plan']).status, 0);

    const result = runCli(cwd, home, ['ux-refine', '--prompt', '--after-forge', '--figma-url', 'https://www.figma.com/file/test']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /UX_REFINE\.md/i);
    assert.match(result.stdout + result.stderr, /danteforge verify/i);
  });

  it('ux-refine --openpencil extracts tokens and preview artifacts from a real DESIGN.op', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'DESIGN.op'), getMediumOPString(), 'utf8');

    const result = runCli(cwd, home, ['ux-refine', '--openpencil']);
    assert.strictEqual(result.status, 0, result.stderr);

    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    await assert.doesNotReject(() => readProjectFile(cwd, path.join('.danteforge', 'design-tokens.css')));
    await assert.doesNotReject(() => readProjectFile(cwd, path.join('.danteforge', 'design-preview.html')));
    assert.match(state, /workflowStage: ux-refine/);
  });

  it('magic fails closed instead of reporting a complete pipeline when no live execution path is available', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['magic', 'Build a launch app']);
    assert.notStrictEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /MAGIC MODE COMPLETE/i);
  });

  it('feedback --auto fails closed without a live LLM and does not generate manual prompt artifacts', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'UPR.md'), '# UPR\n\nShip a polished release.\n', 'utf8');

    const result = runCli(cwd, home, ['feedback', '--auto']);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /LLM|provider/i);

    await assert.rejects(
      () => fs.readdir(path.join(cwd, '.danteforge', 'prompts')),
      /ENOENT/i,
    );
    await assert.rejects(
      () => readProjectFile(cwd, path.join('.danteforge', 'REFINED_UPR.md')),
      /ENOENT/i,
    );
  });

  it('manual feedback roundtrip imports REFINED_UPR.md and merges it into the next synthesis', async () => {
    const { cwd, home } = await makeWorkspace();

    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(path.join(cwd, '.danteforge', 'CURRENT_STATE.md'), '# CURRENT_STATE.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'CONSTITUTION.md'), '# DanteForge Constitution\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'SPEC.md'), '# SPEC.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'CLARIFY.md'), '# CLARIFY.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'PLAN.md'), '# PLAN.md\n', 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'TASKS.md'), '# TASKS.md\n\n## Phase 1\n1. Ship the workflow\n', 'utf8');
    await fs.writeFile(
      path.join(cwd, '.danteforge', 'STATE.yaml'),
      [
        'project: feedback-test',
        'lastHandoff: verify -> next (2026-03-12T00:00:00.000Z)',
        'workflowStage: verify',
        'currentPhase: 1',
        'tasks:',
        '  "1":',
        '    - name: Ship the workflow',
        'auditLog:',
        '  - "2026-03-12T00:00:00.000Z | verify: 10 passed, 0 warnings, 0 failures"',
        'profile: balanced',
        'constitution: |-',
        '  # DanteForge Constitution',
        'lastVerifiedAt: 2026-03-12T00:00:00.000Z',
        '',
      ].join('\n'),
      'utf8',
    );

    const firstSynthesis = runCli(cwd, home, ['synthesize']);
    assert.strictEqual(firstSynthesis.status, 0, firstSynthesis.stderr);

    const feedbackPromptResult = runCli(cwd, home, ['feedback']);
    assert.strictEqual(feedbackPromptResult.status, 0, feedbackPromptResult.stderr);
    assert.match(feedbackPromptResult.stdout + feedbackPromptResult.stderr, /REFINED_UPR\.md/i);

    const externalDir = path.join(cwd, 'external');
    const refinedFile = path.join(externalDir, 'REFINED_UPR.md');
    await fs.mkdir(externalDir, { recursive: true });
    await fs.writeFile(refinedFile, '# REFINED_UPR.md\n\n## Executive Summary\n- Imported refinement.\n', 'utf8');

    const importResult = runCli(cwd, home, ['import', refinedFile, '--as', 'REFINED_UPR.md']);
    assert.strictEqual(importResult.status, 0, importResult.stderr);
    assert.match(importResult.stdout + importResult.stderr, /danteforge synthesize/i);

    const secondSynthesis = runCli(cwd, home, ['synthesize']);
    assert.strictEqual(secondSynthesis.status, 0, secondSynthesis.stderr);

    const upr = await readProjectFile(cwd, path.join('.danteforge', 'UPR.md'));
    assert.match(upr, /Source: REFINED_UPR\.md/);
    assert.match(upr, /Imported refinement/);
  });

  it('party fails closed when no live LLM provider is available', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['party']);
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /LLM|provider/i);
  });

  it('party exposes the isolation flag from the CLI', async () => {
    const { cwd, home } = await makeWorkspace();

    const helpResult = runCli(cwd, home, ['party', '--help']);
    assert.strictEqual(helpResult.status, 0, helpResult.stderr);
    assert.match(helpResult.stdout, /--isolation/);
  });

  it('autoforge accepts an optional goal argument in prompt mode', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['autoforge', 'Finish the authentication module', '--prompt']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout + result.stderr, /Finish the authentication module/i);
  });

  it('imports an Antigravity bundle through the nested skills import command', async () => {
    const { cwd, home } = await makeWorkspace();
    const fixtureDir = path.join(cwd, 'antigravity-fixture');

    await fs.mkdir(path.join(cwd, 'src', 'harvested', 'dante-agents', 'skills'), { recursive: true });
    await createAntigravityFixture(fixtureDir);

    const result = spawnSync(process.execPath, [tsxCli, cliEntry, 'skills', 'import', '--from', 'antigravity', '--bundle', 'Web Wizard'], {
      cwd,
      env: {
        ...process.env,
        DANTEFORGE_HOME: home,
        DANTEFORGE_ANTIGRAVITY_SOURCE_DIR: fixtureDir,
      },
      encoding: 'utf8',
    });

    assert.strictEqual(result.status ?? 0, 0, result.stderr);
    const imported = await readProjectFile(cwd, path.join('src', 'harvested', 'dante-agents', 'skills', 'react-patterns', 'SKILL.md'));
    const state = await readProjectFile(cwd, path.join('.danteforge', 'STATE.yaml'));
    assert.match(imported, /Imported from Antigravity/);
    assert.match(state, /skills import: antigravity bundle "Web Wizard"/);
  });

  it('fails closed when the nested skills import command would overwrite a packaged skill', async () => {
    const { cwd, home } = await makeWorkspace();
    const fixtureDir = path.join(cwd, 'antigravity-fixture');

    await fs.mkdir(path.join(cwd, 'src', 'harvested', 'dante-agents', 'skills', 'react-patterns'), { recursive: true });
    await createAntigravityFixture(fixtureDir);
    await fs.writeFile(
      path.join(cwd, 'src', 'harvested', 'dante-agents', 'skills', 'react-patterns', 'SKILL.md'),
      '---\nname: react-patterns\ndescription: Existing skill.\n---\n\nExisting body\n',
      'utf8',
    );

    const result = spawnSync(process.execPath, [tsxCli, cliEntry, 'skills', 'import', '--from', 'antigravity', '--bundle', 'Web Wizard'], {
      cwd,
      env: {
        ...process.env,
        DANTEFORGE_HOME: home,
        DANTEFORGE_ANTIGRAVITY_SOURCE_DIR: fixtureDir,
      },
      encoding: 'utf8',
    });

    assert.notStrictEqual(result.status ?? 0, 0);
    assert.match(result.stderr, /overwrite existing packaged skills/i);
  });
});
