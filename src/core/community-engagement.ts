import fs from 'fs/promises';
import path from 'path';

export interface CommunityEngagementReport {
  supportPolicy: boolean;
  pullRequestTemplate: boolean;
  contributorLabels: boolean;
  discussionRouting: boolean;
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

  return {
    supportPolicy: supportPolicyReady(supportText),
    pullRequestTemplate: pullRequestTemplateReady(pullRequestTemplateText),
    contributorLabels: contributorLabelsReady(labelsText),
    discussionRouting: discussionRoutingReady(issueConfigText, supportText),
  };
}

export async function writeCommunityEngagementDocs(cwd: string): Promise<void> {
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
}
