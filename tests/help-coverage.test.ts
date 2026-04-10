// help-coverage.test.ts — COMMAND_HELP covers all known commands (v0.21.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND_HELP } from '../src/cli/commands/help.js';
import { COMPLETION_COMMANDS } from '../src/cli/commands/completion.js';

describe('COMMAND_HELP coverage', () => {
  it('COMMAND_HELP is exported and is a non-empty object', () => {
    assert.ok(typeof COMMAND_HELP === 'object' && COMMAND_HELP !== null);
    assert.ok(Object.keys(COMMAND_HELP).length > 30, `Expected > 30 entries, got ${Object.keys(COMMAND_HELP).length}`);
  });

  it('all COMPLETION_COMMANDS have a COMMAND_HELP entry', () => {
    const missing: string[] = [];
    for (const cmd of COMPLETION_COMMANDS) {
      if (!(cmd in COMMAND_HELP)) {
        missing.push(cmd);
      }
    }
    assert.deepEqual(
      missing,
      [],
      `Commands in COMPLETION_COMMANDS missing from COMMAND_HELP: ${missing.join(', ')}`,
    );
  });

  it('all COMMAND_HELP entries have non-empty string values', () => {
    for (const [cmd, help] of Object.entries(COMMAND_HELP)) {
      assert.ok(typeof help === 'string' && help.length > 0, `Empty help for command: ${cmd}`);
    }
  });

  it('COMMAND_HELP entries include Usage: lines for core commands', () => {
    const coreCommands = ['specify', 'forge', 'autoforge', 'inferno', 'spark'];
    for (const cmd of coreCommands) {
      const help = COMMAND_HELP[cmd];
      assert.ok(help !== undefined, `Missing help entry for: ${cmd}`);
      assert.ok(help.includes('Usage:'), `Help for "${cmd}" missing Usage: line`);
    }
  });
});
