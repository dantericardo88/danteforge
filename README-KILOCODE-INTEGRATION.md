# Kilocode + DanteForge Integration

This project provides a complete installation package for integrating DanteForge's powerful software engineering workflows directly into Kilocode.

## What is DanteForge?

DanteForge is an agentic development CLI that provides:
- **Structured Development Pipelines** - Constitution → Specification → Planning → Tasks → Implementation
- **Multi-Agent Orchestration** - Coordinate multiple AI agents for complex tasks
- **Quality Gates** - Built-in verification, testing, and quality assurance
- **Design Integration** - OpenPencil design-as-code capabilities
- **OSS Intelligence** - Automated research and pattern harvesting

## Installation

### Quick Install

```bash
# Clone this repository
git clone <this-repo-url>
cd DanteForge

# Run the installation script
node install-kilocode-danteforge.js
```

### Manual Installation

```bash
# 1. Build DanteForge
npm run build

# 2. Install dependencies for the installer
cd kilocode-danteforge-installer
npm install

# 3. Run setup
node setup.js
```

## What's Included

### 📦 Installation Package (`kilocode-danteforge-installer/`)
- **package.json** - NPM package configuration
- **setup.js** - Installation and skill deployment script
- **index.js** - API utilities for DanteForge integration
- **README.md** - Detailed usage documentation

### 🎯 DanteForge Integration Skill (`kilocode-danteforge-skill.md`)
A comprehensive skill that provides:
- Complete DanteForge command reference
- Integration patterns for Kilocode
- Workflow examples and best practices
- Troubleshooting guidance

### 🛠️ Installation Script (`install-kilocode-danteforge.js`)
Automated installer that:
- Builds DanteForge CLI
- Installs dependencies
- Deploys skills to appropriate directories
- Verifies installation

## How It Works

### Skill-Based Integration

The integration works through Kilocode's skill system:

1. **Skill Loading** - Load `danteforge-integration` skill when needed
2. **Command Execution** - Use bash tool to run DanteForge CLI commands
3. **File Operations** - Use Kilocode's native tools for implementation
4. **Workflow Orchestration** - Combine DanteForge planning with Kilocode execution

### Supported Directories

Skills are installed in multiple locations for compatibility:
- `~/.kilo/skills/` - Primary Kilocode skills
- `~/.config/kilo/skills/` - Global Kilocode config
- `~/.claude/skills/` - Claude Code compatibility
- `~/.codex/skills/` - Codex compatibility

## Usage Examples

### Basic Workflow

```javascript
// Load the integration skill
skill("danteforge-integration")

// Plan a new feature
bash("danteforge specify \"add user authentication\"")
bash("danteforge plan")
bash("danteforge tasks")

// Implement using Kilocode tools
// ... use read(), edit(), write() for implementation ...

// Verify quality
bash("danteforge verify")
```

### Quick Development

```javascript
// One-command development
bash("danteforge magic \"build a contact form component\"")
```

### Complex Projects

```javascript
// Multi-agent orchestration
bash("danteforge party --worktree --isolation")

// Autonomous execution
bash("danteforge autoforge \"implement e-commerce checkout\"")
```

## DanteForge Workflows

### Planning Pipeline
```
constitution → specify → clarify → tech-decide → plan → tasks
```

### Development Pipeline
```
design → forge → ux-refine → verify → synthesize
```

### Automation Levels
- **spark** - Zero-token planning
- **ember** - Quick features
- **magic** - Balanced workflow (recommended)
- **blaze** - High-power orchestration
- **nova** - Planning + execution
- **inferno** - Maximum power with OSS mining

## Best Practices

### When to Use DanteForge in Kilocode

1. **Complex Projects** - Multi-component features requiring coordination
2. **New Initiatives** - Starting fresh projects with proper planning
3. **Quality Assurance** - Structured verification and testing
4. **Team Collaboration** - Multi-agent orchestration for team workflows

### Integration Patterns

1. **Planning First** - Always start with DanteForge planning commands
2. **Iterative Development** - Plan → Implement → Verify cycles
3. **Quality Gates** - Use `verify` after significant changes
4. **Skill Combination** - Mix DanteForge orchestration with Kilocode implementation

### Troubleshooting

- **CLI Not Found** - Ensure DanteForge is installed globally
- **Skills Not Loading** - Check skill directories and restart Kilocode
- **Commands Failing** - Run `danteforge init` for new projects
- **Permission Issues** - Check write access to skill directories

## Architecture

```
┌─────────────────┐    ┌──────────────────┐
│    Kilocode     │────│ DanteForge CLI   │
│                 │    │                  │
│ • Skills        │    │ • Workflows      │
│ • Tools         │    │ • Orchestration  │
│ • File Ops      │    │ • Quality Gates  │
└─────────────────┘    └──────────────────┘
         │                       │
         └───── bash() ──────────┘
```

## Contributing

1. Test changes with `npm run verify`
2. Update skills in `kilocode-danteforge-skill.md`
3. Modify setup logic in `setup.js`
4. Update documentation in README files

## License

MIT - See individual package licenses for details.

## Support

- **Documentation** - See `kilocode-danteforge-installer/README.md`
- **DanteForge Docs** - Run `danteforge help`
- **Issues** - Report in the main DanteForge repository