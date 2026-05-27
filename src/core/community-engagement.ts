import fs from 'fs/promises';
import path from 'path';

export interface CommunityEngagementReport {
  supportPolicy: boolean;
  pullRequestTemplate: boolean;
  contributorLabels: boolean;
  discussionRouting: boolean;
  maintainerOwnership: boolean;
  contributorRecognition: boolean;
  communityRoadmap: boolean;
}

interface PackageMetadata {
  name?: unknown;
  repository?: unknown;
  homepage?: unknown;
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  }
}

async function readPackage(cwd: string): Promise<PackageMetadata> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as PackageMetadata;
  } catch {
    return {};
  }
}

function supportPolicyReady(text: string): boolean {
  return /support|triage|maintainer/i.test(text)
    && /(?:business\s+days?|hours?|response|acknowledge|triage)/i.test(text)
    && /(?:issue|discussion|reproduc|logs?|node\s+version|operating\s+system|os)/i.test(text);
}

function pullRequestTemplateReady(text: string): boolean {
  return /summary|description/i.test(text)
    && /verification|test|check/i.test(text)
    && /(?:-\s*\[[ x]\]|npm\s+run|pnpm|yarn|bun)/i.test(text);
}

function contributorLabelsReady(text: string): boolean {
  return /good\s+first\s+issue/i.test(text)
    && /help\s+wanted|needs[-\s]triage|bug|enhancement/i.test(text);
}

function discussionRoutingReady(text: string, supportText: string): boolean {
  return /discussion/i.test(text) || (/discussion/i.test(supportText) && /question|support|workflow/i.test(supportText));
}

function maintainerOwnershipReady(text: string): boolean {
  const activeLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return activeLines.some((line) => {
    const parts = line.split(/\s+/);
    return parts.length >= 2 && parts.slice(1).some((owner) =>
      /^@[\w.-]+(?:\/[\w.-]+)?$/.test(owner) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner));
  });
}

function contributorRecognitionReady(text: string): boolean {
  return /(?:github|open_collective|patreon|tidelift|ko_fi|thanks_dev|custom):/i.test(text)
    || /(?:sponsor|funding|backer|contributor|recognition|thanks)/i.test(text);
}

function communityRoadmapReady(text: string): boolean {
  return /roadmap|current priorities|up next|planned/i.test(text)
    && /(?:current priorities|now|up next|planned|next)/i.test(text)
    && /(?:how to help|contribut|good first issue|help wanted|discussion)/i.test(text);
}

function packageRepositoryUrl(pkg: PackageMetadata): string {
  if (typeof pkg.repository === 'string') return pkg.repository;
  if (pkg.repository && typeof pkg.repository === 'object') {
    const url = (pkg.repository as Record<string, unknown>)['url'];
    if (typeof url === 'string') return url;
  }
  return typeof pkg.homepage === 'string' ? pkg.homepage : '';
}

function inferCodeOwner(pkg: PackageMetadata): string {
  const repoUrl = packageRepositoryUrl(pkg);
  const match = repoUrl.match(/github\.com[:/](?<owner>[\w.-]+)\/(?<repo>[\w.-]+)/i);
  if (match?.groups?.owner) return `@${match.groups.owner}`;
  if (typeof pkg.name === 'string' && pkg.name.startsWith('@')) {
    const scope = pkg.name.split('/')[0];
    if (scope && /^@[\w.-]+$/.test(scope)) return scope;
  }
  return '@dantericardo88';
}

function normalizeRepositoryUrl(value: string): string {
  return value.replace(/^git\+/, '').replace(/\.git$/i, '');
}

