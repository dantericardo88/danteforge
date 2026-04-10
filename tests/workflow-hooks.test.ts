import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadHooks, fireHook, type HookDefinition, type HookFireResult } from '../src/core/workflow-hooks.js';
import {
  loadCustomRoles,
  buildSubagentContextWithCustom,
  getAgentRoles,
  type CustomAgentRoleDefinition,
} from '../src/core/subagent-isolator.js';

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
  run: echo "wildcard-pre"
`;

const makeExec = (exitCode = 0, stdout = 'ok', stderr = '') =>
  async (_cmd: string, _opts: { timeout: number; cwd: string }) => ({ exitCode, stdout, stderr });

describe('workflow-hooks', () => {
  // 1. loadHooks — file not found
  it('loadHooks returns [] when _readFile throws', async () => {
    const result = await loadHooks({
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(result, []);
  });

  // 2. loadHooks — empty content
  it('loadHooks with empty content returns []', async () => {
    const result = await loadHooks({ _readFile: async () => '' });
    assert.deepEqual(result, []);
  });

  // 3. loadHooks — valid content
  it('loadHooks with valid content returns hooks', async () => {
    const hooks = await loadHooks({ _readFile: async () => VALID_HOOKS_YAML });
    assert.equal(hooks.length, 3);
    assert.equal(hooks[0]!.command, 'forge');
    assert.equal(hooks[0]!.when, 'pre');
  });

  // 4. fireHook — no matching hooks
  it('fireHook with no matching hooks returns []', async () => {
    const results = await fireHook('forge', 'post', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(),
    });
    assert.deepEqual(results, []);
  });

  // 5. fireHook — calls _exec for matching hook
  it('fireHook calls _exec for matching hook', async () => {
    let called = false;
    const _exec = async (cmd: string, opts: { timeout: number; cwd: string }) => {
      called = true;
      assert.equal(cmd, 'echo "pre-forge"');
      return { exitCode: 0, stdout: 'pre-forge\n', stderr: '' };
    };
    const results = await fireHook('forge', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec,
      cwd: '/tmp',
    });
    assert.ok(called);
    // both 'forge pre' and wildcard '*' hooks fire
    assert.ok(results.length >= 1);
  });

  // 6. fireHook — matches wildcard '*' hooks
  it('fireHook matches wildcard hooks', async () => {
    const hooks = await loadHooks({ _readFile: async () => VALID_HOOKS_YAML });
    const wildcard = hooks.filter(h => h.command === '*');
    assert.equal(wildcard.length, 1);

    const results = await fireHook('any-command', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(),
    });
    // only wildcard matches for unknown command
    assert.equal(results.length, 1);
    assert.equal(results[0]!.hook.command, '*');
  });

  // 7. fireHook — includes exitCode in result
  it('fireHook includes exitCode in result', async () => {
    const results = await fireHook('verify', 'post', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(42, '', ''),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.exitCode, 42);
  });

  // 8. fireHook — includes stdout in result
  it('fireHook includes stdout in result', async () => {
    const results = await fireHook('verify', 'post', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(0, 'hello stdout', ''),
    });
    assert.equal(results[0]!.stdout, 'hello stdout');
  });

  // 9. hook timeout defaults to 30000
  it('hook timeout defaults to 30000 when not specified', async () => {
    let capturedTimeout = 0;
    const _exec = async (_cmd: string, opts: { timeout: number; cwd: string }) => {
      capturedTimeout = opts.timeout;
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    const yamlNoTimeout = `
- command: verify
  when: post
  run: echo hi
`;
    await fireHook('verify', 'post', {
      _readFile: async () => yamlNoTimeout,
      _exec,
    });
    assert.equal(capturedTimeout, 30000);
  });

  // 10. fireHook — respects continueOnError (hook fires even on failure)
  it('fireHook returns result regardless of exitCode', async () => {
    const yaml = `
- command: forge
  when: pre
  run: echo fail
  continueOnError: true
`;
    const results = await fireHook('forge', 'pre', {
      _readFile: async () => yaml,
      _exec: makeExec(1, '', 'error'),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.exitCode, 1);
  });

  // 11. HookFireResult has durationMs
  it('HookFireResult has durationMs field', async () => {
    const results = await fireHook('verify', 'post', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(),
    });
    assert.ok(typeof results[0]!.durationMs === 'number');
    assert.ok(results[0]!.durationMs >= 0);
  });

  // 12. loadCustomRoles — throws
  it('loadCustomRoles returns [] when _readFile throws', async () => {
    const result = await loadCustomRoles({
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.deepEqual(result, []);
  });

  // 13. loadCustomRoles — parses custom role from YAML
  it('loadCustomRoles parses a custom role from YAML', async () => {
    const yaml = `
- role: qa
  contextKeys:
    - testResults
    - plan
  constraints:
    - Do not write implementation code
    - Focus on test coverage
