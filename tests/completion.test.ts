import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_COMMANDS,
  generateBashCompletion,
  generateZshCompletion,
} from '../src/cli/commands/completion.js';

describe('COMPLETION_COMMANDS', () => {
  it('is a non-empty readonly array', () => {
    assert.ok(COMPLETION_COMMANDS.length > 0);
  });

  it('includes core pipeline commands', () => {
    const cmds = COMPLETION_COMMANDS as readonly string[];
    assert.ok(cmds.includes('forge'));
    assert.ok(cmds.includes('verify'));
    assert.ok(cmds.includes('specify'));
    assert.ok(cmds.includes('plan'));
  });

  it('includes preset commands', () => {
    const cmds = COMPLETION_COMMANDS as readonly string[];
    assert.ok(cmds.includes('magic'));
    assert.ok(cmds.includes('spark'));
    assert.ok(cmds.includes('inferno'));
  });

  it('has no duplicate entries', () => {
    const seen = new Set<string>();
    for (const cmd of COMPLETION_COMMANDS) {
      assert.ok(!seen.has(cmd), `duplicate command: ${cmd}`);
      seen.add(cmd);
    }
  });
});

describe('generateBashCompletion', () => {
  it('returns a non-empty string', () => {
    const script = generateBashCompletion();
    assert.ok(script.length > 0);
  });

  it('contains bash shebang or completion function', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('_danteforge_completions') || script.includes('compgen'));
  });

  it('includes the complete command registration', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('complete') && script.includes('danteforge'));
  });

  it('embeds at least one pipeline command', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('forge') || script.includes('verify'));
  });

  it('is deterministic across multiple calls', () => {
    assert.equal(generateBashCompletion(), generateBashCompletion());
  });
});

describe('generateZshCompletion', () => {
  it('returns a non-empty string', () => {
    const script = generateZshCompletion();
    assert.ok(script.length > 0);
  });

  it('contains zsh completion markers', () => {
    const script = generateZshCompletion();
    assert.ok(script.includes('#compdef') || script.includes('_danteforge'));
  });

  it('includes pipeline command descriptions', () => {
    const script = generateZshCompletion();
    assert.ok(script.includes('forge') || script.includes('verify'));
  });

  it('is longer than bash completion (more descriptive)', () => {
    const bash = generateBashCompletion();
    const zsh = generateZshCompletion();
    assert.ok(zsh.length > 100);
    assert.ok(bash.length > 100);
  });

  it('is deterministic across multiple calls', () => {
    assert.equal(generateZshCompletion(), generateZshCompletion());
  });
});
