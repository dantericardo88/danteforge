import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assessCommunityAdoptionReadiness,
  computeCommunityAdoptionScore,
  improveCommunityAdoption,
} from '../src/core/community-adoption.js';

const tempDirs: string[] = [];

async function makeProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-community-'));
  tempDirs.push(dir);
  await Promise.all(Object.entries(files).map(async ([rel, content]) => {
    const filePath = path.join(dir, rel);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }));
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('community adoption readiness', () => {
  it('credits a publishable package with public docs and contributor surfaces', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({
        name: 'sample-tool',
        version: '1.2.3',
        description: 'A useful CLI tool',
        license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/acme/sample-tool.git' },
        bugs: { url: 'https://github.com/acme/sample-tool/issues' },
        homepage: 'https://github.com/acme/sample-tool#readme',
        bin: { 'sample-tool': 'dist/index.js' },
        keywords: ['cli', 'automation', 'developer-tools'],
        publishConfig: { access: 'public' },
      }),
      'README.md': [
        '# Sample Tool',
        '',
        '```bash',
        'npm install -g sample-tool',
        'sample-tool init',
        '```',
        '',
        '## Quick start',
        'Run `sample-tool --help` for command help.',
      ].join('\n'),
      'CONTRIBUTING.md': '# Contributing\n\nOpen an issue, run tests, and submit a pull request.\n',
      'SECURITY.md': '# Security\n\nReport vulnerabilities privately before public disclosure.\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.3\n\n- Release notes.\n',
      'examples/quickstart/README.md': '# Quickstart example\n',
    });

    const report = await assessCommunityAdoptionReadiness(cwd);

    assert.ok(report.score >= 85, `expected strong readiness score, got ${report.score}`);
    assert.equal(report.missingRequired.length, 0);
    assert.ok(report.signals.some((signal) => signal.id === 'publishable-package' && signal.status === 'pass'));
    assert.ok(report.nextActions.length <= 3);
  });

  it('credits governance, issue templates, and release distribution proof', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({
        name: 'sample-tool',
        version: '1.2.3',
        description: 'A useful CLI tool',
        license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/acme/sample-tool.git' },
        bugs: { url: 'https://github.com/acme/sample-tool/issues' },
        homepage: 'https://github.com/acme/sample-tool#readme',
        bin: { 'sample-tool': 'dist/index.js' },
        files: ['dist', 'README.md', 'LICENSE'],
        keywords: ['cli', 'automation', 'developer-tools'],
        publishConfig: { access: 'public' },
      }),
      'README.md': [
        '# Sample Tool',
        '',
        '## Quick start',
        '',
        '```bash',
        'npm install -g sample-tool',
        'sample-tool --help',
        '```',
        '',
        '## Community',
        'Open issues with reproducible steps and use discussions for workflow questions.',
      ].join('\n'),
      'CONTRIBUTING.md': '# Contributing\n\nRun `npm ci`, `npm run typecheck`, and `npm test` before pull requests.\n',
      'SECURITY.md': '# Security\n\nReport vulnerabilities privately before public disclosure.\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.3\n\n- Release notes.\n',
      'CODE_OF_CONDUCT.md': '# Code of Conduct\n\nUse welcoming, respectful collaboration.\n',
      '.github/ISSUE_TEMPLATE/bug_report.yml': 'name: Bug report\nbody:\n  - type: textarea\n    id: reproduction\n',
      '.github/ISSUE_TEMPLATE/feature_request.yml': 'name: Feature request\nbody:\n  - type: textarea\n    id: use-case\n',
      'examples/quickstart/README.md': '# Quickstart example\n',
    });

    const report = await assessCommunityAdoptionReadiness(cwd);

    for (const id of ['community-governance', 'issue-templates', 'distribution-proof']) {
      assert.ok(
        report.signals.some((signal) => signal.id === id && signal.status === 'pass'),
        `expected ${id} signal to pass`,
      );
    }
    assert.ok(report.score >= 100, `expected frontier-ready local adoption score, got ${report.score}`);
  });

  it('boosts score from local readiness without requiring external popularity metrics', () => {
    const score = computeCommunityAdoptionScore({}, {
      score: 90,
      maxScore: 100,
      signals: [],
      missingRequired: [],
      nextActions: [],
    });

    assert.ok(score >= 65, `local adoption readiness should materially improve pre-release score, got ${score}`);
    assert.ok(score < 90, 'readiness alone should not claim full market adoption');
  });

  it('generates a reusable community adoption pack in the target project', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0', license: 'MIT' }),
    });

    const result = await improveCommunityAdoption({ cwd, generateAdoptionPack: true });

    assert.ok(result.improvements.includes('Generated community adoption pack'));
    assert.ok(result.readiness.score > 0);
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'COMMUNITY.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'CONTRIBUTING.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'SECURITY.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'CODE_OF_CONDUCT.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'feature_request.yml')));
  });
});