export async function analyzeCommunityEngagement(cwd: string = process.cwd()): Promise<CommunityEngagementReport> {
  const supportText = [
    await readText(path.join(cwd, 'SUPPORT.md')),
    await readText(path.join(cwd, 'docs', 'SUPPORT.md')),
    await readText(path.join(cwd, 'COMMUNITY.md')),
  ].join('\n');
  const pullRequestTemplateText = [
    await readText(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md')),
    await readText(path.join(cwd, '.github', 'pull_request_template.md')),
  ].join('\n');
  const labelsText = [
    await readText(path.join(cwd, '.github', 'labels.yml')),
    await readText(path.join(cwd, '.github', 'labels.yaml')),
    await readText(path.join(cwd, '.github', 'labels.json')),
  ].join('\n');
  const issueConfigText = await readText(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'config.yml'));
  const ownershipText = [
    await readText(path.join(cwd, '.github', 'CODEOWNERS')),
    await readText(path.join(cwd, 'CODEOWNERS')),
    await readText(path.join(cwd, 'docs', 'CODEOWNERS')),
  ].join('\n');
  const recognitionText = [
    await readText(path.join(cwd, '.github', 'FUNDING.yml')),
    await readText(path.join(cwd, '.github', 'FUNDING.yaml')),
    await readText(path.join(cwd, 'FUNDING.yml')),
    await readText(path.join(cwd, 'README.md')),
    await readText(path.join(cwd, 'CONTRIBUTING.md')),
    await readText(path.join(cwd, 'COMMUNITY.md')),
  ].join('\n');
  const roadmapText = [
    await readText(path.join(cwd, 'ROADMAP.md')),
    await readText(path.join(cwd, 'docs', 'ROADMAP.md')),
    await readText(path.join(cwd, 'README.md')),
  ].join('\n');

  return {
    supportPolicy: supportPolicyReady(supportText),
    pullRequestTemplate: pullRequestTemplateReady(pullRequestTemplateText),
    contributorLabels: contributorLabelsReady(labelsText),
    discussionRouting: discussionRoutingReady(issueConfigText, supportText),
    maintainerOwnership: maintainerOwnershipReady(ownershipText),
    contributorRecognition: contributorRecognitionReady(recognitionText),
    communityRoadmap: communityRoadmapReady(roadmapText),
  };
}

export async function writeCommunityEngagementDocs(cwd: string): Promise<void> {
  const pkg = await readPackage(cwd);
  const codeOwner = inferCodeOwner(pkg);
  const fundingAccount = codeOwner.replace(/^@/, '').split('/')[0] || 'dantericardo88';
  const projectUrl = normalizeRepositoryUrl(packageRepositoryUrl(pkg) || 'https://github.com/dantericardo88/danteforge');

  await writeIfMissing(path.join(cwd, 'SUPPORT.md'), `# Support

Maintainers triage new issues within 3 business days. Security reports follow the private process in SECURITY.md.

## Where To Ask

- Use bug reports for reproducible defects.
- Use feature requests for workflow or command proposals.
- Use discussions for setup questions, workflow questions, and design tradeoffs.

## Useful Report Details

Include the command, expected behavior, actual behavior, reproduction steps, Node version, operating system, and logs with secrets removed.
`);

  await writeIfMissing(path.join(cwd, '.github', 'PULL_REQUEST_TEMPLATE.md'), `## Summary

Describe the behavior change and user-facing outcome.

## Verification

- [ ] Tests added or updated
- [ ] \`npm run typecheck\`
- [ ] \`npm test\` or the narrow test command for this change
- [ ] Relevant command output or receipt included
`);

  await writeIfMissing(path.join(cwd, '.github', 'labels.yml'), `- name: good first issue
  color: 7057ff
  description: Small scoped issue suitable for a new contributor
- name: help wanted
  color: 008672
  description: Maintainers welcome external implementation help
- name: needs-triage
  color: fbca04
  description: Maintainers need to classify impact and next action
- name: bug
  color: d73a4a
  description: Something is not working as expected
- name: enhancement
  color: a2eeef
  description: New capability or improvement request
`);

  await writeIfMissing(path.join(cwd, '.github', 'ISSUE_TEMPLATE', 'config.yml'), `blank_issues_enabled: false
contact_links:
  - name: Questions and workflow discussions
    url: https://github.com/dantericardo88/danteforge/discussions
    about: Ask setup questions, compare workflows, and discuss proposals before filing an issue.
`);

  await writeIfMissing(path.join(cwd, '.github', 'CODEOWNERS'), `# Default maintainers for review routing.
* ${codeOwner}

# High-risk runtime surfaces should always receive maintainer review.
src/ ${codeOwner}
commands/ ${codeOwner}
scripts/ ${codeOwner}
`);

  await writeIfMissing(path.join(cwd, '.github', 'FUNDING.yml'), `github: [${fundingAccount}]
custom:
  - ${projectUrl}
`);

  await writeIfMissing(path.join(cwd, 'docs', 'ROADMAP.md'), `# Roadmap

## Current Priorities

- Keep first-run setup predictable across supported agent hosts.
- Expand real examples that show complete workflows from idea to verification.
- Improve diagnostics for provider, package manager, and workflow setup failures.

## Up Next

- More beginner-sized good first issue candidates.
- More command-specific troubleshooting recipes.
- Clearer contributor ownership for runtime, docs, and release surfaces.

## How To Help

- Start with issues labeled \`good first issue\` or \`help wanted\`.
- Discuss workflow proposals before implementation when the change affects command behavior.
- Include verification output in pull requests so maintainers can review quickly.
`);
}
