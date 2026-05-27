import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { writeCommunityOnboardingDocs } from './community-onboarding.js';
import { writeCommunityEngagementDocs } from './community-engagement.js';

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  if (await exists(filePath)) return false;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
  return true;
}

export async function generateExampleProjects(cwd: string): Promise<string> {
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

export async function generateProjectTemplates(cwd: string): Promise<string> {
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

export async function improveDocumentation(cwd: string): Promise<string> {
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

export async function createShowcaseDemo(cwd: string): Promise<string> {
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

export async function generateAdoptionPack(cwd: string): Promise<string> {
  await writeCommunityOnboardingDocs(cwd);
  await writeCommunityEngagementDocs(cwd);

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

  return 'Generated community adoption pack';
}