`;
    const roles = await loadCustomRoles({ _readFile: async () => yaml, cwd: '/tmp/test' });
    assert.equal(roles.length, 1);
    assert.equal(roles[0]!.role, 'qa');
    assert.deepEqual(roles[0]!.contextKeys, ['testResults', 'plan']);
    assert.deepEqual(roles[0]!.constraints, ['Do not write implementation code', 'Focus on test coverage']);
  });

  // 14. buildSubagentContextWithCustom — built-in role delegates to built-in handler
  it('buildSubagentContextWithCustom with built-in role delegates correctly', () => {
    const ctx = buildSubagentContextWithCustom('agent1', { plan: 'do the thing', tasks: 'task1' }, 'dev', []);
    assert.equal(ctx.role, 'dev');
    assert.ok(ctx.systemPrompt.includes('dev'));
    assert.ok(ctx.constraints.length > 0);
  });

  // 15. buildSubagentContextWithCustom — uses custom contextKeys
  it('buildSubagentContextWithCustom with custom role uses custom contextKeys', () => {
    const customRoles: CustomAgentRoleDefinition[] = [{
      role: 'qa',
      contextKeys: ['testResults'],
      constraints: ['Focus on quality'],
    }];
    const ctx = buildSubagentContextWithCustom(
      'qa-agent',
      { testResults: 'all passing', plan: 'do stuff' },
      'qa',
      customRoles,
    );
    assert.ok(ctx.projectContext.includes('testResults'));
    assert.ok(!ctx.projectContext.includes('plan'));
  });

  // 16. buildSubagentContextWithCustom — uses custom constraints
  it('buildSubagentContextWithCustom with custom role uses custom constraints', () => {
    const customRoles: CustomAgentRoleDefinition[] = [{
      role: 'security',
      contextKeys: [],
      constraints: ['Check for XSS', 'Validate all inputs'],
    }];
    const ctx = buildSubagentContextWithCustom('sec-agent', {}, 'security', customRoles);
    assert.deepEqual(ctx.constraints, ['Check for XSS', 'Validate all inputs']);
  });

  // 17. buildSubagentContextWithCustom — unknown role returns fallback context
  it('buildSubagentContextWithCustom with unknown role returns fallback context', () => {
    const ctx = buildSubagentContextWithCustom('unknown-agent', { foo: 'bar' }, 'unknown-role', []);
    assert.equal(ctx.role, 'unknown-role');
    assert.deepEqual(ctx.constraints, []);
    assert.equal(ctx.projectContext, '');
  });

  // 18. getAgentRoles still returns exactly 6 built-in roles
  it('getAgentRoles returns exactly 6 built-in roles', () => {
    const roles = getAgentRoles();
    assert.equal(roles.length, 6);
    const expected = ['pm', 'architect', 'dev', 'ux', 'design', 'scrum-master'];
    for (const role of expected) {
      assert.ok(roles.includes(role as never), `role "${role}" should be in getAgentRoles()`);
    }
  });

  // 19. fireHook 'verify' 'post' with matching hook calls stub
  it('fireHook verify post calls the _exec stub', async () => {
    let execCalled = false;
    const results = await fireHook('verify', 'post', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: async (cmd, _opts) => {
        execCalled = true;
        assert.equal(cmd, 'echo "post-verify"');
        return { exitCode: 0, stdout: 'post-verify\n', stderr: '' };
      },
    });
    assert.ok(execCalled);
    assert.equal(results.length, 1);
  });

  // 20. fireHook — multiple matching hooks return multiple results
  it('fireHook with multiple matching hooks returns multiple results', async () => {
    // 'forge pre' hook + wildcard '*' pre hook both match
    const results = await fireHook('forge', 'pre', {
      _readFile: async () => VALID_HOOKS_YAML,
      _exec: makeExec(),
    });
    assert.equal(results.length, 2);
  });

  // 21. fireHook — respects hook timeout parameter
  it('fireHook passes hook timeout to _exec', async () => {
    let capturedTimeout = 0;
    const yaml = `
- command: forge
  when: pre
  run: echo hi
  timeout: 12345
`;
    await fireHook('forge', 'pre', {
      _readFile: async () => yaml,
      _exec: async (_cmd, opts) => {
        capturedTimeout = opts.timeout;
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    assert.equal(capturedTimeout, 12345);
  });

  // 22. loadHooks — ignores hooks with missing required fields
  it('loadHooks ignores hooks with missing required fields', async () => {
    const yaml = `
- command: forge
  when: pre
  run: echo ok
- command: verify
  when: post
  # missing run field
- run: echo no-command
  when: pre
  # missing command field
`;
    const hooks = await loadHooks({ _readFile: async () => yaml });
    // Only the first hook is valid
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0]!.command, 'forge');
  });
});
