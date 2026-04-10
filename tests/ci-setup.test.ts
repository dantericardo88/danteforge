import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  ciSetup,
  buildGitHubWorkflow,
  buildGitLabCI,
  buildBitbucketPipelines,
  resolveWorkflowPath,
} from '../src/cli/commands/ci-setup.js';
import { detectHost } from '../src/core/mcp.js';
import { resolveTier } from '../src/core/mcp-adapter.js';

// ──────────────────────────────────────────────────────────────
// buildGitHubWorkflow
// ──────────────────────────────────────────────────────────────

describe('buildGitHubWorkflow', () => {
  it('contains DanteForge Quality Gate', () => {
    const yaml = buildGitHubWorkflow('main');
    assert.ok(yaml.includes('DanteForge Quality Gate'));
  });

  it('contains danteforge verify', () => {
    const yaml = buildGitHubWorkflow('main');
    assert.ok(yaml.includes('danteforge verify'));
  });

  it('contains latest-pdse.json', () => {
    const yaml = buildGitHubWorkflow('main');
    assert.ok(yaml.includes('latest-pdse.json'));
  });

  it('contains actions/github-script', () => {
    const yaml = buildGitHubWorkflow('main');
    assert.ok(yaml.includes('actions/github-script'));
  });

  it('contains branch name when develop is passed', () => {
    const yaml = buildGitHubWorkflow('develop');
    assert.ok(yaml.includes('develop'));
  });
});

// ──────────────────────────────────────────────────────────────
// buildGitLabCI
// ──────────────────────────────────────────────────────────────

describe('buildGitLabCI', () => {
  it('contains danteforge verify', () => {
    const yaml = buildGitLabCI('main');
    assert.ok(yaml.includes('danteforge verify'));
  });

  it('contains merge_requests', () => {
    const yaml = buildGitLabCI('main');
    assert.ok(yaml.includes('merge_requests'));
  });
});

// ──────────────────────────────────────────────────────────────
// buildBitbucketPipelines
// ──────────────────────────────────────────────────────────────

describe('buildBitbucketPipelines', () => {
  it('contains danteforge verify', () => {
    const yaml = buildBitbucketPipelines('main');
    assert.ok(yaml.includes('danteforge verify'));
  });

  it('contains pipelines', () => {
    const yaml = buildBitbucketPipelines('main');
    assert.ok(yaml.includes('pipelines'));
  });
});

// ──────────────────────────────────────────────────────────────
// resolveWorkflowPath
// ──────────────────────────────────────────────────────────────

describe('resolveWorkflowPath', () => {
  it('github path ends with danteforge.yml', () => {
    const p = resolveWorkflowPath('github', '/tmp');
    assert.ok(p.endsWith('danteforge.yml'));
  });

  it('github path includes .github/workflows', () => {
    const p = resolveWorkflowPath('github', '/tmp');
    assert.ok(p.includes('.github') && p.includes('workflows'));
  });

  it('gitlab path ends with .gitlab-ci.yml', () => {
    const p = resolveWorkflowPath('gitlab', '/tmp');
    assert.ok(p.endsWith('.gitlab-ci.yml'));
  });

  it('bitbucket path ends with bitbucket-pipelines.yml', () => {
    const p = resolveWorkflowPath('bitbucket', '/tmp');
    assert.ok(p.endsWith('bitbucket-pipelines.yml'));
  });

  it('github with custom outputDir uses that dir', () => {
    const p = resolveWorkflowPath('github', '/tmp', '/custom');
    // Normalize so test passes on both Unix (/) and Windows (\)
    const normalized = p.replace(/\\/g, '/');
    assert.ok(normalized.startsWith('/custom'));
    assert.ok(p.endsWith('danteforge.yml'));
  });
});

// ──────────────────────────────────────────────────────────────
// ciSetup
// ──────────────────────────────────────────────────────────────

