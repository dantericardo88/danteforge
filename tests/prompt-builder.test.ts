import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildTaskPrompt,
  buildVerifyPrompt,
  buildReviewPrompt,
  buildDesignPrompt,
  buildDesignRefinePrompt,
  buildTokenSyncPrompt,
  buildUXRefinePullPrompt,
} from '../src/core/prompt-builder.js';

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

// ─── buildDesignPrompt ────────────────────────────────────────────────────

describe('buildDesignPrompt', () => {
  it('includes the user design request', () => {
    const prompt = buildDesignPrompt('Create a login form with email and password fields');
    assert.ok(prompt.includes('login form'), 'Prompt should include design request');
  });

  it('includes constitution when provided', () => {
    const prompt = buildDesignPrompt('Create dashboard', 'All components use 4px grid', 'React + Tailwind');
    assert.ok(prompt.includes('4px grid'), 'Should include constitution principles');
    assert.ok(prompt.includes('React + Tailwind'), 'Should include tech stack');
  });

  it('includes .op JSON format instructions', () => {
    const prompt = buildDesignPrompt('Build sidebar');
    assert.ok(prompt.includes('formatVersion'), 'Should reference .op format');
    assert.ok(prompt.includes('variableCollections'), 'Should mention design tokens');
  });

  it('requests output only JSON — no preamble', () => {
    const prompt = buildDesignPrompt('Hero section');
    assert.ok(prompt.includes('Output ONLY'), 'Should request clean JSON output');
  });

  it('strips control characters from user input', () => {
    const prompt = buildDesignPrompt('Login\x00Form\x01Design');
    assert.ok(!prompt.includes('\x00'), 'Should strip null bytes');
    assert.ok(prompt.includes('LoginFormDesign'), 'Should keep text content');
  });
});

// ─── buildDesignRefinePrompt ──────────────────────────────────────────────

describe('buildDesignRefinePrompt', () => {
  it('includes current .op content and refinement instructions', () => {
    const opContent = '{"formatVersion":"1.0.0","nodes":[]}';
    const instructions = 'Change primary button color to #3B82F6';
    const prompt = buildDesignRefinePrompt(opContent, instructions);
    assert.ok(prompt.includes('1.0.0'), 'Should include current design file');
    assert.ok(prompt.includes('#3B82F6'), 'Should include refinement instructions');
  });

  it('includes constitution when provided', () => {
    const prompt = buildDesignRefinePrompt('{}', 'Make it dark mode', 'Prefer dark themes');
    assert.ok(prompt.includes('Prefer dark themes'), 'Should include constitution');
  });

  it('instructs to preserve existing node IDs', () => {
    const prompt = buildDesignRefinePrompt('{}', 'Update spacing');
    assert.ok(prompt.includes('node IDs'), 'Should instruct to preserve node IDs');
  });
});

// ─── buildTokenSyncPrompt ─────────────────────────────────────────────────

describe('buildTokenSyncPrompt', () => {
  it('generates CSS format instructions', () => {
    const prompt = buildTokenSyncPrompt('{"variableCollections":[]}', 'css');
    assert.ok(prompt.includes('CSS custom properties'), 'Should reference CSS format');
  });

  it('generates Tailwind format instructions', () => {
    const prompt = buildTokenSyncPrompt('{}', 'tailwind');
    assert.ok(prompt.includes('Tailwind CSS theme'), 'Should reference Tailwind format');
  });

  it('generates styled-components format instructions', () => {
    const prompt = buildTokenSyncPrompt('{}', 'styled-components');
    assert.ok(prompt.includes('theme object'), 'Should reference styled-components format');
  });

  it('includes the .op design file content', () => {
    const opContent = '{"variableCollections":[{"name":"brand-colors"}]}';
    const prompt = buildTokenSyncPrompt(opContent, 'css');
    assert.ok(prompt.includes('brand-colors'), 'Should include the .op content');
  });

  it('includes semantic naming rule', () => {
    const prompt = buildTokenSyncPrompt('{}', 'css');
    assert.ok(prompt.includes('semantic naming'), 'Should specify semantic naming');
  });
});

// ─── buildUXRefinePullPrompt ──────────────────────────────────────────────

describe('buildUXRefinePullPrompt', () => {
  it('includes figma URL and token file path', () => {
    const prompt = buildUXRefinePullPrompt(
      'https://figma.com/file/abc123',
      'src/styles/tokens.css',
    );
    assert.ok(prompt.includes('abc123'), 'Should include Figma URL');
    assert.ok(prompt.includes('tokens.css'), 'Should include token file path');
  });

  it('includes constitution when provided', () => {
    const prompt = buildUXRefinePullPrompt(
      'https://figma.com/file/xyz',
      'src/tokens.css',
      'Always use 4px grid',
    );
    assert.ok(prompt.includes('4px grid'), 'Should include constitution principles');
  });

  it('instructs to extract and compare design tokens', () => {
    const prompt = buildUXRefinePullPrompt('https://figma.com/file/abc', 'tokens.css');
    assert.ok(prompt.includes('design tokens'), 'Should mention design tokens');
  });
});
