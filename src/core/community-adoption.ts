import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

export interface CommunityAdoptionOptions {
  generateExamples?: boolean;
  generateTemplates?: boolean;
  improveDocs?: boolean;
  createShowcase?: boolean;
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
      'danteforge verify'
    ]
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
      'Performance-first development'
    ],
    techStack: ['HTML', 'CSS', 'JavaScript', 'Node.js']
  };
  await fs.writeFile(path.join(templatesDir, 'web-app.json'), JSON.stringify(webTemplate, null, 2));
  return 'Generated project templates';
}

async function improveDocumentation(cwd: string): Promise<string> {
  const docsDir = path.join(cwd, 'docs');
  await fs.mkdir(docsDir, { recursive: true });
  const quickStartGuide = `# DanteForge Quick Start Guide

## Welcome to DanteForge!

DanteForge is an AI-powered development assistant that helps you build software through structured workflows.

## Getting Started

### 1. Installation

\`\`\`bash
npm install -g danteforge
\`\`\`

### 2. Initialize Your Project

\`\`\`bash
danteforge init
\`\`\`

### 3. Define Your Project Constitution

\`\`\`bash
danteforge constitution
\`\`\`

### 4. Specify What You Want to Build

\`\`\`bash
danteforge specify "Create a web application for task management"
\`\`\`

### 5. Plan and Execute

\`\`\`bash
danteforge plan
danteforge tasks
danteforge forge
danteforge verify
\`\`\`

## Key Features

- **Structured Development**: Follow proven software development patterns
- **AI Assistance**: Get help from AI at every step
- **Quality Assurance**: Built-in testing and verification
- **Multi-Agent Support**: Collaborate with AI agents
- **Enterprise Ready**: Production-grade tooling

## Getting Help

- \`danteforge help\` - General help
- \`danteforge help <command>\` - Help for specific commands
- Documentation: https://github.com/dantericardo88/danteforge

## Examples

Check out the \`examples/\` directory for sample projects and use cases.
`;
  await fs.writeFile(path.join(docsDir, 'QUICKSTART.md'), quickStartGuide);
  return 'Enhanced documentation';
}

async function createShowcaseDemo(cwd: string): Promise<string> {
  const showcaseDir = path.join(cwd, 'showcase');
  await fs.mkdir(showcaseDir, { recursive: true });
  const demoScript = `#!/bin/bash
# DanteForge Showcase Demo

echo "🚀 DanteForge Showcase Demo"
echo "============================"

echo ""
echo "This demo will show DanteForge building a simple todo app"
echo ""

# Initialize
echo "1. Initializing project..."
danteforge init --non-interactive

# Constitution
echo "2. Setting up constitution..."
echo "Zero ambiguity in requirements
Progressive enhancement approach
Accessible by default
Performance-first development" | danteforge constitution

# Specification
echo "3. Creating specification..."
danteforge specify "Build a todo application with add, complete, and delete functionality" --prompt

echo ""
echo "Demo complete! Check the .danteforge/ directory for generated artifacts."
echo "Run 'danteforge assess' to see quality scores."
`;
  await fs.writeFile(path.join(showcaseDir, 'demo.sh'), demoScript);
  try {
    await fs.chmod(path.join(showcaseDir, 'demo.sh'), 0o755);
  } catch {
    // chmod may not work on Windows
  }
  return 'Created showcase demo';
}

export async function improveCommunityAdoption(options: CommunityAdoptionOptions = {}) {
  const cwd = process.cwd();
  logger.info('Improving community adoption features...');
  const improvements: string[] = [];
  if (options.generateExamples) improvements.push(await generateExampleProjects(cwd));
  if (options.generateTemplates) improvements.push(await generateProjectTemplates(cwd));
  if (options.improveDocs) improvements.push(await improveDocumentation(cwd));
  if (options.createShowcase) improvements.push(await createShowcaseDemo(cwd));
  logger.success(`Community adoption improvements completed:`);
  improvements.forEach(improvement => logger.info(`  ✓ ${improvement}`));
  return {
    improvements,
    score: Math.min(9.0, 2.0 + (improvements.length * 1.5))
  };
}
