// completion-scripts.test.ts — shell completion script generator (v0.21.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBashCompletion,
  generateZshCompletion,
  generateFishCompletion,
  completionCmd,
  COMPLETION_COMMANDS,
} from '../src/cli/commands/completion.js';

describe('COMPLETION_COMMANDS array', () => {
  it('contains at least 60 commands', () => {
    assert.ok(COMPLETION_COMMANDS.length >= 60, `Expected >= 60 commands, got ${COMPLETION_COMMANDS.length}`);
  });

  it('contains core pipeline commands', () => {
    const core = ['init', 'constitution', 'specify', 'clarify', 'plan', 'tasks', 'forge', 'verify', 'synthesize'];
    for (const cmd of core) {
      assert.ok(COMPLETION_COMMANDS.includes(cmd as never), `Missing core command: ${cmd}`);
    }
  });

  it('contains all preset ladder commands', () => {
    const presets = ['spark', 'ember', 'canvas', 'magic', 'blaze', 'nova', 'inferno'];
    for (const p of presets) {
      assert.ok(COMPLETION_COMMANDS.includes(p as never), `Missing preset: ${p}`);
    }
  });

  it('contains no duplicates', () => {
    const seen = new Set<string>();
    for (const cmd of COMPLETION_COMMANDS) {
      assert.ok(!seen.has(cmd), `Duplicate command: ${cmd}`);
      seen.add(cmd);
    }
  });
});

describe('generateBashCompletion', () => {
  it('returns a non-empty string', () => {
    const script = generateBashCompletion();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  it('contains _danteforge_completions function definition', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('_danteforge_completions'), 'Missing completion function name');
  });

  it('registers complete -F _danteforge_completions danteforge', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('complete -F _danteforge_completions danteforge'), 'Missing complete registration');
  });

  it('includes --profile quality balanced budget completions', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('quality'), 'Missing quality profile');
    assert.ok(script.includes('balanced'), 'Missing balanced profile');
    assert.ok(script.includes('budget'), 'Missing budget profile');
  });

  it('includes bash shebang-style comment and eval usage hint', () => {
    const script = generateBashCompletion();
    assert.ok(script.includes('eval "$(danteforge completion bash)"'), 'Missing eval usage hint');
  });
});

describe('generateZshCompletion', () => {
  it('returns a non-empty string', () => {
    const script = generateZshCompletion();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  it('starts with #compdef danteforge', () => {
    const script = generateZshCompletion();
    assert.ok(script.startsWith('#compdef danteforge'), `Expected #compdef, got: ${script.slice(0, 30)}`);
  });

  it('contains _danteforge_commands function', () => {
    const script = generateZshCompletion();
    assert.ok(script.includes('_danteforge_commands'), 'Missing _danteforge_commands function');
  });

  it('includes command descriptions (colon-separated)', () => {
    const script = generateZshCompletion();
    // zsh completions use 'cmd:description' format
    assert.ok(script.includes('init:'), 'Missing init command description');
    assert.ok(script.includes('forge:'), 'Missing forge command description');
  });
});

describe('generateFishCompletion', () => {
  it('returns a non-empty string', () => {
    const script = generateFishCompletion();
    assert.ok(typeof script === 'string' && script.length > 0);
  });

  it('contains complete -c danteforge entries', () => {
    const script = generateFishCompletion();
    assert.ok(script.includes('complete -c danteforge'), 'Missing complete -c danteforge');
  });

  it('includes --profile completions', () => {
    const script = generateFishCompletion();
    assert.ok(script.includes('quality balanced budget'), 'Missing profile completions');
  });

  it('includes subcommand completions for setup and forge', () => {
    const script = generateFishCompletion();
    assert.ok(script.includes('assistants figma ollama'), 'Missing setup completions');
    assert.ok(script.includes('1 2 3 4 5'), 'Missing forge phase completions');
  });
});

describe('completionCmd', () => {
  it('writes bash script to stdout for "bash" argument', async () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
    try {
      await completionCmd('bash');
    } finally {
      process.stdout.write = orig;
    }
    const output = chunks.join('');
    assert.ok(output.includes('_danteforge_completions'), 'Bash output missing function');
  });

  it('writes zsh script to stdout for "zsh" argument', async () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
    try {
      await completionCmd('zsh');
    } finally {
      process.stdout.write = orig;
    }
    const output = chunks.join('');
    assert.ok(output.includes('#compdef'), 'Zsh output missing #compdef');
  });

  it('defaults to bash when no shell argument provided', async () => {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => { chunks.push(chunk); return true; }) as typeof process.stdout.write;
    try {
      await completionCmd(undefined);
    } finally {
      process.stdout.write = orig;
    }
    const output = chunks.join('');
    assert.ok(output.includes('_danteforge_completions'), 'Default (no arg) should produce bash');
  });
});
