# Kilocode + DanteForge Integration

This package provides seamless integration between Kilocode and DanteForge, allowing you to use DanteForge's structured development workflows directly within Kilocode.

## Installation

```bash
npm install -g kilocode-danteforge
```

Or for local installation in your project:

```bash
npm install kilocode-danteforge
```

## What It Does

1. **Installs DanteForge CLI** - Ensures DanteForge is available globally
2. **Sets up Skills** - Creates DanteForge integration skills in supported AI assistant directories
3. **Provides Integration** - Allows Kilocode to execute DanteForge workflows

## Usage

After installation, you can use DanteForge commands within Kilocode:

### Load the Skill
```javascript
// Load the DanteForge integration skill
skill("danteforge-integration")
```

### Execute DanteForge Commands
```javascript
// Use bash tool to run DanteForge commands
bash("danteforge magic \"build a task management app\"")
bash("danteforge verify")
bash("danteforge autoforge \"implement user authentication\"")
```

### Combined Workflow
```javascript
// 1. Plan with DanteForge
bash("danteforge specify \"create a dashboard component\"")
bash("danteforge plan")
bash("danteforge tasks")

// 2. Implement with Kilocode tools
// Use read(), edit(), write() tools to implement the planned features

// 3. Verify with DanteForge
bash("danteforge verify")
```

## Available DanteForge Workflows

### Planning & Specification
- `danteforge constitution` - Define project principles
- `danteforge specify "<idea>"` - Convert ideas to specs
- `danteforge plan` - Create implementation plans
- `danteforge tasks` - Break down into executable tasks

### Development Automation
- `danteforge magic "<goal>"` - Balanced workflow (recommended)
- `danteforge autoforge "<goal>"` - Autonomous execution
- `danteforge party` - Multi-agent collaboration

### Quality Assurance
- `danteforge verify` - Run quality checks
- `danteforge debug "<issue>"` - Systematic debugging
- `danteforge qa` - Structured QA testing

### Design & UX
- `danteforge design "<prompt>"` - Generate design artifacts
- `danteforge ux-refine` - Refine user experience

## Best Practices

1. **Start with Planning** - Use DanteForge for initial planning and specification
2. **Iterate with Verification** - Run `verify` after significant changes
3. **Combine Strengths** - Use DanteForge for orchestration, Kilocode for implementation
4. **Use Appropriate Workflows** - Choose the right DanteForge preset for your task complexity

## Troubleshooting

If DanteForge commands fail:
1. Ensure DanteForge is installed: `danteforge --version`
2. Check that you're in a git repository for most commands
3. Use `danteforge init` to set up new projects

## Supported AI Assistants

This integration works with:
- Kilocode
- Claude Code
- Codex
- Other assistants that support skill-based extensions

## License

MIT