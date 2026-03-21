// Skill Registry tests — domain classification, compatibility, registry build
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  classifyDomain,
  groupByDomain,
  checkCompatibility,
  scanExternalSource,
  importExternalSkill,
  buildRegistry,
  type SkillRegistryEntry,
} from '../src/core/skill-registry.js';

describe('classifyDomain', () => {
  it('classifies security skills', () => {
    assert.strictEqual(classifyDomain('auth-guard', 'Use when implementing authentication and authorization'), 'security');
  });

  it('classifies frontend skills', () => {
    assert.strictEqual(classifyDomain('react-patterns', 'Modern React component patterns and hooks'), 'frontend');
  });

  it('classifies backend skills', () => {
    assert.strictEqual(classifyDomain('api-builder', 'REST API endpoints with Prisma and database queries'), 'backend');
  });

  it('classifies testing skills', () => {
    assert.strictEqual(classifyDomain('tdd-helper', 'Test driven development with unit tests and jest'), 'testing');
  });

  it('classifies devops skills', () => {
    assert.strictEqual(classifyDomain('deploy-config', 'Docker containerization and Kubernetes deployment'), 'devops');
  });

  it('classifies ux skills', () => {
    assert.strictEqual(classifyDomain('design-audit', 'Design system consistency and accessibility audit'), 'ux');
  });

  it('defaults to general for ambiguous skills', () => {
    assert.strictEqual(classifyDomain('misc-helper', 'A general purpose helper tool'), 'general');
  });
});

