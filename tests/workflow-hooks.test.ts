// Workflow Hooks tests — loadHooks, fireHook

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadHooks,
  fireHook,
  type HookDefinition,
  type WorkflowHooksOptions,
} from '../src/core/workflow-hooks.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_HOOKS_YAML = `
- command: forge
  when: pre
  run: echo "pre-forge"
  timeout: 5000

- command: verify
  when: post
  run: echo "post-verify"

- command: "*"
  when: pre
  run: echo "wildcard"
`;

const INVALID_HOOK_YAML = `
- command: forge
  when: invalid-when
  run: echo "bad hook"
`;

// ── loadHooks ─────────────────────────────────────────────────────────────────

describe('loadHooks', () => {
  it('returns empty array when file not found', async () => {
    const result = await loadHooks({
      _readFile: async () => { throw new Error('ENOENT'); },
      cwd: '/fake/cwd',
    });
    assert.deepEqual(result, []);
  });

  it('returns empty array for empty content', async () => {
    const result = await loadHooks({
      _readFile: async () => '',
      cwd: '/fake/cwd',
    });
    assert.deepEqual(result, []);
  });

  it('parses valid hook definitions', async () => {
    const result = await loadHooks({
      _readFile: async () => VALID_HOOKS_YAML,
      cwd: '/fake/cwd',
    });
    assert.equal(result.length, 3);
  });

  it('parses hook command, when, run fields', async () => {
    const result = await loadHooks({
      _readFile: async () => VALID_HOOKS_YAML,
      cwd: '/fake/cwd',
    });
    const forgeHook = result.find(h => h.command === 'forge');
    assert.ok(forgeHook);
    assert.equal(forgeHook!.when, 'pre');
    assert.equal(forgeHook!.run, 'echo "pre-forge"');
    assert.equal(forgeHook!.timeout, 5000);
  });

  it('skips items with invalid "when" field', async () => {
    const result = await loadHooks({
      _readFile: async () => INVALID_HOOK_YAML,
      cwd: '/fake/cwd',
    });
    assert.equal(result.length, 0);
  });

  it('returns empty array for non-array YAML', async () => {
    const result = await loadHooks({
      _readFile: async () => 'key: value\n',
      cwd: '/fake/cwd',
    });
    assert.deepEqual(result, []);
  });

  it('reads from .danteforge/hooks.yaml path', async () => {
    let readPath = '';
    await loadHooks({
      _readFile: async (p) => { readPath = p; throw new Error('ENOENT'); },
      cwd: '/fake/cwd',
    });
    assert.ok(readPath.includes('hooks.yaml'));
    assert.ok(readPath.includes('.danteforge'));
  });

  it('wildcard command hook is valid', async () => {
    const result = await loadHooks({
      _readFile: async () => VALID_HOOKS_YAML,
      cwd: '/fake/cwd',
    });
    const wildcard = result.find(h => h.command === '*');
    assert.ok(wildcard);
    assert.equal(wildcard!.when, 'pre');
  });
});

// ── fireHook ──────────────────────────────────────────────────────────────────

describe('fireHook', () => {
  it('returns empty array when no hooks match (no wildcard)', async () => {
    const noWildcardYaml = `
- command: forge
  when: pre
  run: echo "forge"
- command: verify
  when: post
  run: echo "verify"
`;
    const result = await fireHook('nonexistent', 'pre', {
      _readFile: async () => noWildcardYaml,
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      cwd: '/fake/cwd',
    });
    assert.deepEqual(result, []);
  });

  it('matches hooks by command and when', async () => {
    const result = await fireHook('forge', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: async () => ({ exitCode: 0, stdout: 'pre-forge', stderr: '' }),
      cwd: '/fake/cwd',
    });
    // matches 'forge' pre AND wildcard pre
    assert.ok(result.length >= 1);
    const forgeResult = result.find(r => r.hook.command === 'forge');
    assert.ok(forgeResult);
    assert.equal(forgeResult!.exitCode, 0);
    assert.equal(forgeResult!.skipped, false);
  });

  it('wildcard hooks fire for any command', async () => {
    const result = await fireHook('any-command', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
      cwd: '/fake/cwd',
    });
    const wildcardResult = result.find(r => r.hook.command === '*');
    assert.ok(wildcardResult);
  });

  it('does not fire the verify post hook when when=pre', async () => {
    const result = await fireHook('verify', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      cwd: '/fake/cwd',
    });
    // 'verify' only has a post hook — it should NOT appear in pre results
    // (wildcard pre hook may still fire, but not verify's own hook)
    const verifyResult = result.find(r => r.hook.command === 'verify');
    assert.equal(verifyResult, undefined);
  });

  it('records durationMs as non-negative number', async () => {
    const result = await fireHook('forge', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      cwd: '/fake/cwd',
    });
    for (const r of result) {
      assert.ok(r.durationMs >= 0);
    }
  });

  it('returns exitCode from _exec', async () => {
    const yaml = `
- command: forge
  when: pre
  run: echo "test"
`;
    const result = await fireHook('forge', 'pre', {
      _readFile: async () => yaml,
      _exec: async () => ({ exitCode: 42, stdout: 'out', stderr: 'err' }),
      cwd: '/fake/cwd',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].exitCode, 42);
    assert.equal(result[0].stdout, 'out');
    assert.equal(result[0].stderr, 'err');
  });

  it('handles _exec throwing — records exitCode=1 and stderr as error message', async () => {
    const yaml = `
- command: forge
  when: pre
  run: echo "test"
`;
    const result = await fireHook('forge', 'pre', {
      _readFile: async () => yaml,
      _exec: async () => { throw new Error('exec failed'); },
      cwd: '/fake/cwd',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].exitCode, 1);
    assert.ok(result[0].stderr.includes('exec failed'));
    assert.equal(result[0].skipped, false);
  });

  it('returns empty array when no hooks file exists', async () => {
    const result = await fireHook('forge', 'pre', {
      _readFile: async () => { throw new Error('ENOENT'); },
      _exec: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      cwd: '/fake/cwd',
    });
    assert.deepEqual(result, []);
  });
});
