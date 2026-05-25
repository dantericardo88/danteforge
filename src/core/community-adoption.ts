import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import {
  computeCommunityAdoptionScore,
  type CommunityMetrics,
  type CommunityReadinessScore,
} from './harsh-scorer-community.js';

export { computeCommunityAdoptionScore, type CommunityMetrics, type CommunityReadinessScore };

export interface CommunityAdoptionOptions {
  cwd?: string;
  generateExamples?: boolean;
  generateTemplates?: boolean;
  generateAdoptionPack?: boolean;
  improveDocs?: boolean;
  createShowcase?: boolean;
}

export interface CommunityReadinessSignal {
  id: string;
  label: string;
  weight: number;
  earned: number;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  required?: boolean;
}

export interface CommunityAdoptionReadiness extends CommunityReadinessScore {
  maxScore: number;
  signals: CommunityReadinessSignal[];
  missingRequired: string[];
  nextActions: string[];
}

interface PackageMetadata {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  repository?: unknown;
  bugs?: unknown;
  homepage?: unknown;
  bin?: unknown;
  exports?: unknown;
  files?: unknown;
  keywords?: unknown;
  publishConfig?: unknown;
  private?: unknown;
}

const ADOPTION_ACTIONS: Record<string, string> = {
  'package-metadata': 'Complete package name, version, description, and license metadata.',
  'publishable-package': 'Expose a CLI or package export and make npm publishing explicit.',
  'distribution-proof': 'Declare packaged files and public publish configuration before release.',
  'repository-links': 'Add repository, homepage, and issue tracker links to package.json.',
  'keyword-discovery': 'Add at least three searchable npm keywords.',
  'readme-quickstart': 'Add install and first-run commands to README.md.',
  'contributor-guide': 'Add CONTRIBUTING.md with setup, test, and pull request steps.',
  'community-governance': 'Add community governance docs such as CODE_OF_CONDUCT.md or COMMUNITY.md.',
  'issue-templates': 'Add GitHub issue templates for bugs and feature requests.',
  'security-policy': 'Add SECURITY.md with a private vulnerability reporting path.',
  'release-notes': 'Add CHANGELOG.md or RELEASE.md with release history.',
  examples: 'Add at least one runnable example or showcase walkthrough.',
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readPackage(cwd: string): Promise<PackageMetadata> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as PackageMetadata;
  } catch {
    return {};
  }
}

function signal(
  id: string,
  label: string,
  weight: number,
  passed: boolean,
  detail: string,
  required = false,
): CommunityReadinessSignal {
  return {
    id,
    label,
    weight,
    earned: passed ? weight : 0,
    status: passed ? 'pass' : 'fail',
    detail,
    required,
  };
}

function hasRepositoryLink(value: unknown): boolean {
  if (typeof value === 'string') return /github\.com|gitlab\.com|bitbucket\.org|https?:\/\//i.test(value);
  if (value && typeof value === 'object') {
    const url = (value as Record<string, unknown>)['url'];
    return typeof url === 'string' && /github\.com|gitlab\.com|bitbucket\.org|https?:\/\//i.test(url);
  }
  return false;
}

function hasIssueUrl(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as Record<string, unknown>)['url'] === 'string');
}

function hasPublishSurface(pkg: PackageMetadata): boolean {
  const hasEntrypoint = Boolean(pkg.bin || pkg.exports || (Array.isArray(pkg.files) && pkg.files.length > 0));
  const publishConfig = pkg.publishConfig && typeof pkg.publishConfig === 'object'
    ? pkg.publishConfig as Record<string, unknown>
    : {};
  const isPublic = pkg.private !== true && (publishConfig['access'] === 'public' || !('access' in publishConfig));
  return hasEntrypoint && isPublic;
}

