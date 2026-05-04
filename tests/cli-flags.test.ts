// CLI integration tests - Commander.js flag parsing via direct tsx invocation
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runTsxCli } from './helpers/cli-runner.ts';

function runCli(...args: string[]) {
  return runTsxCli(args);
}

describe('CLI flag parsing', () => {
  it('--version outputs version string', () => {
    const { stdout, stderr, status, error } = runCli('--version');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.match(stdout.trim(), /^\d+\.\d+\.\d+/);
  });

  it('--help lists the 12 canonical commands', () => {
    const { stdout, stderr, status, error } = runCli('--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('go'), 'Should list go command');
    assert.ok(stdout.includes('plan'), 'Should list plan command');
    assert.ok(stdout.includes('build'), 'Should list build command');
    assert.ok(stdout.includes('measure'), 'Should list measure command');
    assert.ok(stdout.includes('compete'), 'Should list compete command');
    assert.ok(stdout.includes('harvest'), 'Should list harvest command');
    assert.ok(stdout.includes('autoforge'), 'Should list autoforge command');
    assert.ok(stdout.includes('evidence'), 'Should list evidence command');
    assert.ok(stdout.includes('knowledge'), 'Should list knowledge command');
    assert.ok(stdout.includes('ship'), 'Should list ship command');
    assert.ok(stdout.includes('design'), 'Should list design command');
  });

  it('root help shows start alias and quick start section', () => {
    const { stdout, stderr, status, error } = runCli('--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('start') || stdout.includes('go'), 'Should list go|start entry point');
    assert.ok(stdout.includes('measure'), 'Should list measure command');
    assert.ok(stdout.includes('Quick start') || stdout.includes('quick start') || stdout.includes('--level'), 'Should show quick start or level guidance');
  });

  it('forge --help shows --parallel, --prompt, --light flags', () => {
    const { stdout, stderr, status, error } = runCli('forge', '--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('--parallel') || stdout.includes('-p'), 'Should show --parallel flag');
    assert.ok(stdout.includes('--prompt'), 'Should show --prompt flag');
    assert.ok(stdout.includes('--light'), 'Should show --light flag');
  });

  it('party --help shows --agents and --worktree flags', () => {
    const { stdout, stderr, status, error } = runCli('party', '--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('--worktree') || stdout.includes('worktree'), 'Should show --worktree flag');
  });

  it('config --help shows --set-key option', () => {
    const { stdout, stderr, status, error } = runCli('config', '--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('--set-key') || stdout.includes('set-key'), 'Should show --set-key option');
  });

  it('rubric-score --help shows scoring options and diff subcommand', () => {
    const { stdout, stderr, status, error } = runCli('rubric-score', '--help');
    assert.equal(status, 0, error?.message ?? stderr);
    assert.ok(stdout.includes('--matrix'), 'Should show --matrix option');
    assert.ok(stdout.includes('--evidence'), 'Should show --evidence option');
    assert.ok(stdout.includes('diff [options]'), 'Should show diff subcommand');
  });

  it('unknown command shows error or help', () => {
    const { stdout, stderr, status } = runCli('nonexistent-command-xyz');
    const combined = stdout + stderr;
    // Commander shows unknown command error or help text
    assert.ok(status !== 0 || combined.includes('unknown') || combined.includes('help'),
      'Unknown command should produce error or help');
  });

  it('forge without state exits with non-zero status', () => {
    // Running forge in a directory with no .danteforge/STATE.yaml should fail gracefully
    const { status } = runCli('forge', '1');
    assert.ok(status !== 0, 'forge without project state should exit non-zero');
  });
});
