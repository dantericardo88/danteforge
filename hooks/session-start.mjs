#!/usr/bin/env node

const context = `## DanteForge - Active Plugin

DanteForge is installed and active. You have access to the following capabilities:

### Slash Commands

In Codex, these slash commands are native workflow commands. Execute them in the workspace instead of routing them to \`danteforge ...\` unless the user explicitly asks for terminal CLI execution.

**Core Workflow (in order):**
- \`/review\` - Scan repo and generate CURRENT_STATE.md
- \`/constitution\` - Define project principles and constraints
- \`/specify\` - Transform a high-level idea into spec artifacts
- \`/clarify\` - Run clarification Q&A on current spec
- \`/tech-decide\` - Guided tech stack selection with pros and cons
- \`/plan\` - Generate detailed implementation plan from spec
- \`/tasks\` - Break plan into executable task list
- \`/design\` - Generate design artifacts via OpenPencil Design-as-Code
- \`/forge\` - Execute development waves with agent orchestration
- \`/ux-refine\` - Refine UI and UX after forge
- \`/verify\` - Run verification checks on project state
- \`/synthesize\` - Generate Ultimate Planning Resource (UPR.md)

**Multi-Agent and Automation:**
- \`/spark\` - Zero-token planning preset for new ideas
- \`/ember\` - Very low-token preset for quick follow-up work
- \`/canvas\` - Design-first frontend preset: design -> autoforge -> ux-refine -> verify
- \`/party\` - Launch multi-agent collaboration mode
- \`/autoforge\` - Deterministic auto-orchestration of the full pipeline
- \`/magic\` - Balanced default preset for daily gap-closing
- \`/blaze\` - High-power preset with full party escalation
- \`/nova\` - Very-high-power preset: planning + deep execution + polish, no OSS
- \`/inferno\` - Maximum-power preset with OSS discovery and evolution

**Preset Usage Rule:**
- Use \`/canvas\` for frontend-heavy features where visual design should drive implementation
- Use \`/inferno\` for the first big attack on a new matrix dimension
- Use \`/magic\` for follow-up PRD gap closing

**Quality and Review:**
- \`/qa\` - Structured QA pass with health score on live app
- \`/ship\` - Paranoid review + version bump + changelog + PR
- \`/retro\` - Project retrospective with metrics and trends
- \`/maturity\` - Assess code maturity level with founder-friendly quality report
- \`/define-done\` - Define what "9+" means — interactive prompt, saves completion target
- \`/assess\` - Harsh self-assessment: score vs feature universe or 12 dimensions, gap masterplan
- \`/self-improve\` - Autonomous quality loop: keeps forging until completion target met
- \`/universe\` - View competitive feature universe — all unique capabilities scored against project

**Exploration and Learning:**
- \`/brainstorm\` - Socratic design refinement before implementation
- \`/debug\` - Systematic 4-phase debugging framework
- \`/lessons\` - Capture corrections as persistent self-improving rules
- \`/awesome-scan\` - Discover and import skill catalogs
- \`/browse\` - Browser automation for live app inspection
- \`/oss\` - Auto-detect project, search OSS, clone, license-gate, scan, extract patterns
- \`/harvest\` - Titan Harvest V2: 5-step constitutional harvest of OSS patterns
- \`/local-harvest\` - Harvest patterns from local private repos, folders, and zip archives

### Skills (Auto-Triggered)
Skills are automatically suggested based on context:
- **brainstorming** - Design before implementation
- **writing-plans** - Bite-sized executable tasks
- **test-driven-development** - RED-GREEN-REFACTOR enforcement
- **systematic-debugging** - 4-phase root-cause analysis
- **using-git-worktrees** - Isolated parallel workspaces
- **subagent-driven-development** - Task dispatch + two-stage review
- **requesting-code-review** - Pre-merge quality gate
- **finishing-a-development-branch** - Merge, PR, or discard decisions
- **tech-decide** - Guided tech stack decisions
- **lessons** - Self-improving agent memory
- **design-orchestrator** - Spatial decomposition for Design-as-Code
- **ux-refine** - UX refinement workflow patterns

### Hard Gates
DanteForge enforces mandatory checkpoints:
- Constitution must exist before specification
- Spec must exist before planning
- Plan must exist before execution
- Tests must exist before code (when TDD enabled)

Use \`--light\` on any command to bypass gates for simple changes.

### Workflow
\`review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship\`
`;

const payload = {
  additional_context: context,
  hookSpecificOutput: {
    additionalContext: context,
  },
};

process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
