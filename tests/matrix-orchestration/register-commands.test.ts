// CLI registration tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from 'commander';
import { registerMatrixOrchestrationCommands } from '../../src/cli/register-matrix-orchestration-commands.js';

function freshProgram(): Command {
  const program = new Command();
  program.exitOverride();   // don't process.exit when help is invoked
  return program;
}

function registeredCommandNames(matrix: Command | undefined): string[] {
  if (!matrix) return [];
  return matrix.commands.map(c => c.name());
}

describe('register-matrix-orchestration-commands', () => {
  it('registers the top-level matrix-orchestrate command', () => {
    const program = freshProgram();
    registerMatrixOrchestrationCommands(program);
    const matrix = program.commands.find(c => c.name() === 'matrix-orchestrate');
    assert.ok(matrix, 'matrix-orchestrate command not registered');
  });

  it('registers all expected subcommands', () => {
    const program = freshProgram();
    registerMatrixOrchestrationCommands(program);
    const matrix = program.commands.find(c => c.name() === 'matrix-orchestrate');
    const names = registeredCommandNames(matrix);
    for (const expected of [
      'read', 'discover', 'analyze', 'synthesize-dimensions', 'score',
      'detect-capacity', 'execute-phase-a', 'execute-phase-b',
      'report', 'status', 'logs', 'learning-state', 'replay',
    ]) {
      assert.ok(names.includes(expected), `missing subcommand: ${expected}`);
    }
  });

  it('matrix command accepts --target and --max-cost options', () => {
    const program = freshProgram();
    registerMatrixOrchestrationCommands(program);
    const matrix = program.commands.find(c => c.name() === 'matrix-orchestrate');
    const optNames = matrix?.options.map(o => o.long) ?? [];
    assert.ok(optNames.includes('--target'));
    assert.ok(optNames.includes('--max-cost'));
    assert.ok(optNames.includes('--skip-approval'));
  });

  it('matrix read subcommand parses --mode option', () => {
    const program = freshProgram();
    registerMatrixOrchestrationCommands(program);
    const matrix = program.commands.find(c => c.name() === 'matrix-orchestrate');
    const read = matrix?.commands.find(c => c.name() === 'read');
    const opts = read?.options.map(o => o.long) ?? [];
    assert.ok(opts.includes('--mode'));
  });

  it('execute-phase-b is wired (registered with --max-cost)', () => {
    const program = freshProgram();
    registerMatrixOrchestrationCommands(program);
    const matrix = program.commands.find(c => c.name() === 'matrix-orchestrate');
    const phaseB = matrix?.commands.find(c => c.name() === 'execute-phase-b');
    assert.ok(phaseB);
    const opts = phaseB?.options.map(o => o.long) ?? [];
    assert.ok(opts.includes('--max-cost'));
  });
});
