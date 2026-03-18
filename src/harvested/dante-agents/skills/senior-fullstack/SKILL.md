---
name: senior-fullstack
description: Comprehensive fullstack development skill for building complete web
  applications with React, Next.js, Node.js, GraphQL, and PostgreSQL. Includes
  project scaffolding, code quality analysis, architec...
risk: unknown
source: antigravity-awesome-skills
date_added: 2026-02-27
danteforge_enhanced: true
danteforge_bundle: Full-Stack Developer
upstream_repo: https://github.com/sickn33/antigravity-awesome-skills.git
upstream_skill_path: senior-fullstack
---

> Imported from Antigravity and wrapped for the DanteForge workflow.

## DanteForge Wrapper

- Constitution check: confirm the project constitution is active before applying this skill.
- Gate reminders: respect `specify -> clarify -> plan -> tasks -> forge`; use `--light` only when the scope is genuinely small.
- STATE.yaml integration: keep `.danteforge/STATE.yaml` aligned with the current phase, task list, and audit log while using this skill.
- TDD hook: start with a failing test and keep the change on the RED -> GREEN -> REFACTOR path.
- Verify hook: finish with `npm run verify` and `npm run build` before claiming completion.
- Party mode hook: if the work splits cleanly, prefer DanteForge party mode for parallel execution.
- Worktree note: risky or parallel work should run in an isolated git worktree.

## Upstream Skill

# Senior Fullstack

Complete toolkit for senior fullstack with modern tools and best practices.

## Quick Start

### Main Capabilities

This skill provides three core capabilities through automated scripts:

```bash
# Script 1: Fullstack Scaffolder
python scripts/fullstack_scaffolder.py [options]

# Script 2: Project Scaffolder
python scripts/project_scaffolder.py [options]

# Script 3: Code Quality Analyzer
python scripts/code_quality_analyzer.py [options]
```

## Core Capabilities

### 1. Fullstack Scaffolder

Automated tool for fullstack scaffolder tasks.

**Features:**
- Automated scaffolding
- Best practices built-in
- Configurable templates
- Quality checks

**Usage:**
```bash
python scripts/fullstack_scaffolder.py <project-path> [options]
```

### 2. Project Scaffolder

Comprehensive analysis and optimization tool.

**Features:**
- Deep analysis
- Performance metrics
- Recommendations
- Automated fixes

**Usage:**
```bash
python scripts/project_scaffolder.py <target-path> [--verbose]
```

### 3. Code Quality Analyzer

Advanced tooling for specialized tasks.

**Features:**
- Expert-level automation
- Custom configurations
- Integration ready
- Production-grade output

**Usage:**
```bash
python scripts/code_quality_analyzer.py [arguments] [options]
```

## Reference Documentation

### Tech Stack Guide

Comprehensive guide available in `references/tech_stack_guide.md`:

- Detailed patterns and practices
- Code examples
- Best practices
- Anti-patterns to avoid
- Real-world scenarios

### Architecture Patterns

Complete workflow documentation in `references/architecture_patterns.md`:

- Step-by-step processes
- Optimization strategies
- Tool integrations
- Performance tuning
- Troubleshooting guide

### Development Workflows

Technical reference guide in `references/development_workflows.md`:

- Technology stack details
- Configuration examples
- Integration patterns
- Security considerations
- Scalability guidelines

## Tech Stack

**Languages:** TypeScript, JavaScript, Python, Go, Swift, Kotlin
**Frontend:** React, Next.js, React Native, Flutter
**Backend:** Node.js, Express, GraphQL, REST APIs
**Database:** PostgreSQL, Prisma, NeonDB, Supabase
**DevOps:** Docker, Kubernetes, Terraform, GitHub Actions, CircleCI
**Cloud:** AWS, GCP, Azure

## Development Workflow

### 1. Setup and Configuration

```bash
# Install dependencies
npm install
# or
pip install -r requirements.txt

# Configure environment
cp .env.example .env
```

### 2. Run Quality Checks

```bash
# Use the analyzer script
python scripts/project_scaffolder.py .

# Review recommendations
# Apply fixes
```

### 3. Implement Best Practices

Follow the patterns and practices documented in:
- `references/tech_stack_guide.md`
- `references/architecture_patterns.md`
- `references/development_workflows.md`

## Best Practices Summary

### Code Quality
- Follow established patterns
- Write comprehensive tests
- Document decisions
- Review regularly

### Performance
- Measure before optimizing
- Use appropriate caching
- Optimize critical paths
- Monitor in production

### Security
- Validate all inputs
- Use parameterized queries
- Implement proper authentication
- Keep dependencies updated

### Maintainability
- Write clear code
- Use consistent naming
- Add helpful comments
- Keep it simple

## Common Commands

```bash
# Development
npm run dev
npm run build
npm run test
npm run lint

# Analysis
python scripts/project_scaffolder.py .
python scripts/code_quality_analyzer.py --analyze

# Deployment
docker build -t app:latest .
docker-compose up -d
kubectl apply -f k8s/
```

## Troubleshooting

### Common Issues

Check the comprehensive troubleshooting section in `references/development_workflows.md`.

### Getting Help

- Review reference documentation
- Check script output messages
- Consult tech stack documentation
- Review error logs

## Resources

- Pattern Reference: `references/tech_stack_guide.md`
- Workflow Guide: `references/architecture_patterns.md`
- Technical Guide: `references/development_workflows.md`
- Tool Scripts: `scripts/` directory

## When to Use
This skill is applicable to execute the workflow or actions described in the overview.
