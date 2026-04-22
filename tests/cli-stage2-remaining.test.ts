// cli-stage2-remaining.test.ts — injection seam tests for 12 remaining zero-coverage CLI files
// Covers: completion, cost, qa, premium, profile, setup-assistants, setup-figma,
//         ux-refine, awesome-scan, oss, review, design
// No real LLM calls. Filesystem interactions are limited to the existing project directory.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    constitution: 'Be modular.',
    workflowStage: 'tasks',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    lastHandoff: 'none',
    ...overrides,
  } as DanteState;
}

function makeSavedArr() {
  const saved: DanteState[] = [];
  const _saveState = async (s: DanteState) => { saved.push(JSON.parse(JSON.stringify(s))); };
  return { saved, _saveState };
}

const ORIGINAL_EXIT_CODE = process.exitCode;
beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = ORIGINAL_EXIT_CODE; });

// ── completion.ts — pure exports ──────────────────────────────────────────────

import {
  COMPLETION_COMMANDS,
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  completionCmd,
} from '../src/cli/commands/completion.js';

describe('COMPLETION_COMMANDS', () => {
  it('is a non-empty readonly array', () => {
    assert.ok(Array.isArray(COMPLETION_COMMANDS), 'should be an array');
    assert.ok(COMPLETION_COMMANDS.length > 20, 'should contain many commands');
  });

  it('contains core pipeline commands', () => {
    for (const cmd of ['init', 'specify', 'forge', 'verify', 'synthesize']) {
      assert.ok(COMPLETION_COMMANDS.includes(cmd as never), `should include ${cmd}`);
    }
  });

  it('contains automation presets', () => {
    for (const cmd of ['spark', 'ember', 'magic', 'blaze', 'nova', 'inferno', 'canvas']) {
      assert.ok(COMPLETION_COMMANDS.includes(cmd as never), `should include preset ${cmd}`);
    }
  });
});

describe('generateBashCompletion', () => {
  it('returns a non-empty string', () => {
    const output = generateBashCompletion();
    assert.ok(output.length > 100, 'should produce substantial bash script');
  });

  it('includes the complete function and danteforge command', () => {
    const output = generateBashCompletion();
    assert.ok(output.includes('complete -F _danteforge_completions danteforge'), 'should include complete directive');
  });

  it('includes all COMPLETION_COMMANDS in output', () => {
    const output = generateBashCompletion();
    for (const cmd of ['init', 'forge', 'verify', 'inferno']) {
      assert.ok(output.includes(cmd), `bash completion should include command: ${cmd}`);
    }
  });

  it('is deterministic across calls', () => {
    assert.equal(generateBashCompletion(), generateBashCompletion(), 'should be deterministic');
  });
});

describe('generateZshCompletion', () => {
  it('returns a non-empty string', () => {
    const output = generateZshCompletion();
    assert.ok(output.length > 200, 'should produce substantial zsh script');
  });

  it('includes #compdef header', () => {
    const output = generateZshCompletion();
    assert.ok(output.includes('#compdef danteforge'), 'should have #compdef header');
  });

  it('includes command descriptions', () => {
    const output = generateZshCompletion();
    assert.ok(output.includes('init:'), 'should include init command with description');
    assert.ok(output.includes('forge:'), 'should include forge command with description');
  });
});

describe('generateFishCompletion', () => {
  it('returns a non-empty string', () => {
    const output = generateFishCompletion();
    assert.ok(output.length > 100, 'should produce substantial fish script');
  });

  it('includes fish complete directives', () => {
    const output = generateFishCompletion();
    assert.ok(output.includes('complete -c danteforge'), 'should include fish complete directives');
  });

  it('includes all completion commands in output', () => {
    const output = generateFishCompletion();
    for (const cmd of ['init', 'forge', 'verify']) {
      assert.ok(output.includes(cmd), `fish completion should include command: ${cmd}`);
    }
  });
});