describe('ciSetup', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-setup-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('resolves with provider, writtenPath, and content for github', async () => {
    let written = '';
    const result = await ciSetup({
      provider: 'github',
      cwd: tmpDir,
      _writeFile: async (_p, content) => { written = content; },
      _mkdir: async () => {},
      _stdout: () => {},
    });
    assert.strictEqual(result.provider, 'github');
    assert.ok(result.writtenPath.endsWith('danteforge.yml'));
    assert.ok(result.content.includes('DanteForge Quality Gate'));
    assert.strictEqual(result.content, written);
  });

  it('ciSetup with provider gitlab writes gitlab content', async () => {
    let written = '';
    const result = await ciSetup({
      provider: 'gitlab',
      cwd: tmpDir,
      _writeFile: async (_p, content) => { written = content; },
      _mkdir: async () => {},
      _stdout: () => {},
    });
    assert.strictEqual(result.provider, 'gitlab');
    assert.ok(result.writtenPath.endsWith('.gitlab-ci.yml'));
    assert.ok(written.includes('merge_requests'));
  });

  it('defaults to github when no provider given', async () => {
    const result = await ciSetup({
      cwd: tmpDir,
      _writeFile: async () => {},
      _mkdir: async () => {},
      _stdout: () => {},
    });
    assert.strictEqual(result.provider, 'github');
  });

  it('calls _writeFile with the correct path', async () => {
    const calledPaths: string[] = [];
    await ciSetup({
      provider: 'github',
      cwd: tmpDir,
      _writeFile: async (p) => { calledPaths.push(p); },
      _mkdir: async () => {},
      _stdout: () => {},
    });
    assert.strictEqual(calledPaths.length, 1);
    assert.ok(calledPaths[0]!.endsWith('danteforge.yml'));
    assert.ok(calledPaths[0]!.includes('.github'));
  });

  it('ciSetup with provider bitbucket writes bitbucket content', async () => {
    let written = '';
    const result = await ciSetup({
      provider: 'bitbucket',
      cwd: tmpDir,
      _writeFile: async (_p, content) => { written = content; },
      _mkdir: async () => {},
      _stdout: () => {},
    });
    assert.strictEqual(result.provider, 'bitbucket');
    assert.ok(result.writtenPath.endsWith('bitbucket-pipelines.yml'));
    assert.ok(written.includes('pipelines'));
  });
});

// ──────────────────────────────────────────────────────────────
// detectHost — JetBrains
// ──────────────────────────────────────────────────────────────

describe('detectHost — jetbrains', () => {
  it('returns jetbrains when override is jetbrains', () => {
    assert.strictEqual(detectHost('jetbrains'), 'jetbrains');
  });

  it('returns jetbrains when IDEA_INITIAL_DIRECTORY is set (env detection)', () => {
    // Save and clear all env vars that take precedence
    const savedVars: Record<string, string | undefined> = {};
    const toClear = [
      'CLAUDE_CODE', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR',
      'CURSOR_SESSION', 'CURSOR_TRACE_ID',
      'CODEX_SESSION', 'CODEX', 'CODEX_ENV',
      'WINDSURF_SESSION',
      'VSCODE_PID', 'VSCODE_CWD',
      'INTELLIJ_ENVIRONMENT_READER',
    ];
    for (const v of toClear) {
      savedVars[v] = process.env[v];
      delete process.env[v];
    }
    // Also handle TERM_PROGRAM
    const savedTermProgram = process.env.TERM_PROGRAM;
    delete process.env.TERM_PROGRAM;

    process.env.IDEA_INITIAL_DIRECTORY = '/some/project';
    try {
      assert.strictEqual(detectHost(), 'jetbrains');
    } finally {
      delete process.env.IDEA_INITIAL_DIRECTORY;
      for (const v of toClear) {
        if (savedVars[v] !== undefined) process.env[v] = savedVars[v];
      }
      if (savedTermProgram !== undefined) process.env.TERM_PROGRAM = savedTermProgram;
    }
  });

  it('returns jetbrains when INTELLIJ_ENVIRONMENT_READER is set (env detection)', () => {
    const savedVars: Record<string, string | undefined> = {};
    const toClear = [
      'CLAUDE_CODE', 'CLAUDE_SESSION_ID', 'CLAUDE_PROJECT_DIR',
      'CURSOR_SESSION', 'CURSOR_TRACE_ID',
      'CODEX_SESSION', 'CODEX', 'CODEX_ENV',
      'WINDSURF_SESSION',
      'VSCODE_PID', 'VSCODE_CWD',
      'IDEA_INITIAL_DIRECTORY',
    ];
    for (const v of toClear) {
      savedVars[v] = process.env[v];
      delete process.env[v];
    }
    const savedTermProgram = process.env.TERM_PROGRAM;
    delete process.env.TERM_PROGRAM;

    process.env.INTELLIJ_ENVIRONMENT_READER = '1';
    try {
      assert.strictEqual(detectHost(), 'jetbrains');
    } finally {
      delete process.env.INTELLIJ_ENVIRONMENT_READER;
      for (const v of toClear) {
        if (savedVars[v] !== undefined) process.env[v] = savedVars[v];
      }
      if (savedTermProgram !== undefined) process.env.TERM_PROGRAM = savedTermProgram;
    }
  });
});

// ──────────────────────────────────────────────────────────────
// resolveTier
// ──────────────────────────────────────────────────────────────

describe('resolveTier', () => {
  it('cursor with figma returns full', () => {
    assert.strictEqual(resolveTier('cursor', true), 'full');
  });

  it('jetbrains with figma returns pull-only', () => {
    assert.strictEqual(resolveTier('jetbrains', true), 'pull-only');
  });

  it('claude-code with figma still returns full', () => {
    assert.strictEqual(resolveTier('claude-code', true), 'full');
  });

  it('jetbrains without figma returns prompt-only', () => {
    assert.strictEqual(resolveTier('jetbrains', false), 'prompt-only');
  });
});
