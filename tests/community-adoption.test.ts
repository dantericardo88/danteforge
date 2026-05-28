import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  analyzeCommunityOnboarding,
  analyzeCommunityProof,
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

  it('recognizes copy-paste onboarding, command reference, and troubleshooting support', async () => {
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
        'sample-tool doctor',
        '```',
        '',
        '## Install',
        '',
        'Use `npm install -g sample-tool`, `npx sample-tool --help`, or `pnpm dlx sample-tool --help`.',
      ].join('\n'),
      'docs/COMMANDS.md': [
        '# Command Reference',
        '',
        '| Command | Purpose |',
        '| --- | --- |',
        '| `sample-tool init` | Initialize artifacts. |',
        '| `sample-tool verify` | Run verification. |',
        '| `sample-tool doctor` | Diagnose setup. |',
      ].join('\n'),
      'docs/TROUBLESHOOTING.md': [
        '# Troubleshooting',
        '',
        'Run `sample-tool doctor` first, then open an issue with logs, OS, Node version, expected behavior, and reproduction steps.',
      ].join('\n'),
    });

    const onboarding = await analyzeCommunityOnboarding(cwd);
    const report = await assessCommunityAdoptionReadiness(cwd);

    assert.ok(onboarding.copyPasteCommandCount >= 3);
    assert.deepEqual([...onboarding.packageManagers].sort(), ['npm', 'pnpm', 'npx'].sort());
    for (const id of ['copy-paste-onboarding', 'package-manager-coverage', 'command-reference', 'troubleshooting-support']) {
      assert.ok(
        report.signals.some((signal) => signal.id === id && signal.status === 'pass'),
        `expected ${id} signal to pass`,
      );
    }
  });

  it('generates onboarding docs that a new adopter can run without project-specific knowledge', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0', license: 'MIT' }),
    });

    await improveCommunityAdoption({ cwd, generateAdoptionPack: true });
    const onboarding = await analyzeCommunityOnboarding(cwd);

    assert.ok(onboarding.copyPasteCommandCount >= 3);
    assert.ok(onboarding.packageManagers.includes('npm'));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'ONBOARDING.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'COMMANDS.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'TROUBLESHOOTING.md')));
  });

  it('credits maintainer response workflows that turn user reports into actionable work', async () => {
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
        'sample-tool doctor',
        '```',
      ].join('\n'),
      'CONTRIBUTING.md': '# Contributing\n\nRun `npm ci`, `npm run typecheck`, and `npm test` before pull requests.\n',
      'SECURITY.md': '# Security\n\nReport vulnerabilities privately before public disclosure.\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.3\n\n- Release notes.\n',
      'CODE_OF_CONDUCT.md': '# Code of Conduct\n\nUse welcoming, respectful collaboration.\n',
      'SUPPORT.md': [
        '# Support',
        '',
        'Maintainers triage new issues within 3 business days.',
        'Use the bug template for defects, the feature template for proposals, and discussions for workflow questions.',
        'Include logs, reproduction steps, Node version, operating system, expected behavior, and actual behavior.',
      ].join('\n'),
      '.github/ISSUE_TEMPLATE/bug_report.yml': 'name: Bug report\nbody:\n  - type: textarea\n    id: reproduction\n',
      '.github/ISSUE_TEMPLATE/feature_request.yml': 'name: Feature request\nbody:\n  - type: textarea\n    id: use-case\n',
      '.github/PULL_REQUEST_TEMPLATE.md': '## Summary\n\n## Verification\n\n- [ ] npm run typecheck\n- [ ] npm test\n',
      '.github/labels.yml': '- name: good first issue\n- name: help wanted\n- name: needs-triage\n',
      '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false\ndiscussions:\n  - name: Questions\n    url: https://github.com/acme/sample-tool/discussions\n',
      'docs/COMMANDS.md': '# Command Reference\n\n| Command | Purpose |\n| --- | --- |\n| `sample-tool doctor` | Diagnose setup. |\n| `sample-tool verify` | Run checks. |\n| `sample-tool help` | Show help. |\n',
      'docs/TROUBLESHOOTING.md': '# Troubleshooting\n\nRun `sample-tool doctor` and open an issue with logs, reproduction steps, Node version, and operating system.\n',
      'examples/quickstart/README.md': '# Quickstart example\n',
    });

    const report = await assessCommunityAdoptionReadiness(cwd);

    for (const id of ['support-policy', 'pull-request-template', 'contributor-labels', 'discussion-routing']) {
      assert.ok(
        report.signals.some((signal) => signal.id === id && signal.status === 'pass'),
        `expected ${id} signal to pass`,
      );
    }
    assert.equal(report.missingRequired.length, 0);
    assert.ok(report.score >= 120, `expected advanced adoption readiness score, got ${report.score}`);
  });

  it('generates support policy, PR template, labels, and discussion routing in the adoption pack', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({ name: 'sample-tool', version: '0.1.0', license: 'MIT' }),
    });

    await improveCommunityAdoption({ cwd, generateAdoptionPack: true });
    const report = await assessCommunityAdoptionReadiness(cwd);

    await assert.doesNotReject(() => fs.access(path.join(cwd, 'SUPPORT.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'labels.yml')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'config.yml')));
    assert.ok(report.signals.some((signal) => signal.id === 'support-policy' && signal.status === 'pass'));
    assert.ok(report.signals.some((signal) => signal.id === 'pull-request-template' && signal.status === 'pass'));
    assert.ok(report.signals.some((signal) => signal.id === 'contributor-labels' && signal.status === 'pass'));
  });

  it('credits ownership, recognition, and roadmap surfaces that help outsiders contribute', async () => {
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
        'sample-tool doctor',
        '```',
      ].join('\n'),
      'CONTRIBUTING.md': '# Contributing\n\nRun tests before pull requests.\n',
      'SECURITY.md': '# Security\n\nReport vulnerabilities privately.\n',
      'CHANGELOG.md': '# Changelog\n\n## 1.2.3\n\n- Release notes.\n',
      'SUPPORT.md': '# Support\n\nMaintainers triage issues within 3 business days. Include logs, Node version, operating system, and reproduction steps.\n',
      '.github/CODEOWNERS': '* @acme/maintainers\nsrc/ @acme/core\n',
      '.github/FUNDING.yml': 'github: [acme]\nopen_collective: sample-tool\n',
      '.github/ISSUE_TEMPLATE/config.yml': 'blank_issues_enabled: false\ncontact_links:\n  - name: Questions\n    url: https://github.com/acme/sample-tool/discussions\n    about: Ask support questions in discussions.\n',
      '.github/PULL_REQUEST_TEMPLATE.md': '## Summary\n\n## Verification\n\n- [ ] npm test\n',
      '.github/labels.yml': '- name: good first issue\n- name: help wanted\n- name: needs-triage\n',
      'docs/ROADMAP.md': '# Roadmap\n\n## Current Priorities\n\n- Improve first-run setup.\n\n## Up Next\n\n- Add more examples.\n\n## How To Help\n\nPick a good first issue or discuss proposals before implementation.\n',
      'docs/COMMANDS.md': '# Command Reference\n\n| Command | Purpose |\n| --- | --- |\n| `sample-tool doctor` | Diagnose setup. |\n| `sample-tool verify` | Run checks. |\n| `sample-tool help` | Show help. |\n',
      'docs/TROUBLESHOOTING.md': '# Troubleshooting\n\nRun `sample-tool doctor` and open an issue with logs, reproduction steps, Node version, and operating system.\n',
      'examples/quickstart/README.md': '# Quickstart example\n',
    });

    const report = await assessCommunityAdoptionReadiness(cwd);

    for (const id of ['maintainer-ownership', 'contributor-recognition', 'community-roadmap']) {
      assert.ok(
        report.signals.some((signal) => signal.id === id && signal.status === 'pass'),
        `expected ${id} signal to pass`,
      );
    }
  });

  it('credits an evidence guide and verified public adopter proof separately', async () => {
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
        'sample-tool doctor',
        '```',
      ].join('\n'),
      'docs/ADOPTION_EVIDENCE.md': [
        '# Adoption Evidence',
        '',
        '| Field | Required detail |',
        '| --- | --- |',
        '| Adopter | Public team, project, or organization name. |',
        '| Use case | Workflow or command path adopted. |',
        '| Proof link | Public issue, discussion, package, article, or repository URL. |',
        '| Verified date | Date maintainers last checked the proof. |',
        '| Outcome | Result observed by the adopter. |',
      ].join('\n'),
      'ADOPTERS.md': [
        '# Adopters',
        '',
        '## Acme Automation Team',
        '',
        '- Use case: runs `sample-tool verify` in release preparation.',
        '- Proof link: https://github.com/acme/sample-tool/discussions/42',
        '- Verified date: 2026-05-01',
        '- Outcome: reduced manual release checklist work.',
      ].join('\n'),
    });

    const proof = await analyzeCommunityProof(cwd);
    const report = await assessCommunityAdoptionReadiness(cwd);

    assert.equal(proof.evidenceGuide, true);
    assert.equal(proof.verifiedAdopterProofs.length, 1);
    for (const id of ['adoption-evidence-guide', 'public-adopter-proof']) {
      assert.ok(
        report.signals.some((signal) => signal.id === id && signal.status === 'pass'),
        `expected ${id} signal to pass`,
      );
    }
  });

  it('generates an adoption evidence guide without claiming public adopters', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({
        name: 'sample-tool',
        version: '0.1.0',
        license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/acme/sample-tool.git' },
      }),
    });

    await improveCommunityAdoption({ cwd, generateAdoptionPack: true });
    const proof = await analyzeCommunityProof(cwd);
    const report = await assessCommunityAdoptionReadiness(cwd);

    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'ADOPTION_EVIDENCE.md')));
    assert.equal(proof.evidenceGuide, true);
    assert.equal(proof.verifiedAdopterProofs.length, 0);
    assert.ok(report.signals.some((signal) => signal.id === 'adoption-evidence-guide' && signal.status === 'pass'));
    assert.ok(report.signals.some((signal) => signal.id === 'public-adopter-proof' && signal.status === 'fail'));
  });

  it('generates maintainer ownership, contributor recognition, and roadmap assets in the adoption pack', async () => {
    const cwd = await makeProject({
      'package.json': JSON.stringify({
        name: 'sample-tool',
        version: '0.1.0',
        license: 'MIT',
        repository: { type: 'git', url: 'https://github.com/acme/sample-tool.git' },
      }),
    });

    await improveCommunityAdoption({ cwd, generateAdoptionPack: true });
    const report = await assessCommunityAdoptionReadiness(cwd);
    const codeowners = await fs.readFile(path.join(cwd, '.github', 'CODEOWNERS'), 'utf8');
    const funding = await fs.readFile(path.join(cwd, '.github', 'FUNDING.yml'), 'utf8');

    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'CODEOWNERS')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.github', 'FUNDING.yml')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, 'docs', 'ROADMAP.md')));
    assert.match(codeowners, /@acme/);
    assert.match(funding, /github: \[acme\]/);
    assert.match(funding, /https:\/\/github\.com\/acme\/sample-tool/);
    assert.ok(report.signals.some((signal) => signal.id === 'maintainer-ownership' && signal.status === 'pass'));
    assert.ok(report.signals.some((signal) => signal.id === 'contributor-recognition' && signal.status === 'pass'));
    assert.ok(report.signals.some((signal) => signal.id === 'community-roadmap' && signal.status === 'pass'));
  });
});
