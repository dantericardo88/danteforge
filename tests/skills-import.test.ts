import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

async function createAntigravityFixture() {
  const root = await makeTempDir('danteforge-antigravity-fixture-');
  await fs.mkdir(path.join(root, 'docs'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'concise-planning'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'react-patterns'), { recursive: true });
  await fs.mkdir(path.join(root, 'skills', 'senior-fullstack'), { recursive: true });

  await fs.writeFile(
    path.join(root, 'docs', 'BUNDLES.md'),
    [
      '# Bundles',
      '',
      '### The "Essentials" Starter Pack',
      '- [`concise-planning`](../skills/concise-planning/): Always start with a plan.',
      '',
      '### The "Web Wizard" Pack',
      '- [`react-patterns`](../skills/react-patterns/): React patterns.',
      '',
      '### The "Full-Stack Developer" Pack',
      '- [`senior-fullstack`](../skills/senior-fullstack/): Fullstack patterns.',
      '',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    path.join(root, 'skills', 'concise-planning', 'SKILL.md'),
    '---\nname: concise-planning\ndescription: Plan first.\n---\n\n# Concise Planning\n\nUpstream body\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'skills', 'react-patterns', 'SKILL.md'),
    '---\nname: react-patterns\ndescription: React patterns.\n---\n\n# React Patterns\n\nUpstream body\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, 'skills', 'senior-fullstack', 'SKILL.md'),
    '---\nname: senior-fullstack\ndescription: Fullstack guide.\n---\n\n# Senior Fullstack\n\nUpstream body\n',
    'utf8',
  );

  return root;
}

describe('skills import core helpers', () => {
  it('parses bundle names and skill paths from Antigravity bundle markdown', async () => {
    const { parseBundlesMarkdown } = await import('../src/core/skills-import.js');
    const fixtureRoot = await createAntigravityFixture();
    const markdown = await fs.readFile(path.join(fixtureRoot, 'docs', 'BUNDLES.md'), 'utf8');

    const bundles = parseBundlesMarkdown(markdown);
    const names = bundles.map(bundle => bundle.name);

    assert.deepStrictEqual(names, ['Essentials', 'Web Wizard', 'Full-Stack Developer']);
    assert.deepStrictEqual(
      bundles.find(bundle => bundle.name === 'Web Wizard')?.skills,
      ['react-patterns'],
    );
  });

  it('follows the Antigravity redirect document and parses the current bundle markdown format', async () => {
    const { parseBundlesMarkdown } = await import('../src/core/skills-import.js');
    const redirectMarkdown = '# Bundles\n\nThis document moved to [`users/bundles.md`](users/bundles.md).\n';
    const bundlesMarkdown = [
      '# Antigravity Skill Bundles',
      '',
      '## Essentials & Core',
      '',
      '### 🚀 The "Essentials" Starter Pack',
      '',
      '- [`concise-planning`](../../skills/concise-planning/): Always start with a plan.',
      '- [`lint-and-validate`](../../skills/lint-and-validate/): Keep your code clean automatically.',
      '',
      '## 🌐 Web Development',
      '',
      '### 🌐 The "Web Wizard" Pack',
      '',
      '- [`frontend-design`](../../skills/frontend-design/): UI guidelines and aesthetics.',
      '- [`react-patterns`](../../skills/react-patterns/): Modern React patterns and principles.',
      '',
    ].join('\n');

    const redirected = parseBundlesMarkdown(redirectMarkdown);
    assert.deepStrictEqual(redirected, []);

    const bundles = parseBundlesMarkdown(bundlesMarkdown);
    assert.deepStrictEqual(
      bundles.map(bundle => bundle.name),
      ['Essentials', 'Web Wizard'],
    );
    assert.deepStrictEqual(
      bundles.find(bundle => bundle.name === 'Essentials')?.skills,
      ['concise-planning', 'lint-and-validate'],
    );
    assert.deepStrictEqual(
      bundles.find(bundle => bundle.name === 'Web Wizard')?.skills,
      ['frontend-design', 'react-patterns'],
    );
  });

  it('enhances imported skills with DanteForge wrapper guidance', async () => {
    const { enhanceSkillMarkdown } = await import('../src/core/skills-import.js');
    const enhanced = enhanceSkillMarkdown(
      '\uFEFF---\r\nname: react-patterns\r\ndescription: React patterns.\r\n---\r\n\r\n# React Patterns\r\n\r\nUpstream body\r\n',
      {
        bundle: 'Web Wizard',
        skillPath: 'skills/react-patterns/SKILL.md',
      },
    );

    assert.match(enhanced, /constitution/i);
    assert.match(enhanced, /STATE\.yaml/);
    assert.match(enhanced, /TDD/i);
    assert.match(enhanced, /party mode/i);
    assert.match(enhanced, /worktree/i);
    assert.match(enhanced, /Upstream body/);
    assert.doesNotMatch(enhanced, /\n## Upstream Skill\n\n---\nname:/);
  });

  it('harvests one selected bundle into enhanced packaged skills', async () => {
    const { harvestAntigravityBundle } = await import('../src/core/skills-import.js');
    const sourceDir = await createAntigravityFixture();
    const outputDir = await makeTempDir('danteforge-import-output-');

    const result = await harvestAntigravityBundle({
      sourceDir,
      outputDir,
      bundle: 'Web Wizard',
    });

    assert.strictEqual(result.bundle, 'Web Wizard');
    assert.deepStrictEqual(result.importedSkills, ['react-patterns']);
    assert.strictEqual(result.manifestPath, path.join(outputDir, 'IMPORT_MANIFEST.yaml'));

    const skillFile = await fs.readFile(path.join(outputDir, 'react-patterns', 'SKILL.md'), 'utf8');
    assert.match(skillFile, /Imported from Antigravity/);
    assert.match(skillFile, /React Patterns/);

    const manifest = await fs.readFile(path.join(outputDir, 'IMPORT_MANIFEST.yaml'), 'utf8');
    assert.match(manifest, /bundle: Web Wizard/);
    assert.match(manifest, /react-patterns/);
  });

  it('defaults to the Essentials bundle when bundle is omitted', async () => {
    const { harvestAntigravityBundle } = await import('../src/core/skills-import.js');
    const sourceDir = await createAntigravityFixture();
    const outputDir = await makeTempDir('danteforge-import-output-');

    const result = await harvestAntigravityBundle({
      sourceDir,
      outputDir,
    });

    assert.strictEqual(result.bundle, 'Essentials');
    assert.deepStrictEqual(result.importedSkills, ['concise-planning']);
  });

  it('sanitizes nested skill names for packaged directory output', async () => {
    const { sanitizeImportedSkillDirName } = await import('../src/core/skills-import.js');
    assert.strictEqual(sanitizeImportedSkillDirName('game-development/game-design'), 'game-development--game-design');
  });

  it('fails closed when an imported skill would overwrite an existing packaged skill', async () => {
    const { harvestAntigravityBundle } = await import('../src/core/skills-import.js');
    const sourceDir = await createAntigravityFixture();
    const outputDir = await makeTempDir('danteforge-import-output-');

    await fs.mkdir(path.join(outputDir, 'react-patterns'), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, 'react-patterns', 'SKILL.md'),
      '---\nname: react-patterns\ndescription: Existing packaged skill.\n---\n\nExisting body\n',
      'utf8',
    );

    await assert.rejects(
      () => harvestAntigravityBundle({
        sourceDir,
        outputDir,
        bundle: 'Web Wizard',
      }),
      /would overwrite existing packaged skills/i,
    );
  });

  it('allows overwriting existing packaged skills only when explicitly requested', async () => {
    const { harvestAntigravityBundle } = await import('../src/core/skills-import.js');
    const sourceDir = await createAntigravityFixture();
    const outputDir = await makeTempDir('danteforge-import-output-');

    await fs.mkdir(path.join(outputDir, 'react-patterns'), { recursive: true });
    await fs.writeFile(
      path.join(outputDir, 'react-patterns', 'SKILL.md'),
      '---\nname: react-patterns\ndescription: Existing packaged skill.\n---\n\nExisting body\n',
      'utf8',
    );

    const result = await harvestAntigravityBundle({
      sourceDir,
      outputDir,
      bundle: 'Web Wizard',
      allowOverwrite: true,
    });

    assert.deepStrictEqual(result.importedSkills, ['react-patterns']);
    const skillFile = await fs.readFile(path.join(outputDir, 'react-patterns', 'SKILL.md'), 'utf8');
    assert.match(skillFile, /Imported from Antigravity/);
  });

  it('uses core.symlinks=false for Windows git clone args', async () => {
    const { buildAntigravityGitCloneArgs } = await import('../src/core/skills-import.js');
    assert.deepStrictEqual(
      buildAntigravityGitCloneArgs('win32', 'C:\\temp\\repo'),
      ['-c', 'core.symlinks=false', 'clone', '--depth', '1', 'https://github.com/sickn33/antigravity-awesome-skills.git', 'C:\\temp\\repo'],
    );
  });
});
