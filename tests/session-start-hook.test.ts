import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

describe('Claude SessionStart hook', () => {
  it('emits valid Claude Code hook JSON with hookEventName', () => {
    const result = spawnSync(process.execPath, ['hooks/session-start.mjs'], {
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    const parsed = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
    };
    assert.equal(parsed.hookSpecificOutput?.hookEventName, 'SessionStart');
    assert.equal(typeof parsed.hookSpecificOutput?.additionalContext, 'string');
  });
});
