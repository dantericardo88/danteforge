// Tests for the danteforge-forge SKILL.md — verifies the file exists and
// contains all required sections for autonomous forge phase execution.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SKILL_PATH = resolve('src/harvested/dante-agents/skills/danteforge-forge/SKILL.md');

describe('forge skill', () => {
  let content: string;

  it('skill file exists and has substantive content', async () => {
    content = await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.length > 100, 'SKILL.md must have substantive content');
  });

  it('has valid frontmatter with required fields', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.startsWith('---'), 'must start with YAML frontmatter');
    assert.ok(content.includes('name: danteforge-forge'), 'must have name field');
    assert.ok(content.includes('description:'), 'must have description field');
    assert.ok(content.includes('version:'), 'must have version field');
    assert.ok(content.includes('risk:'), 'must have risk field');
  });

  it('teaches how to read STATE.yaml', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('STATE.yaml'), 'must reference STATE.yaml');
    assert.ok(content.includes('currentPhase'), 'must reference currentPhase field');
    assert.ok(content.includes('tasks'), 'must reference tasks field');
  });

  it('describes the task implementation loop using native AI tools', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('Read') || content.includes('read'), 'must mention reading files');
    assert.ok(content.includes('Edit') || content.includes('Write'), 'must mention editing/writing files');
    assert.ok(content.includes('Bash') || content.includes('bash'), 'must mention running commands');
  });

  it('teaches danteforge verify usage with exit codes', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('danteforge verify'), 'must include danteforge verify command');
    assert.ok(content.includes('exit 0') || content.includes('Exit 0'), 'must explain exit 0 = pass');
    assert.ok(content.includes('exit 1') || content.includes('Exit 1'), 'must explain exit 1 = fail');
  });

  it('describes verification iteration — fix and re-verify', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(
      content.includes('again') || content.includes('repeat') || content.includes('Repeat'),
      'must describe re-running verify after fixing failures'
    );
  });

  it('includes an example workflow', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(
      content.includes('Example') || content.includes('example'),
      'must include an example workflow section'
    );
  });

  it('warns not to call danteforge forge directly (would trigger LLM API)', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(
      content.includes('Do not call') || content.includes('Never call') || content.includes('do not call'),
      'must warn against calling danteforge forge directly'
    );
  });

  it('documents --json flag for structured verify output', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('--json'), 'must document danteforge verify --json flag');
  });

  it('documents the JSON receipt fields (status and failures)', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('"status"') || content.includes('status:') || content.includes('`status`'), 'must reference status field');
    assert.ok(content.includes('"failures"') || content.includes('failures'), 'must reference failures field');
  });

  it('covers multi-phase progression', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(
      content.includes('phase 2') || content.includes('Phase 2') ||
      content.includes('next phase') || content.includes('Multi-Phase'),
      'must explain what to do after phase 1 completes'
    );
  });

  it('mentions danteforge synthesize for end of all phases', async () => {
    content ??= await readFile(SKILL_PATH, 'utf8');
    assert.ok(content.includes('danteforge synthesize'), 'must mention synthesize when all phases complete');
  });
});
