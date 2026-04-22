// doctor.ts — unit tests for the exported pure-function helpers
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { validateLiveReleaseConfig } from '../src/cli/commands/doctor.js';
import { runTsxCli } from './helpers/cli-runner.ts';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

function runCli(cwd: string, home: string, args: string[]) {
  return runTsxCli(args, {
    cwd,
    timeout: 60_000,
    env: {
      HOME: home,
      USERPROFILE: home,
      DANTEFORGE_HOME: home,
      NODE_ENV: 'test',
    },
  });
}

describe('validateLiveReleaseConfig — branch coverage', () => {
  it('returns an error when DANTEFORGE_LIVE_PROVIDERS is not set', () => {
    const result = validateLiveReleaseConfig({});
    assert.ok(result.error?.includes('Set DANTEFORGE_LIVE_PROVIDERS'), `expected env-missing error, got: ${result.error}`);
    assert.deepStrictEqual(result.providers, []);
    assert.deepStrictEqual(result.missing, []);
  });

  it('returns an error when DANTEFORGE_LIVE_PROVIDERS is set but empty after split', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: '  ,  ,  ' });
    assert.ok(result.error?.includes('did not contain any providers'), `expected empty-providers error, got: ${result.error}`);
  });

  it('returns an error when an unknown provider is listed', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai,unknown_provider' });
    assert.ok(result.error?.includes('unknown_provider'), `expected unknown-provider error, got: ${result.error}`);
  });

  it('reports missing API key for openai when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'openai' });
    assert.strictEqual(result.error, undefined, 'should not have a top-level error');
    assert.ok(result.missing.some(m => m.includes('OPENAI_API_KEY')), `expected OPENAI_API_KEY in missing, got: ${JSON.stringify(result.missing)}`);
  });

  it('reports missing API key for claude when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'claude' });
    assert.ok(result.missing.some(m => m.includes('ANTHROPIC_API_KEY')), `expected ANTHROPIC_API_KEY in missing`);
  });

  it('reports missing API key for gemini when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'gemini' });
    assert.ok(result.missing.some(m => m.includes('GEMINI_API_KEY')), `expected GEMINI_API_KEY in missing`);
  });

  it('reports missing API key for grok when key is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'grok' });
    assert.ok(result.missing.some(m => m.includes('XAI_API_KEY')), `expected XAI_API_KEY in missing`);
  });

  it('reports missing OLLAMA_MODEL for ollama when model is absent', () => {
    const result = validateLiveReleaseConfig({ DANTEFORGE_LIVE_PROVIDERS: 'ollama' });
    assert.ok(result.missing.some(m => m.includes('OLLAMA_MODEL')), `expected OLLAMA_MODEL in missing`);
  });

  it('returns success when openai provider has a valid API key', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai',
      OPENAI_API_KEY: 'sk-test-key',
    });
    assert.strictEqual(result.error, undefined, 'should not have an error');
    assert.deepStrictEqual(result.missing, [], 'should have no missing items');
    assert.deepStrictEqual(result.providers, ['openai']);
  });

  it('deduplicates providers and returns success for all with keys', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'openai,openai,claude',
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'ant-test',
    });
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.missing, []);
    assert.deepStrictEqual(result.providers, ['openai', 'claude'], 'should deduplicate openai');
  });

  it('returns ollama success when OLLAMA_MODEL is set', () => {
    const result = validateLiveReleaseConfig({
      DANTEFORGE_LIVE_PROVIDERS: 'ollama',
      OLLAMA_MODEL: 'llama3',
    });
    assert.strictEqual(result.error, undefined);
    assert.deepStrictEqual(result.missing, []);
  });
});

describe('doctor CLI — verify guidance', () => {
  it('surfaces stale verify receipts with a concrete rerun command', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-doctor-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    const evidenceDir = path.join(cwd, '.danteforge', 'evidence', 'verify');
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.mkdir(home, { recursive: true });

    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'doctor-fixture' }), 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), yaml.stringify({
      project: 'doctor-fixture',
      lastHandoff: 'verify',
      workflowStage: 'verify',
      currentPhase: 1,
      tasks: {},
      auditLog: [],
      profile: 'balanced',
      lastVerifyStatus: 'pass',
    }), 'utf8');
    await fs.writeFile(path.join(evidenceDir, 'latest.json'), JSON.stringify({
      status: 'pass',
      timestamp: '2026-04-16T12:00:00.000Z',
      gitSha: null,
      currentStateFresh: false,
    }), 'utf8');

    const result = runCli(cwd, home, ['doctor']);
    const output = result.stdout + result.stderr;
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /Verify receipt/i);
    assert.match(output, /stale pass receipt/i);
    assert.match(output, /npm run verify/i);
  });

  it('warns when no verify receipt exists yet', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-doctor-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.mkdir(home, { recursive: true });

    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'doctor-fixture' }), 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), yaml.stringify({
      project: 'doctor-fixture',
      lastHandoff: 'initialized',
      workflowStage: 'forge',
      currentPhase: 1,
      tasks: {},
      auditLog: [],
      profile: 'balanced',
    }), 'utf8');

    const result = runCli(cwd, home, ['doctor']);
    const output = result.stdout + result.stderr;
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /Verify receipt/i);
    assert.match(output, /No verify receipt found/i);
    assert.match(output, /npm run verify/i);
  });

  it('surfaces Codex CLI fallback and utility alias health when Codex bootstrap is installed', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-doctor-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.mkdir(path.join(home, '.codex', 'skills', 'danteforge-cli'), { recursive: true });
    await fs.mkdir(path.join(home, '.codex', 'commands'), { recursive: true });

    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'doctor-fixture', version: '1.0.0' }), 'utf8');
    await fs.writeFile(path.join(cwd, '.danteforge', 'STATE.yaml'), yaml.stringify({
      project: 'doctor-fixture',
      lastHandoff: 'verify',
      workflowStage: 'verify',
      currentPhase: 1,
      tasks: { 1: [{ name: 'Ship it' }] },
      auditLog: ['2026-04-20T00:00:00.000Z | forge: wave 1 - shipped'],
      profile: 'balanced',
      constitution: 'CONSTITUTION.md',
      lastVerifyStatus: 'pass',
    }), 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'skills', 'danteforge-cli', 'SKILL.md'), '# skill\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'AGENTS.md'), '# bootstrap\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'autoforge.md'), '# autoforge\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'spark.md'), '# spark\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'ember.md'), '# ember\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'canvas.md'), '# canvas\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'magic.md'), '# magic\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'blaze.md'), '# blaze\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'nova.md'), '# nova\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'inferno.md'), '# inferno\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'verify.md'), '# verify\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'commands', 'local-harvest.md'), '# local-harvest\n', 'utf8');
    await fs.writeFile(path.join(home, '.codex', 'config.toml'), [
      '[commands]',
      'setup-assistants = "npx danteforge setup assistants --assistants codex"',
      'doctor-live = "npx danteforge doctor --live"',
      'df-verify = "npx danteforge verify"',
    ].join('\n'), 'utf8');

    const result = runCli(cwd, home, ['doctor']);
    const output = result.stdout + result.stderr;
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /Codex CLI fallback/i);
    assert.match(output, /Codex utility aliases/i);
  });
});