function hasDistributionProof(pkg: PackageMetadata): boolean {
  const files = Array.isArray(pkg.files) ? pkg.files.filter((item) => typeof item === 'string') : [];
  const publishConfig = pkg.publishConfig && typeof pkg.publishConfig === 'object'
    ? pkg.publishConfig as Record<string, unknown>
    : {};
  const declaresRuntimeFiles = files.some((item) => /^(dist|bin|lib|commands|src\/harvested)\b/i.test(item));
  const declaresDocs = files.some((item) => /^README\.md$/i.test(item))
    || files.some((item) => /^LICENSE(?:\.md)?$/i.test(item));
  return pkg.private !== true
    && Boolean(pkg.bin || pkg.exports)
    && declaresRuntimeFiles
    && declaresDocs
    && (publishConfig['access'] === 'public' || !('access' in publishConfig));
}

async function hasIssueTemplates(cwd: string): Promise<boolean> {
  const templateDir = path.join(cwd, '.github', 'ISSUE_TEMPLATE');
  try {
    const entries = await fs.readdir(templateDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && /\.(ya?ml|md)$/i.test(entry.name));
  } catch {
    return false;
  }
}

async function hasExampleSurface(cwd: string): Promise<boolean> {
  for (const dir of ['examples', 'showcase']) {
    try {
      const entries = await fs.readdir(path.join(cwd, dir));
      if (entries.length > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export async function assessCommunityAdoptionReadiness(cwd: string = process.cwd()): Promise<CommunityAdoptionReadiness> {
  const pkg = await readPackage(cwd);
  const readme = await readText(path.join(cwd, 'README.md'));
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords.filter((k) => typeof k === 'string') : [];
  const hasPackageBasics = Boolean(pkg.name && pkg.version && pkg.description && pkg.license);
  const hasRepoLinks = hasRepositoryLink(pkg.repository) && hasIssueUrl(pkg.bugs) && typeof pkg.homepage === 'string';
  const hasReadmeQuickstart = /npm\s+(install|i)|npx\s+/i.test(readme)
    && /(quick\s*start|getting started|first run|--help)/i.test(readme);
  const hasGovernance = await exists(path.join(cwd, 'CODE_OF_CONDUCT.md'))
    || await exists(path.join(cwd, 'COMMUNITY.md'));

  const signals: CommunityReadinessSignal[] = [
    signal('package-metadata', 'Package metadata', 15, hasPackageBasics, hasPackageBasics
      ? 'package.json includes name, version, description, and license.'
      : 'package.json is missing basic package metadata.', true),
    signal('publishable-package', 'Publishable package surface', 15, hasPublishSurface(pkg), hasPublishSurface(pkg)
      ? 'package.json exposes a public package entrypoint.'
      : 'package.json does not expose a public package entrypoint.'),
    signal('distribution-proof', 'Release distribution proof', 5, hasDistributionProof(pkg), hasDistributionProof(pkg)
      ? 'package.json declares runtime files and public publishing metadata.'
      : 'package.json does not clearly declare shipped files for public release.'),
    signal('repository-links', 'Repository and support links', 12, hasRepoLinks, hasRepoLinks
      ? 'package.json links repository, homepage, and issue tracker.'
      : 'repository, homepage, or issue tracker link is missing.'),
    signal('keyword-discovery', 'Searchable package keywords', 8, keywords.length >= 3, keywords.length >= 3
      ? `package.json includes ${keywords.length} searchable keywords.`
      : 'package.json needs at least three npm keywords.'),
    signal('readme-quickstart', 'README install and first run', 15, hasReadmeQuickstart, hasReadmeQuickstart
      ? 'README.md includes install and first-run guidance.'
      : 'README.md lacks install or first-run guidance.', true),
    signal('contributor-guide', 'Contributor guide', 10, await exists(path.join(cwd, 'CONTRIBUTING.md')),
      'CONTRIBUTING.md gives contributors a predictable path.', true),
    signal('community-governance', 'Community governance', 5, hasGovernance, hasGovernance
      ? 'Community governance docs set collaboration expectations.'
      : 'Community governance docs are missing.'),
    signal('issue-templates', 'Issue templates', 5, await hasIssueTemplates(cwd),
      'Issue templates help users file actionable bugs and feature requests.'),
    signal('security-policy', 'Security policy', 8, await exists(path.join(cwd, 'SECURITY.md')),
      'SECURITY.md documents vulnerability reporting.'),
    signal('release-notes', 'Release notes', 7,
      await exists(path.join(cwd, 'CHANGELOG.md')) || await exists(path.join(cwd, 'RELEASE.md')),
      'Release notes give evaluators a change history.'),
    signal('examples', 'Runnable examples', 10, await hasExampleSurface(cwd),
      'Examples or showcase assets demonstrate real usage.'),
  ];

  const maxScore = signals.reduce((sum, item) => sum + item.weight, 0);
  const score = signals.reduce((sum, item) => sum + item.earned, 0);
  const missingRequired = signals
    .filter((item) => item.required && item.status !== 'pass')
    .map((item) => item.id);
  const nextActions = signals
    .filter((item) => item.status !== 'pass')
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((item) => ADOPTION_ACTIONS[item.id] ?? item.detail);

  return { score, maxScore, signals, missingRequired, nextActions };
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await exists(filePath)) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

async function generateExampleProjects(cwd: string): Promise<string> {
  const examplesDir = path.join(cwd, 'examples');
  await fs.mkdir(examplesDir, { recursive: true });
  const basicExample = {
    name: 'basic-todo-app',
    description: 'A simple todo application built with DanteForge',
    steps: [
      'danteforge init',
      'danteforge constitution',
      'danteforge specify "Create a todo list app with add, complete, and delete features"',
      'danteforge plan',
      'danteforge tasks',
      'danteforge forge',
      'danteforge verify',
    ],
  };
  await fs.writeFile(path.join(examplesDir, 'basic-todo.json'), JSON.stringify(basicExample, null, 2));
  return 'Generated example projects';
}

async function generateProjectTemplates(cwd: string): Promise<string> {
  const templatesDir = path.join(cwd, 'templates');
  await fs.mkdir(templatesDir, { recursive: true });
  const webTemplate = {
    name: 'web-application',
    description: 'Template for web applications',
    constitution: [
      'Zero ambiguity in requirements',
      'Progressive enhancement approach',
      'Accessible by default',
      'Performance-first development',
    ],
    techStack: ['HTML', 'CSS', 'JavaScript', 'Node.js'],
  };
  await fs.writeFile(path.join(templatesDir, 'web-app.json'), JSON.stringify(webTemplate, null, 2));
  return 'Generated project templates';
}

async function improveDocumentation(cwd: string): Promise<string> {
  const docsDir = path.join(cwd, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  const quickStartGuide = `# DanteForge Quick Start Guide

## Getting Started

Install the CLI:

\`\`\`bash
npm install -g danteforge
\`\`\`

Create project workflow artifacts:

\`\`\`bash
danteforge init
danteforge constitution
danteforge specify "Create a web application for task management"
danteforge plan
danteforge tasks
danteforge forge
danteforge verify
\`\`\`

## Help

- \`danteforge help\` shows general help.
- \`danteforge help <command>\` explains a command.
- \`danteforge doctor\` diagnoses local setup problems.
`;
  await fs.writeFile(path.join(docsDir, 'QUICKSTART.md'), quickStartGuide);
  return 'Enhanced documentation';
}

async function createShowcaseDemo(cwd: string): Promise<string> {
  const showcaseDir = path.join(cwd, 'showcase');
  await fs.mkdir(showcaseDir, { recursive: true });
  const demoScript = `#!/bin/sh
set -eu

echo "DanteForge Showcase Demo"
echo "========================"
echo ""
echo "This demo shows DanteForge building a simple todo app."
echo ""

echo "1. Initializing project..."
danteforge init --non-interactive

echo "2. Setting up constitution..."
printf '%s\n' "Zero ambiguity in requirements" "Progressive enhancement approach" "Accessible by default" "Performance-first development" | danteforge constitution

echo "3. Creating specification..."
danteforge specify "Build a todo application with add, complete, and delete functionality" --prompt

echo ""
echo "Demo complete. Check the .danteforge directory for generated artifacts."
echo "Run 'danteforge assess' to see quality scores."
`;
  const scriptPath = path.join(showcaseDir, 'demo.sh');
  await fs.writeFile(scriptPath, demoScript);
  try {
    await fs.chmod(scriptPath, 0o755);
  } catch {
    logger.verbose('chmod unavailable for showcase demo script');
  }
  return 'Created showcase demo';
}

async function generateAdoptionPack(cwd: string): Promise<string> {
  await writeIfMissing(path.join(cwd, 'COMMUNITY.md'), `# Community

## Where To Start

- Install the CLI with \`npm install -g danteforge\`.
- Run \`danteforge go\` for the guided first workflow.
- Use \`danteforge doctor\` when setup or provider configuration fails.

## Support Channels

- Open a GitHub issue for bugs and reproducible failures.
- Use discussions or issues for workflow questions with the command, OS, Node version, and expected outcome.

## Good First Contributions

- Improve quickstart examples.
- Add command-specific troubleshooting notes.
- Add regression tests around a documented bug.
`);

  await writeIfMissing(path.join(cwd, 'CONTRIBUTING.md'), `# Contributing

## Local Setup

\`\`\`bash
npm ci
npm run typecheck
npm run test:fast
\`\`\`

## Pull Request Expectations

- Keep changes scoped to one behavior.
- Add or update tests for production-code changes.
- Run \`npm run check:anti-stub\` before opening a pull request.
- Include the command output or receipt that proves the change works.
`);

  await writeIfMissing(path.join(cwd, 'SECURITY.md'), `# Security Policy

## Reporting A Vulnerability

Please report vulnerabilities privately before public disclosure. Include the affected command, version, operating system, reproduction steps, and any relevant logs with secrets removed.

## Handling

Maintainers should acknowledge the report, reproduce the issue, prepare a fix with tests, and publish release notes that describe user impact and mitigation.
`);

  await writeIfMissing(path.join(cwd, 'CODE_OF_CONDUCT.md'), `# Code Of Conduct

## Standards

Use respectful, direct collaboration. Assume reports are filed in good faith, focus review comments on the work, and avoid personal attacks or harassment.

## Enforcement

Maintainers may moderate issues, discussions, and pull requests that make the project harder for users and contributors to participate in safely.
`);

  await writeIfMissing(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'bug_report.yml'), `name: Bug report
description: Report a reproducible problem with DanteForge
title: "[bug]: "
labels: ["bug", "needs-triage"]
body:
  - type: textarea
    id: summary
    attributes:
      label: Summary
      description: What went wrong?
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Reproduction
      description: Include the command, OS, Node version, and relevant logs with secrets removed.
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
`);

  await writeIfMissing(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'feature_request.yml'), `name: Feature request
description: Propose a workflow, command, or integration improvement
title: "[feature]: "
labels: ["enhancement", "needs-triage"]
body:
  - type: textarea
    id: use-case
    attributes:
      label: Use case
      description: What user workflow does this improve?
    validations:
      required: true
  - type: textarea
    id: outcome
    attributes:
      label: Desired outcome
      description: What should be true after this ships?
    validations:
      required: true
`);

  await writeIfMissing(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), `## Summary

Describe the behavior change and the user-facing outcome.

## Verification

- [ ] Tests added or updated
- [ ] \`npm run typecheck\`
- [ ] Relevant DanteForge command output or receipt included
`);

  return 'Generated community adoption pack';
}

export async function improveCommunityAdoption(options: CommunityAdoptionOptions = {}) {
  const cwd = options.cwd ?? process.cwd();
  logger.info('Improving community adoption features...');
  const improvements: string[] = [];
  if (options.generateExamples) improvements.push(await generateExampleProjects(cwd));
  if (options.generateTemplates) improvements.push(await generateProjectTemplates(cwd));
  if (options.generateAdoptionPack) improvements.push(await generateAdoptionPack(cwd));
  if (options.improveDocs) improvements.push(await improveDocumentation(cwd));
  if (options.createShowcase) improvements.push(await createShowcaseDemo(cwd));
  const readiness = await assessCommunityAdoptionReadiness(cwd);
  logger.success('Community adoption improvements completed:');
  improvements.forEach((improvement) => logger.info(`  - ${improvement}`));
  return {
    improvements,
    readiness,
    score: Math.min(9.0, Math.round((readiness.score / readiness.maxScore) * 90) / 10),
  };
}
