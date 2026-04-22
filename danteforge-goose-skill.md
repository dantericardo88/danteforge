---
name: danteforge-goose-integration
description: "Integrate DanteForge workflows and commands directly into Goose for seamless software engineering assistance"
---

# DanteForge Integration for Goose

This skill provides native integration between Goose and DanteForge, allowing you to run DanteForge workflows and commands directly within Goose.

## When To Use This Skill

- When you want to use DanteForge's structured development pipeline within Goose
- When you need to execute complex software engineering workflows
- When you want access to DanteForge's multi-agent orchestration capabilities
- When you need to follow DanteForge's best practices for project management and development

## Available DanteForge Workflows

### Pipeline Commands
Use these for structured project development:

1. **Project Initialization**
   - `danteforge init` - Set up a new project with health checks
   - `danteforge constitution` - Define project principles and constraints
   - `danteforge review` - Scan existing repo and generate CURRENT_STATE.md

2. **Planning Phase**
   - `danteforge specify "<idea>"` - Convert high-level idea to detailed spec
   - `danteforge clarify` - Run Q&A to identify spec gaps
   - `danteforge tech-decide` - Guided tech stack selection
   - `danteforge plan` - Generate implementation plan from spec
   - `danteforge tasks` - Break plan into executable tasks

3. **Design Phase**
   - `danteforge design "<prompt>"` - Generate UI design artifacts
   - `danteforge ux-refine` - Refine UX with design tools

4. **Development Phase**
   - `danteforge forge [phase]` - Execute development waves
   - `danteforge verify` - Run quality checks
   - `danteforge synthesize` - Generate comprehensive project summary

### Automation Presets
For different development intensities:

- `danteforge spark [goal]` - Zero-token planning
- `danteforge ember [goal]` - Quick features with light checkpoints
- `danteforge magic [goal]` - Balanced daily workflow
- `danteforge blaze [goal]` - High-power with full orchestration
- `danteforge nova [goal]` - Very high power with planning
- `danteforge inferno [goal]` - Maximum power with OSS mining

### Special Commands
- `danteforge autoforge [goal]` - Deterministic auto-orchestration
- `danteforge party` - Multi-agent collaboration mode
- `danteforge debug <issue>` - Systematic debugging framework
- `danteforge oss` - Open source intelligence gathering
- `danteforge harvest` - Pattern extraction from OSS

## Integration with Goose

When using DanteForge within Goose:

1. **Use Shell Tool**: Execute DanteForge commands using the shell tool
2. **File Operations**: Use Goose's read/edit/write tools for file changes
3. **Sequential Execution**: Run DanteForge planning commands first, then use Goose tools for implementation
4. **Verification**: Use DanteForge's verify command to check work quality

## Example Workflow

```
1. danteforge constitution  # Define project principles
2. danteforge specify "Build a task management app"
3. danteforge plan
4. danteforge tasks
5. # Use Goose tools to implement features
6. danteforge verify  # Check implementation quality
```

## Best Practices

- Always run `danteforge constitution` first for new projects
- Use `danteforge verify` after significant changes
- Combine DanteForge planning with Goose's implementation capabilities
- Use `danteforge party` for complex multi-component features
- Leverage `danteforge debug` for systematic issue resolution

## Slash Commands for Goose

To make DanteForge workflows available as slash commands in Goose, map them as follows:

- `/spark [goal]` → `danteforge spark [goal]`
- `/magic [goal]` → `danteforge magic [goal]`
- `/blaze [goal]` → `danteforge blaze [goal]`
- `/nova [goal]` → `danteforge nova [goal]`
- `/inferno [goal]` → `danteforge inferno [goal]`
- `/verify` → `danteforge verify`
- `/party` → `danteforge party`
- `/autoforge [goal]` → `danteforge autoforge [goal]`

These can be implemented by creating an extension that provides these slash commands, each calling the corresponding DanteForge CLI command via shell execution.