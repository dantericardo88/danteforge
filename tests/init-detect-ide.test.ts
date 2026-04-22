import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { detectRunningIDE } from '../src/cli/commands/init.js';

describe('detectRunningIDE', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const IDE_VARS = ['CLAUDE_CODE', 'CLAUDE_SESSION_ID', 'CURSOR_TRACE_ID', 'CURSOR_CHANNEL',
    'WINDSURF_EXTENSION', 'WINDSURF_AUTH_TOKEN', 'CODEX_DEPLOYMENT_ID', 'GITHUB_COPILOT_TOKEN', 'CONTINUE_EXTENSION_INSTALLED'];

  before(() => {
    for (const key of IDE_VARS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  after(() => {
    for (const key of IDE_VARS) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('returns null when no IDE env vars set', () => {
    const result = detectRunningIDE();
    assert.equal(result, null);
  });

  it('detects Claude Code via CLAUDE_CODE env var', () => {
    process.env['CLAUDE_CODE'] = 'true';
    const result = detectRunningIDE();
    assert.equal(result, 'claude');
    delete process.env['CLAUDE_CODE'];
  });

  it('detects Claude Code via CLAUDE_SESSION_ID', () => {
    process.env['CLAUDE_SESSION_ID'] = 'sess-123';
    const result = detectRunningIDE();
    assert.equal(result, 'claude');
    delete process.env['CLAUDE_SESSION_ID'];
  });

  it('detects Cursor via CURSOR_TRACE_ID', () => {
    process.env['CURSOR_TRACE_ID'] = 'trace-abc';
    const result = detectRunningIDE();
    assert.equal(result, 'cursor');
    delete process.env['CURSOR_TRACE_ID'];
  });

  it('detects Windsurf via WINDSURF_EXTENSION', () => {
    process.env['WINDSURF_EXTENSION'] = 'true';
    const result = detectRunningIDE();
    assert.equal(result, 'windsurf');
    delete process.env['WINDSURF_EXTENSION'];
  });

  it('detects Codex via CODEX_DEPLOYMENT_ID', () => {
    process.env['CODEX_DEPLOYMENT_ID'] = 'dep-001';
    const result = detectRunningIDE();
    assert.equal(result, 'codex');
    delete process.env['CODEX_DEPLOYMENT_ID'];
  });

  it('detects GitHub Copilot via GITHUB_COPILOT_TOKEN', () => {
    process.env['GITHUB_COPILOT_TOKEN'] = 'ghp_123';
    const result = detectRunningIDE();
    assert.equal(result, 'copilot');
    delete process.env['GITHUB_COPILOT_TOKEN'];
  });

  it('detects Continue extension', () => {
    process.env['CONTINUE_EXTENSION_INSTALLED'] = '1';
    const result = detectRunningIDE();
    assert.equal(result, 'continue');
    delete process.env['CONTINUE_EXTENSION_INSTALLED'];
  });
});
