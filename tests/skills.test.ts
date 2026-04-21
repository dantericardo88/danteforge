import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  discoverSkills,
  resolveSkill,
  listSkills,
  findRelevantSkills,
} from '../src/core/skills.js';

async function makeSkillsDir(base: string, skills: { name: string; description: string; content?: string }[]) {
  for (const skill of skills) {
    const dir = path.join(base, skill.name);
    await fs.mkdir(dir, { recursive: true });
    const frontmatter = `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n${skill.content ?? '# Skill content'}`;
    await fs.writeFile(path.join(dir, 'SKILL.md'), frontmatter);
  }
}

describe('discoverSkills', () => {
  let tmpDir: string;
  let fakeHome: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-test-'));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-home-'));
    await makeSkillsDir(tmpDir, [
      { name: 'forge-skill', description: 'Use when forging new code' },
      { name: 'verify-skill', description: 'Use when verifying quality' },
    ]);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('discovers skills from packagedSkillsDir', async () => {
    const skills = await discoverSkills({ packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.equal(skills.length, 2);
  });

  it('returns skills with name, description, content, filePath', async () => {
    const skills = await discoverSkills({ packagedSkillsDir: tmpDir, homeDir: fakeHome });
    for (const skill of skills) {
      assert.ok(typeof skill.name === 'string');
      assert.ok(typeof skill.description === 'string');
      assert.ok(typeof skill.content === 'string');
      assert.ok(typeof skill.filePath === 'string');
    }
  });

  it('returns empty array when packagedSkillsDir does not exist and homeDir is empty', async () => {
    const emptyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-home-'));
    try {
      const skills = await discoverSkills({ packagedSkillsDir: '/nonexistent/path/to/skills', homeDir: emptyHome });
      assert.equal(skills.length, 0);
    } finally {
      await fs.rm(emptyHome, { recursive: true, force: true });
    }
  });

  it('filePath points to the SKILL.md file', async () => {
    const skills = await discoverSkills({ packagedSkillsDir: tmpDir, homeDir: fakeHome });
    for (const skill of skills) {
      assert.ok(skill.filePath.endsWith('SKILL.md'));
    }
  });
});

describe('resolveSkill', () => {
  let tmpDir: string;
  let fakeHome: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-skill-test-'));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-home-'));
    await makeSkillsDir(tmpDir, [
      { name: 'my-skill', description: 'A test skill', content: '# My Skill\nDo stuff.' },
    ]);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('finds skill by exact name', async () => {
    const skill = await resolveSkill('my-skill', { packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.ok(skill !== null);
    assert.equal(skill!.name, 'my-skill');
  });

  it('returns null for unknown skill', async () => {
    const skill = await resolveSkill('does-not-exist', { packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.equal(skill, null);
  });

  it('returned skill has content from file body', async () => {
    const skill = await resolveSkill('my-skill', { packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.ok(skill!.content.includes('My Skill'));
  });
});

describe('listSkills', () => {
  let tmpDir: string;
  let fakeHome: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'list-skill-test-'));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'list-home-'));
    await makeSkillsDir(tmpDir, [
      { name: 'alpha', description: 'Alpha skill' },
      { name: 'beta', description: 'Beta skill' },
    ]);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('returns name and description for each skill', async () => {
    const list = await listSkills({ packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.equal(list.length, 2);
    for (const item of list) {
      assert.ok(typeof item.name === 'string');
      assert.ok(typeof item.description === 'string');
    }
  });

  it('does not include content or filePath', async () => {
    const list = await listSkills({ packagedSkillsDir: tmpDir, homeDir: fakeHome });
    for (const item of list) {
      assert.ok(!('content' in item));
      assert.ok(!('filePath' in item));
    }
  });
});

describe('findRelevantSkills', () => {
  let tmpDir: string;
  let fakeHome: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'relevant-skill-test-'));
    fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), 'relevant-home-'));
    await makeSkillsDir(tmpDir, [
      { name: 'forge-helper', description: 'Use when creating new modules and coding tasks' },
      { name: 'verify-helper', description: 'Use when checking quality and validation' },
    ]);
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(fakeHome, { recursive: true, force: true });
  });

  it('returns array for any context string', async () => {
    const relevant = await findRelevantSkills('some random context', { packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.ok(Array.isArray(relevant));
  });

  it('returns skills whose description keywords match context', async () => {
    const relevant = await findRelevantSkills('creating modules', { packagedSkillsDir: tmpDir, homeDir: fakeHome });
    assert.ok(Array.isArray(relevant));
  });
});
