# DanteForge User Guide

## Overview

DanteForge is an AI coding assistant optimizer that ensures work is done, not just claimed. It prevents false completion by detecting TODOs, mocks, and incomplete implementations in AI-assisted workflows.

## Quick Start

1. Install: `npm install -g danteforge`
2. Set up for your assistant: `danteforge setup assistants --assistants goose`
3. Start a project: `danteforge constitution`
4. Build iteratively: `danteforge magic "Build a todo app"`

## Key Features

- **No False Completion**: Automatically detects and flags incomplete work
- **Structured Pipelines**: Enforces quality gates from idea to deployment
- **Multi-Agent Support**: Party mode for complex tasks
- **Maturity Scoring**: 8-dimension assessment to ensure excellence
- **OSS Integration**: Harvests best practices from open source

## Commands

### Planning
- `danteforge constitution` - Define project principles
- `danteforge specify "idea"` - Convert idea to spec
- `danteforge plan` - Generate implementation plan

### Execution
- `danteforge magic [goal]` - Balanced workflow (recommended)
- `danteforge autoforge [goal]` - Deterministic pipeline
- `danteforge verify` - Quality checks

### Advanced
- `danteforge party` - Multi-agent collaboration
- `danteforge inferno [goal]` - Maximum power with OSS
- `danteforge assess` - Maturity scoring

## Integration with Assistants

### Goose
- Run `danteforge setup assistants --assistants goose`
- Use slash commands: `/spark`, `/magic`, `/verify`

### Claude Code
- Skills installed to `~/.claude/skills/`

### Others
- Supports Cursor, Codex, etc.

## Troubleshooting

- **Command fails**: Check LLM provider config
- **Low scores**: Address verify failures
- **Memory issues**: Use smaller projects or add RAM

## Best Practices

- Always run `danteforge verify` after changes
- Use `danteforge assess` to track progress
- Combine with your assistant's strengths