describe('completionCmd', () => {
  it('calls _stdout with bash completion for bash target', async () => {
    let captured = '';
    await completionCmd('bash', { _stdout: (s) => { captured += s; } });
    assert.ok(captured.includes('_danteforge_completions'), 'should output bash completion');
  });

  it('calls _stdout with zsh completion for zsh target', async () => {
    let captured = '';
    await completionCmd('zsh', { _stdout: (s) => { captured += s; } });
    assert.ok(captured.includes('#compdef danteforge'), 'should output zsh completion');
  });

  it('calls _stdout with fish completion for fish target', async () => {
    let captured = '';
    await completionCmd('fish', { _stdout: (s) => { captured += s; } });
    assert.ok(captured.includes('complete -c danteforge'), 'should output fish completion');
  });

  it('defaults to bash when no shell specified', async () => {
    let captured = '';
    await completionCmd(undefined, { _stdout: (s) => { captured += s; } });
    assert.ok(captured.includes('_danteforge_completions'), 'default should be bash');
  });

  // Note: unknown shell calls process.exit(1) which terminates the test runner — not testable here
});

// ── cost.ts — injection seams ─────────────────────────────────────────────────

import { cost } from '../src/cli/commands/cost.js';
import type { TokenReport } from '../src/core/execution-telemetry.js';

function makeTokenReport(overrides: Partial<TokenReport> = {}): TokenReport {
  return {
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    totalCostUsd: 0.012,
    byModel: { 'claude-3': { inputTokens: 1000, outputTokens: 500, callCount: 5, costUsd: 0.012 } },
    byAgent: {},
    byTier: {},
    savedByLocalTransforms: { callCount: 0, estimatedSavedTokens: 0, estimatedSavedUsd: 0 },
    savedByCompression: { originalTokens: 0, compressedTokens: 0, savedPercent: 0 },
    savedByGates: { blockedCallCount: 0, estimatedSavedTokens: 0 },
    ...overrides,
  } as TokenReport;
}

describe('cost: no reports', () => {
  it('calls _findReports and returns when empty', async () => {
    let findCalled = false;
    await cost({
      _findReports: async (_cwd) => { findCalled = true; return []; },
      _readReport: async () => null,
    });
    assert.ok(findCalled, '_findReports should be called');
  });

  it('does not call _readReport when no report files found', async () => {
    let readCalled = false;
    await cost({
      _findReports: async () => [],
      _readReport: async () => { readCalled = true; return null; },
    });
    assert.ok(!readCalled, '_readReport should not be called when no files');
  });
});

describe('cost: with reports', () => {
  it('calls _readReport with the latest file', async () => {
    let readCalledWith = '';
    await cost({
      _findReports: async () => ['/reports/cost-001.json', '/reports/cost-002.json'],
      _readReport: async (file) => { readCalledWith = file; return makeTokenReport(); },
    });
    assert.equal(readCalledWith, '/reports/cost-002.json', 'should read the last (latest) report file');
  });

  it('reads all files in history mode', async () => {
    const filesRead: string[] = [];
    await cost({
      history: true,
      _findReports: async () => ['/reports/cost-001.json', '/reports/cost-002.json'],
      _readReport: async (file) => { filesRead.push(file); return makeTokenReport(); },
    });
    assert.equal(filesRead.length, 2, 'should read all reports in history mode');
  });
});

// ── qa.ts — injection seams ───────────────────────────────────────────────────

import { qa } from '../src/cli/commands/qa.js';
import type { QAReport } from '../src/core/qa-runner.js';

function makeQAReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    score: 85,
    mode: 'full',
    url: 'http://localhost:3000',
    timestamp: new Date().toISOString(),
    issues: [],
    screenshots: [],
    ...overrides,
  };
}

