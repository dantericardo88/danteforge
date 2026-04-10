// tests/quickstart-simple.test.ts — simple-mode quickstart + init tests
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { SIMPLE_CONSTITUTION_TEMPLATE, quickstart } from '../src/cli/commands/quickstart.js';

// ── Template unit tests ──────────────────────────────────────────────────────

describe('SIMPLE_CONSTITUTION_TEMPLATE', () => {
  it('contains the project name in the heading', () => {
    const output = SIMPLE_CONSTITUTION_TEMPLATE('My App');
    assert.ok(output.includes('# Project Constitution — My App'));
  });

  it('contains "Write tests"', () => {
    const output = SIMPLE_CONSTITUTION_TEMPLATE('Test Project');
    assert.ok(output.includes('Write tests'));
  });

  it('contains "80%"', () => {
    const output = SIMPLE_CONSTITUTION_TEMPLATE('Test Project');
    assert.ok(output.includes('80%'));
  });

  it('returns a non-empty string', () => {
    const output = SIMPLE_CONSTITUTION_TEMPLATE('X');
    assert.ok(typeof output === 'string' && output.length > 0);
  });

  it('uses a custom project name in the heading', () => {
    const output = SIMPLE_CONSTITUTION_TEMPLATE('Rocket Ship');
    assert.ok(output.includes('# Project Constitution — Rocket Ship'));
  });
});

// ── quickstart simple-mode tests ─────────────────────────────────────────────

describe('quickstart --simple', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qs-simple-'));
  });

  it('calls _writeFile with CONSTITUTION.md content', async () => {
    const written: { path: string; content: string }[] = [];
    await quickstart({
      simple: true,
      projectName: 'MyTestApp',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async (p, content) => { written.push({ path: p, content }); },
      _scoreArtifacts: async () => 42,
    });
    assert.ok(written.length >= 1, 'expected at least one write call');
    const constitutionWrite = written.find((w) => w.path.includes('CONSTITUTION.md'));
    assert.ok(constitutionWrite, '_writeFile not called with CONSTITUTION.md');
    assert.ok(constitutionWrite.content.includes('# Project Constitution — MyTestApp'));
  });

  it('prints "danteforge specify" to _stdout', async () => {
    const lines: string[] = [];
    await quickstart({
      simple: true,
      projectName: 'MyTestApp',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => 0,
      _stdout: (line) => lines.push(line),
    });
    assert.ok(lines.some((l) => l.includes('danteforge specify')));
  });

  it('prints "danteforge autoforge" to _stdout', async () => {
    const lines: string[] = [];
    await quickstart({
      simple: true,
      projectName: 'MyTestApp',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => 0,
      _stdout: (line) => lines.push(line),
    });
    assert.ok(lines.some((l) => l.includes('danteforge autoforge')));
  });

  it('prints "danteforge verify" to _stdout', async () => {
    const lines: string[] = [];
    await quickstart({
      simple: true,
      projectName: 'MyTestApp',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => 0,
      _stdout: (line) => lines.push(line),
    });
    assert.ok(lines.some((l) => l.includes('danteforge verify')));
  });

  it('calls _scoreArtifacts injection when provided', async () => {
    let scoreCalled = false;
    await quickstart({
      simple: true,
      projectName: 'ScoreTest',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => { scoreCalled = true; return 55; },
    });
    assert.ok(scoreCalled, '_scoreArtifacts was not called');
  });

  it('prints the score to _stdout when _scoreArtifacts returns a value', async () => {
    const lines: string[] = [];
    await quickstart({
      simple: true,
      projectName: 'ScoreTest',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => 77,
      _stdout: (line) => lines.push(line),
    });
    assert.ok(lines.some((l) => l.includes('77')));
  });

  it('uses custom project name in the constitution content written to disk', async () => {
    const written: { path: string; content: string }[] = [];
    await quickstart({
      simple: true,
      projectName: 'UniqueProjectName',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async (p, content) => { written.push({ path: p, content }); },
      _scoreArtifacts: async () => 0,
    });
    const constitutionWrite = written.find((w) => w.path.includes('CONSTITUTION.md'));
    assert.ok(constitutionWrite, '_writeFile not called with CONSTITUTION.md');
    assert.ok(constitutionWrite.content.includes('UniqueProjectName'));
  });

  it('falls back to "My Project" when no projectName provided', async () => {
    const written: { path: string; content: string }[] = [];
    await quickstart({
      simple: true,
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async (p, content) => { written.push({ path: p, content }); },
      _scoreArtifacts: async () => 0,
    });
    const constitutionWrite = written.find((w) => w.path.includes('CONSTITUTION.md'));
    assert.ok(constitutionWrite, '_writeFile not called with CONSTITUTION.md');
    assert.ok(constitutionWrite.content.includes('My Project'));
  });

  it('does NOT call _runInit or _runConstitution in simple mode', async () => {
    let initCalled = false;
    let constitutionCalled = false;
    await quickstart({
      simple: true,
      projectName: 'NoPipelineTest',
      cwd: tmpDir,
      nonInteractive: true,
      _writeFile: async () => {},
      _scoreArtifacts: async () => 0,
      _runInit: async () => { initCalled = true; },
      _runConstitution: async () => { constitutionCalled = true; },
    });
    assert.ok(!initCalled, '_runInit should NOT be called in simple mode');
    assert.ok(!constitutionCalled, '_runConstitution should NOT be called in simple mode');
  });
});