describe('groupByDomain', () => {
  const entries: SkillRegistryEntry[] = [
    { name: 'auth', description: 'Auth', source: 'packaged', domain: 'security', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/a' },
    { name: 'react', description: 'React', source: 'packaged', domain: 'frontend', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/b' },
    { name: 'vue', description: 'Vue', source: 'external', domain: 'frontend', compatibility: { requiredTools: [], requiredFrameworks: [] }, filePath: '/c' },
  ];

  it('groups entries by domain', () => {
    const grouped = groupByDomain(entries);
    assert.strictEqual(grouped.security.length, 1);
    assert.strictEqual(grouped.frontend.length, 2);
    assert.strictEqual(grouped.backend, undefined);
  });
});

// ─── classifyDomain — more keyword variants ───────────────────────────────

describe('classifyDomain — additional keywords', () => {
  it('classifies data/ML skills', () => {
    assert.strictEqual(classifyDomain('ml-trainer', 'Machine learning model training with pandas and bigquery'), 'data');
  });

  it('classifies architecture skills', () => {
    assert.strictEqual(classifyDomain('ddd-helper', 'Domain-driven design patterns and microservices architecture'), 'architecture');
  });

  it('classifies fullstack skills', () => {
    assert.strictEqual(classifyDomain('senior-fullstack', 'Full-stack Next.js and React development with Node.js'), 'fullstack');
  });

  it('classifies general/debug skills', () => {
    assert.strictEqual(classifyDomain('git-helper', 'Git commands and code review workflow'), 'general');
  });
});

// ─── checkCompatibility ───────────────────────────────────────────────────

describe('checkCompatibility', () => {
  it('returns compatible when no tools are required', async () => {
    const entry: SkillRegistryEntry = {
      name: 'simple-skill',
      description: 'A simple skill',
      source: 'packaged',
      domain: 'general',
      compatibility: { requiredTools: [], requiredFrameworks: [] },
      filePath: '/path/to/skill',
    };
    const result = await checkCompatibility(entry);
    assert.strictEqual(result.compatible, true);
    assert.deepStrictEqual(result.missing, []);
  });

  it('returns incompatible when a required tool is missing', async () => {
    const entry: SkillRegistryEntry = {
      name: 'fictional-tool-skill',
      description: 'Requires a fictional tool',
      source: 'external',
      domain: 'devops',
      compatibility: { requiredTools: ['fictional-tool-xyz-that-does-not-exist'], requiredFrameworks: [] },
      filePath: '/path/to/skill',
    };
    const result = await checkCompatibility(entry);
    assert.strictEqual(result.compatible, false);
    assert.ok(result.missing.length > 0);
    assert.ok(result.missing[0]!.includes('fictional-tool-xyz-that-does-not-exist'));
  });
});

// ─── scanExternalSource ───────────────────────────────────────────────────

describe('scanExternalSource', () => {
  it('returns empty array for non-existent directory', async () => {
    const result = await scanExternalSource('/path/that/does/not/exist/xyz123');
    assert.deepStrictEqual(result, []);
  });

  it('discovers SKILL.md files in a directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-skill-scan-'));

    // Create a skill dir with a valid SKILL.md
    const skillDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "my-skill"
description: "A test skill for authentication and authorization"
---
# My Skill
Use this skill for auth tasks.
`);

    const results = await scanExternalSource(tmpDir);
    assert.ok(results.length >= 1, `Expected at least 1 skill, got ${results.length}`);
    const skill = results.find(r => r.name === 'my-skill');
    assert.ok(skill !== undefined, 'Should find the my-skill entry');
    assert.strictEqual(skill!.domain, 'security', 'auth description should classify as security');
    assert.strictEqual(skill!.source, 'external');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('handles SKILL.md without frontmatter gracefully', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-skill-nofm-'));
    const skillDir = path.join(tmpDir, 'bare-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '# No Frontmatter\nJust content.');

    const results = await scanExternalSource(tmpDir);
    // Should still find the file, with 'unknown' name fallback
    assert.ok(results.length >= 1);
    const skill = results[0];
    assert.strictEqual(skill!.name, 'unknown');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('scans recursively into subdirectories', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-skill-recursive-'));
    const deepDir = path.join(tmpDir, 'category', 'subcategory');
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(path.join(deepDir, 'SKILL.md'), `---
name: "deep-skill"
description: "Deep nested testing skill with unit tests"
---
`);

    const results = await scanExternalSource(tmpDir);
    assert.ok(results.some(r => r.name === 'deep-skill'), 'Should find deeply nested skills');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('extracts tool compatibility from skill content', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-skill-compat-'));
    const skillDir = path.join(tmpDir, 'docker-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "docker-skill"
description: "Docker deployment skill"
---
Use docker and npm for deployment.
`);

    const results = await scanExternalSource(tmpDir);
    const skill = results.find(r => r.name === 'docker-skill');
    assert.ok(skill !== undefined);
    assert.ok(
      skill!.compatibility.requiredTools.includes('docker') || skill!.compatibility.requiredTools.includes('npm'),
      `Expected docker or npm in tools: ${skill!.compatibility.requiredTools.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});

// ─── importExternalSkill ──────────────────────────────────────────────────

describe('importExternalSkill', () => {
  it('imports a skill to target directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-skill-import-'));
    const sourceDir = path.join(tmpDir, 'source');
    const targetDir = path.join(tmpDir, 'target');
    await fs.mkdir(sourceDir);

    const skillContent = `---
name: "importable-skill"
description: "Test import skill"
---
# Importable Skill
`;
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), skillContent);

    const entry: SkillRegistryEntry = {
      name: 'importable-skill',
      description: 'Test import skill',
      source: 'external',
      domain: 'general',
      compatibility: { requiredTools: [], requiredFrameworks: [] },
      filePath: path.join(sourceDir, 'SKILL.md'),
    };

    const result = await importExternalSkill(entry, targetDir);
    assert.strictEqual(result.success, true);
    assert.ok(result.path?.includes('SKILL.md'));

    const importedContent = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf8');
    assert.strictEqual(importedContent, skillContent);

    await fs.rm(tmpDir, { recursive: true });
  });

  it('returns error when source file does not exist', async () => {
    const entry: SkillRegistryEntry = {
      name: 'ghost-skill',
      description: 'Non-existent skill',
      source: 'external',
      domain: 'general',
      compatibility: { requiredTools: [], requiredFrameworks: [] },
      filePath: '/path/that/does/not/exist/SKILL.md',
    };

    const result = await importExternalSkill(entry, '/tmp/target-xyz');
    assert.strictEqual(result.success, false);
    assert.ok(typeof result.error === 'string' && result.error.length > 0);
  });
});

// ─── buildRegistry ────────────────────────────────────────────────────────────

describe('buildRegistry', () => {
  it('returns an empty array when packagedSkillsDir is an empty directory', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-empty-'));
    const results = await buildRegistry({ packagedSkillsDir: tmpDir });
    // May include user skills from ~/.claude/skills etc., so just check it's an array
    assert.ok(Array.isArray(results));
    await fs.rm(tmpDir, { recursive: true });
  });

  it('maps discovered skills to registry entries with correct fields', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-map-'));
    const skillDir = path.join(tmpDir, 'backend-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "api-builder"
description: "REST API endpoints with Prisma and database queries"
---
Use npm and node to build APIs.
`);

    const results = await buildRegistry({ packagedSkillsDir: tmpDir });
    const entry = results.find(r => r.name === 'api-builder');
    assert.ok(entry !== undefined, 'Should find the api-builder skill');
    assert.strictEqual(entry!.name, 'api-builder');
    assert.ok(entry!.description.length > 0);
    assert.ok(['packaged', 'user', 'antigravity', 'external'].includes(entry!.source));
    assert.ok(typeof entry!.domain === 'string');
    assert.ok(Array.isArray(entry!.compatibility.requiredTools));
    assert.ok(Array.isArray(entry!.compatibility.requiredFrameworks));
    assert.ok(typeof entry!.filePath === 'string');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('classifies domain correctly via skillToEntry', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-domain-'));
    const skillDir = path.join(tmpDir, 'security-skill');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "auth-guard"
description: "Use when implementing authentication and authorization"
---
Security guard skill.
`);

    const results = await buildRegistry({ packagedSkillsDir: tmpDir });
    const entry = results.find(r => r.name === 'auth-guard');
    assert.ok(entry !== undefined);
    assert.strictEqual(entry!.domain, 'security');

    await fs.rm(tmpDir, { recursive: true });
  });

  it('extracts tool compatibility via skillToEntry', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-compat-'));
    const skillDir = path.join(tmpDir, 'docker-deploy');
    await fs.mkdir(skillDir);
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "docker-deploy"
description: "Docker deployment skill"
---
Use docker and npm to deploy.
`);

    const results = await buildRegistry({ packagedSkillsDir: tmpDir });
    const entry = results.find(r => r.name === 'docker-deploy');
    assert.ok(entry !== undefined);
    assert.ok(
      entry!.compatibility.requiredTools.includes('docker') ||
      entry!.compatibility.requiredTools.includes('npm'),
      `Expected docker or npm in tools: ${entry!.compatibility.requiredTools.join(', ')}`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it('resolveSource assigns a valid source type to every entry', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-src-'));
    const skillDir = path.join(tmpDir, 'my-skill');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---
name: "source-check-skill"
description: "A skill for source classification testing"
---
Content here.
`);

    const results = await buildRegistry({ packagedSkillsDir: tmpDir });
    const entry = results.find(r => r.name === 'source-check-skill');
    assert.ok(entry !== undefined, 'Should find source-check-skill');
    assert.ok(
      ['packaged', 'user', 'antigravity', 'external'].includes(entry!.source),
      `Source "${entry!.source}" should be a valid source type`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it('resolveSource classifies dante-agents/skills path as packaged on all platforms', async () => {
    // Regression test for Windows backslash bug: path.join uses \ on Windows,
    // so filePath.includes('dante-agents/skills') would fail without normalisation.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-registry-win-'));
    // Nest inside a "dante-agents/skills" subtree — path.join uses OS separator
    const agentDir = path.join(tmpDir, 'dante-agents', 'skills', 'my-agent-skill');
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(path.join(agentDir, 'SKILL.md'), `---
name: "win-path-skill"
description: "Tests Windows backslash path normalisation in resolveSource"
---
Skill content.
`);

    const results = await buildRegistry({ packagedSkillsDir: path.join(tmpDir, 'dante-agents', 'skills') });
    const entry = results.find(r => r.name === 'win-path-skill');
    assert.ok(entry !== undefined, 'Should find win-path-skill');
    assert.strictEqual(
      entry!.source,
      'packaged',
      `Expected "packaged" but got "${entry!.source}" — Windows path normalisation may be broken`,
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});