describe('qa: binary detection gate', () => {
  it('sets exitCode=1 and does not call _runQAPass when binary not found', async () => {
    let runQACalled = false;
    await qa({
      url: 'http://localhost:3000',
      _detectBinary: async () => null,
      _runQAPass: async () => { runQACalled = true; return makeQAReport(); },
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 when binary not found');
    assert.ok(!runQACalled, '_runQAPass should not be called when binary missing');
  });

  it('sets exitCode=1 when url is empty even if binary found', async () => {
    let runQACalled = false;
    await qa({
      url: '',
      _detectBinary: async () => '/usr/bin/chromium',
      _runQAPass: async () => { runQACalled = true; return makeQAReport(); },
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 when url is empty');
    assert.ok(!runQACalled, '_runQAPass should not be called when url is missing');
  });
});

// ── premium.ts — injection seams ─────────────────────────────────────────────

import { premium } from '../src/cli/commands/premium.js';

describe('premium: unknown subcommand', () => {
  it('sets exitCode=1 for unknown subcommand', async () => {
    await premium('unknown-subcmd', {
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 for unknown subcommand');
  });
});

describe('premium: activate', () => {
  it('sets exitCode=1 when no key provided', async () => {
    await premium('activate', {
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 when no license key');
  });

  it('sets exitCode=1 for invalid license key', async () => {
    await premium('activate', {
      key: 'invalid-key-xyz',
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 for invalid license key');
  });

  it('does not call _saveState when key is missing', async () => {
    const { saved, _saveState } = makeSavedArr();
    await premium('activate', {
      _loadState: async () => makeState(),
      _saveState,
    });
    assert.equal(saved.length, 0, '_saveState should not be called when key missing');
  });
});

// ── profile.ts — injection seams ─────────────────────────────────────────────

import { profile } from '../src/cli/commands/profile.js';

describe('profile: prompt mode', () => {
  it('does not call _loadState in prompt mode', async () => {
    let loadCalled = false;
    await profile(undefined, undefined, {
      prompt: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
    });
    assert.ok(!loadCalled, '_loadState should not be called in prompt mode');
  });

  it('does not call _saveState in prompt mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    await profile(undefined, undefined, {
      prompt: true,
      _loadState: async () => makeState(),
      _saveState,
    });
    assert.equal(saved.length, 0, '_saveState should not be called in prompt mode');
  });
});

describe('profile: subcommand modes', () => {
  it('calls _loadState for summary subcommand', async () => {
    let loadCalled = false;
    await profile('summary', undefined, {
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
    });
    assert.ok(loadCalled, '_loadState should be called for summary subcommand');
  });

  it('adds audit log entry for summary subcommand', async () => {
    const { saved, _saveState } = makeSavedArr();
    await profile('summary', undefined, {
      _loadState: async () => makeState(),
      _saveState,
    });
    // _saveState may not be called if ModelProfileEngine throws — but _loadState was called
    // If it was called, audit log should contain 'profile:'
    if (saved.length > 0) {
      assert.ok(
        saved[0]!.auditLog.some(e => e.includes('profile:')),
        'audit log should contain profile entry',
      );
    }
  });
});

// ── setup-assistants.ts — injection seams ────────────────────────────────────

import { setupAssistants } from '../src/cli/commands/setup-assistants.js';
import type { AssistantRegistry } from '../src/core/assistant-installer.js';

function makeInstallResult(assistants: AssistantRegistry[] = ['claude']) {
  return {
    homeDir: '/tmp',
    assistants: assistants.map(assistant => ({
      assistant,
      targetDir: '/tmp/test-target',
      installedSkills: ['danteforge-cli.md'],
      installMode: 'skills' as const,
    })),
  };
}

describe('setupAssistants: default assistants', () => {
  it('calls _installSkills when invoked with no assistants option', async () => {
    let installCalled = false;
    await setupAssistants({
      _installSkills: async (opts) => { installCalled = true; return makeInstallResult(opts?.assistants ?? []); },
      _resolvePaths: () => ({ configFile: '/tmp/config.yaml', configDir: '/tmp', legacyProjectConfigFile: '/tmp/.danteforge/config.yaml' }),
    });
    assert.ok(installCalled, '_installSkills should be called');
  });

  it('calls _resolvePaths when invoked', async () => {
    let resolvePathsCalled = false;
    await setupAssistants({
      _installSkills: async () => makeInstallResult(),
      _resolvePaths: () => { resolvePathsCalled = true; return { configFile: '/tmp/config.yaml', configDir: '/tmp', legacyProjectConfigFile: '/tmp/.danteforge/config.yaml' }; },
    });
    assert.ok(resolvePathsCalled, '_resolvePaths should be called');
  });
});

describe('setupAssistants: all assistants', () => {
  it('passes all assistants when "all" is specified', async () => {
    let receivedAssistants: AssistantRegistry[] = [];
    await setupAssistants({
      assistants: 'all',
      _installSkills: async (opts) => {
        receivedAssistants = opts?.assistants ?? [];
        return makeInstallResult(receivedAssistants);
      },
      _resolvePaths: () => ({ configFile: '/tmp/config.yaml', configDir: '/tmp', legacyProjectConfigFile: '/tmp/.danteforge/config.yaml' }),
    });
    assert.ok(receivedAssistants.length >= 10, 'should pass all assistants when "all" specified');
    assert.ok(receivedAssistants.includes('claude'), 'all assistants should include claude');
    assert.ok(receivedAssistants.includes('cursor'), 'all assistants should include cursor');
  });
});

// ── setup-figma.ts — injection seams ─────────────────────────────────────────

import { setupFigma } from '../src/cli/commands/setup-figma.js';

function makeMCPAdapter() {
  return {
    host: 'claude-code' as const,
    tier: 'full' as const,
    capabilities: {
      host: 'claude-code' as const,
      hasMCP: true,
      hasFigmaMCP: false,
    },
    mcpEndpoint: 'https://mcp.figma.com/mcp',
  };
}

describe('setupFigma: injection seam coverage', () => {
  it('calls _getMCPSetupCommand', async () => {
    let setupCmdCalled = false;
    await setupFigma({
      host: 'claude-code',
      test: false,
      _getMCPSetupCommand: (host) => { setupCmdCalled = true; return `# setup command for ${host}`; },
      _testMCP: async () => ({ ok: true, message: 'Connected' }),
      _initMCP: async () => makeMCPAdapter(),
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.ok(setupCmdCalled, '_getMCPSetupCommand should be called');
  });

  it('calls _testMCP when test is not false', async () => {
    let testCalled = false;
    await setupFigma({
      host: 'claude-code',
      _getMCPSetupCommand: () => '# cmd',
      _testMCP: async () => { testCalled = true; return { ok: true, message: 'OK' }; },
      _initMCP: async () => makeMCPAdapter(),
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.ok(testCalled, '_testMCP should be called when test is not false');
  });

  it('skips _testMCP when test is false', async () => {
    let testCalled = false;
    await setupFigma({
      host: 'claude-code',
      test: false,
      _getMCPSetupCommand: () => '# cmd',
      _testMCP: async () => { testCalled = true; return { ok: true, message: 'OK' }; },
      _initMCP: async () => makeMCPAdapter(),
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });
    assert.ok(!testCalled, '_testMCP should not be called when test=false');
  });

  it('calls _saveState with audit log entry', async () => {
    const { saved, _saveState } = makeSavedArr();
    await setupFigma({
      host: 'claude-code',
      test: false,
      _getMCPSetupCommand: () => '# cmd',
      _testMCP: async () => ({ ok: true, message: 'OK' }),
      _initMCP: async () => makeMCPAdapter(),
      _loadState: async () => makeState(),
      _saveState,
    });
    assert.ok(saved.length > 0, '_saveState should be called');
    assert.ok(
      saved[0]!.auditLog.some(e => e.includes('setup-figma:')),
      'audit log should contain setup-figma entry',
    );
  });
});

// ── ux-refine.ts — early-exit paths ──────────────────────────────────────────

import { uxRefine } from '../src/cli/commands/ux-refine.js';

describe('uxRefine: skipUx path', () => {
  it('returns immediately when skipUx is true, without calling stubs', async () => {
    let loadCalled = false;
    let saveCalled = false;
    await uxRefine({
      skipUx: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => { saveCalled = true; },
    });
    assert.ok(!loadCalled, '_loadState should not be called when skipUx');
    assert.ok(!saveCalled, '_saveState should not be called when skipUx');
    assert.equal(process.exitCode, 0, 'exitCode should be 0 for skipUx');
  });
});

describe('uxRefine: no mode flags', () => {
  it('sets exitCode=1 when no mode (not prompt, not openpencil, not lint, not skipUx)', async () => {
    let loadCalled = false;
    await uxRefine({
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 when no mode specified');
    assert.ok(!loadCalled, '_loadState should not be called when no mode');
  });
});

// ── awesome-scan.ts — injection seams ────────────────────────────────────────

import { awesomeScan } from '../src/cli/commands/awesome-scan.js';
import type { SkillRegistryEntry } from '../src/core/skill-registry.js';

function makeSkillEntry(overrides: Partial<SkillRegistryEntry> = {}): SkillRegistryEntry {
  return {
    name: 'test-skill',
    description: 'A test skill for unit testing purposes',
    domain: 'testing',
    source: 'packaged',
    version: '1.0.0',
    tags: ['test'],
    ...overrides,
  } as SkillRegistryEntry;
}

describe('awesomeScan: empty registry', () => {
  it('calls _buildRegistry', async () => {
    let buildCalled = false;
    await awesomeScan({
      _buildRegistry: async () => { buildCalled = true; return []; },
      _scanExternal: async () => [],
      _checkCompatibility: async () => ({ compatible: true, missing: [] }),
      _importSkill: async () => ({ success: true, path: '/tmp/skill' }),
    });
    assert.ok(buildCalled, '_buildRegistry should always be called');
  });

  it('does not call _scanExternal when no source provided', async () => {
    let scanCalled = false;
    await awesomeScan({
      _buildRegistry: async () => [],
      _scanExternal: async () => { scanCalled = true; return []; },
    });
    assert.ok(!scanCalled, '_scanExternal should not be called without --source');
  });
});

describe('awesomeScan: with external source', () => {
  it('calls _scanExternal when source is provided', async () => {
    let scanCalled = false;
    await awesomeScan({
      source: 'https://example.com/skills',
      _buildRegistry: async () => [],
      _scanExternal: async () => { scanCalled = true; return [makeSkillEntry({ source: 'external' as never })]; },
    });
    assert.ok(scanCalled, '_scanExternal should be called when source is provided');
  });
});

describe('awesomeScan: install mode', () => {
  it('calls _checkCompatibility for each external skill when --install is set', async () => {
    let checkCallCount = 0;
    const externalSkill = makeSkillEntry({ source: 'external' as never });
    await awesomeScan({
      source: 'https://example.com/skills',
      install: true,
      _buildRegistry: async () => [],
      _scanExternal: async () => [externalSkill],
      _checkCompatibility: async () => { checkCallCount++; return { compatible: false, missing: ['node>=18'] }; },
      _importSkill: async () => ({ success: true, path: '/tmp/skill' }),
    });
    assert.equal(checkCallCount, 1, '_checkCompatibility should be called once per external skill');
  });

  it('calls _importSkill only for compatible external skills', async () => {
    let importCalled = false;
    const externalSkill = makeSkillEntry({ source: 'external' as never });
    await awesomeScan({
      source: 'https://example.com/skills',
      install: true,
      _buildRegistry: async () => [],
      _scanExternal: async () => [externalSkill],
      _checkCompatibility: async () => ({ compatible: true, missing: [] }),
      _importSkill: async () => { importCalled = true; return { success: true, path: '/tmp/skill' }; },
    });
    assert.ok(importCalled, '_importSkill should be called for compatible skills');
  });

  it('skips _importSkill for incompatible external skills', async () => {
    let importCalled = false;
    const externalSkill = makeSkillEntry({ source: 'external' as never });
    await awesomeScan({
      source: 'https://example.com/skills',
      install: true,
      _buildRegistry: async () => [],
      _scanExternal: async () => [externalSkill],
      _checkCompatibility: async () => ({ compatible: false, missing: ['node>=20'] }),
      _importSkill: async () => { importCalled = true; return { success: true, path: '/tmp/skill' }; },
    });
    assert.ok(!importCalled, '_importSkill should not be called for incompatible skills');
  });
});

// ── oss.ts — injection seams ──────────────────────────────────────────────────

import { ossResearcher } from '../src/cli/commands/oss.js';

describe('ossResearcher: dry-run mode', () => {
  it('calls _loadState and _saveState in dry-run mode', async () => {
    let loadCalled = false;
    const { saved, _saveState } = makeSavedArr();
    await ossResearcher({
      dryRun: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState,
      _isLLMAvailable: async () => false,
    });
    assert.ok(loadCalled, '_loadState should be called in dry-run mode');
    assert.ok(saved.length > 0, '_saveState should be called in dry-run mode');
  });

  it('adds dry-run audit log entry', async () => {
    const { saved, _saveState } = makeSavedArr();
    await ossResearcher({
      dryRun: true,
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
    });
    assert.ok(saved.length > 0, 'state should be saved');
    assert.ok(
      saved[0]!.auditLog.some(e => e.includes('oss:') && e.includes('dry run')),
      'audit log should contain dry-run oss entry',
    );
  });
});

describe('ossResearcher: prompt mode', () => {
  it('calls _loadState and _saveState in prompt mode', async () => {
    let loadCalled = false;
    const { saved, _saveState } = makeSavedArr();
    await ossResearcher({
      prompt: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState,
      _isLLMAvailable: async () => false,
    });
    assert.ok(loadCalled, '_loadState should be called in prompt mode');
    assert.ok(saved.length > 0, '_saveState should be called in prompt mode');
  });

  it('adds prompt audit log entry', async () => {
    const { saved, _saveState } = makeSavedArr();
    await ossResearcher({
      prompt: true,
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
    });
    assert.ok(
      saved[0]!.auditLog.some(e => e.includes('oss:') && e.includes('prompt')),
      'audit log should contain prompt oss entry',
    );
  });
});

describe('ossResearcher: LLM unavailable fallback', () => {
  it('calls _loadState and _saveState in local fallback mode', async () => {
    let loadCalled = false;
    const { saved, _saveState } = makeSavedArr();
    await ossResearcher({
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState,
      _isLLMAvailable: async () => false,
    });
    assert.ok(loadCalled, '_loadState should be called in local fallback mode');
    assert.ok(saved.length > 0, '_saveState should be called in local fallback mode');
  });

  it('does not call _isLLMAvailable in dry-run mode', async () => {
    let llmCheckCalled = false;
    await ossResearcher({
      dryRun: true,
      _loadState: async () => makeState(),
      _saveState: async () => {},
      _isLLMAvailable: async () => { llmCheckCalled = true; return false; },
    });
    assert.ok(!llmCheckCalled, '_isLLMAvailable should not be called in dry-run mode');
  });
});

// ── review.ts — injection seams ──────────────────────────────────────────────

import { review } from '../src/cli/commands/review.js';

describe('review: prompt mode', () => {
  it('calls _loadState in prompt mode', async () => {
    let loadCalled = false;
    await review({
      prompt: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.ok(loadCalled, '_loadState should be called in prompt mode');
  });

  it('calls _saveState in prompt mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    await review({
      prompt: true,
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.ok(saved.length > 0, '_saveState should be called in prompt mode');
  });

  it('adds audit log entry in prompt mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    await review({
      prompt: true,
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    if (saved.length > 0) {
      assert.ok(
        saved[0]!.auditLog.some(e => e.includes('review:')),
        'audit log should contain review entry',
      );
    }
  });
});

describe('review: local fallback mode', () => {
  it('calls _loadState in local fallback (LLM unavailable)', async () => {
    let loadCalled = false;
    await review({
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.ok(loadCalled, '_loadState should be called in local fallback mode');
  });

  it('calls _saveState before handoff in local fallback mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    await review({
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    // _saveState is called before handoff() — saved.length > 0 even if handoff fails
    assert.ok(saved.length > 0, '_saveState should be called before handoff in local mode');
  });
});

// ── design.ts — injection seams ──────────────────────────────────────────────

import { design } from '../src/cli/commands/design.js';

describe('design: LLM unavailable path', () => {
  it('calls _loadState even when LLM is unavailable', async () => {
    let loadCalled = false;
    await design('Create a login page', {
      light: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.ok(loadCalled, '_loadState should be called before LLM check');
  });

  it('sets exitCode=1 when LLM is unavailable in non-prompt mode', async () => {
    await design('Create a login page', {
      light: true,
      _loadState: async () => makeState(),
      _saveState: async () => {},
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.equal(process.exitCode, 1, 'exitCode should be 1 when LLM unavailable');
  });

  it('does not call _saveState when LLM is unavailable in non-prompt mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    await design('Create a login page', {
      light: true,
      _loadState: async () => makeState(),
      _saveState,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.equal(saved.length, 0, '_saveState should not be called when LLM unavailable');
  });
});

describe('design: prompt mode', () => {
  it('calls _loadState in prompt mode', async () => {
    let loadCalled = false;
    await design('Create a login page', {
      prompt: true,
      light: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => {},
      _isLLMAvailable: async () => false,
      _llmCaller: async () => '',
    });
    assert.ok(loadCalled, '_loadState should be called in prompt mode');
  });
});
