import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildTaskPrompt, buildVerifyPrompt, buildReviewPrompt } from '../src/core/prompt-builder.js';

describe('buildTaskPrompt', () => {
  it('includes task name in prompt', () => {
    const prompt = buildTaskPrompt({ name: 'Add login form' }, 'balanced');
    assert.ok(prompt.includes('Add login form'));
  });

  it('includes quality profile description', () => {
    const prompt = buildTaskPrompt({ name: 'test' }, 'quality');
    assert.ok(prompt.includes('thorough, tested, documented'));
  });

  it('includes budget profile description', () => {
    const prompt = buildTaskPrompt({ name: 'test' }, 'budget');
    assert.ok(prompt.includes('fast, minimal, functional'));
  });

  it('includes files when provided', () => {
    const prompt = buildTaskPrompt({ name: 'test', files: ['src/app.ts', 'src/utils.ts'] }, 'balanced');
    assert.ok(prompt.includes('src/app.ts'));
    assert.ok(prompt.includes('src/utils.ts'));
  });

  it('includes verify criteria when provided', () => {
    const prompt = buildTaskPrompt({ name: 'test', verify: 'Tests pass' }, 'balanced');
    assert.ok(prompt.includes('Tests pass'));
  });

  it('includes constitution when provided', () => {
    const prompt = buildTaskPrompt({ name: 'test' }, 'balanced', 'No side effects');
    assert.ok(prompt.includes('No side effects'));
  });

  it('strips control characters from user input', () => {
    const prompt = buildTaskPrompt({ name: 'test\x00\x01\x02task' }, 'balanced');
    assert.ok(!prompt.includes('\x00'));
    assert.ok(prompt.includes('testtask'));
  });
});

describe('buildVerifyPrompt', () => {
  it('includes task name and criteria', () => {
    const prompt = buildVerifyPrompt('Build feature', 'some output', 'All tests pass');
    assert.ok(prompt.includes('Build feature'));
    assert.ok(prompt.includes('All tests pass'));
  });

  it('includes task output', () => {
    const prompt = buildVerifyPrompt('test', 'output data here', 'criteria');
    assert.ok(prompt.includes('output data here'));
  });

  it('includes constitution when provided', () => {
    const prompt = buildVerifyPrompt('test', 'output', 'criteria', 'Security first');
    assert.ok(prompt.includes('Security first'));
  });

  it('asks for PASS or FAIL response', () => {
    const prompt = buildVerifyPrompt('test', 'output', 'criteria');
    assert.ok(prompt.includes('PASS') && prompt.includes('FAIL'));
  });
});

describe('buildReviewPrompt', () => {
  it('includes project name', () => {
    const prompt = buildReviewPrompt({
      projectName: 'TestProject',
      fileTree: ['src/index.ts'],
      recentCommits: [],
      dependencies: null,
      existingDocs: [],
    });
    assert.ok(prompt.includes('TestProject'));
  });

  it('includes file tree', () => {
    const prompt = buildReviewPrompt({
      projectName: 'test',
      fileTree: ['src/app.ts', 'src/utils.ts'],
      recentCommits: [],
      dependencies: null,
      existingDocs: [],
    });
    assert.ok(prompt.includes('src/app.ts'));
    assert.ok(prompt.includes('src/utils.ts'));
  });

  it('truncates long docs', () => {
    const longDoc = 'x'.repeat(600);
    const prompt = buildReviewPrompt({
      projectName: 'test',
      fileTree: [],
      recentCommits: [],
      dependencies: null,
      existingDocs: [{ name: 'README.md', content: longDoc }],
    });
    assert.ok(prompt.includes('(truncated)'));
  });
});
