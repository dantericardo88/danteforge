# DanteForge - Developer Guide

## What This Is

DanteForge is an agentic development CLI (v0.5.0) that fuses battle-tested patterns from leading open-source tools into one opinionated workflow: structured specs, execution waves, multi-agent orchestration, skills, hard gates, TDD enforcement, Figma UX refinement via MCP, git worktree isolation, guided tech stack decisions, manual MCP self-healing, and self-improving lessons.

## Build & Test

```bash
npm ci           # deterministic install
npm run verify   # typecheck + lint + tests
npm run build    # tsup -> dist/index.js (single ESM bundle)
npm run test     # tsx --test tests/**/*.test.ts
npm run dev      # tsup --watch
npm run lint     # eslint (check mode)
npm run lint:fix # eslint --fix
```

## Architecture

- `src/cli/` - Commander.js CLI with 25 commands
- `src/core/` - State (YAML), config, LLM client, gates, skills, logger, handoff, prompt builder, token estimator, MCP adapter
- `src/harvested/gsd/` - Wave executor, context-rot hooks, XML utils
- `src/harvested/spec/` - Clarify engine, templates
- `src/harvested/dante-agents/` - 5 agent roles, party mode, skills/, help engine
- `src/utils/` - Git worktree isolation
- `src/harvested/openpencil/` - Design-as-Code engine (.op codec, 86-tool registry, spatial decomposer, token extractor, headless SVG renderer)
- `hooks/` - Claude Code session-start hook runner + hook payload scripts
- `lib/` - JS skill discovery for plugin runtime
- `vscode-extension/` - VS Code integration (shells out to CLI)
- `.claude-plugin/` - Claude Code plugin manifest

## Key Patterns

- **Three-mode execution**: Every command supports LLM API mode, `--prompt` (copy-paste), and local fallback
- **Hard gates**: `requireConstitution`, `requireSpec`, `requirePlan`, `requireTests` - bypass with `--light`
- **State**: `.danteforge/STATE.yaml` tracks project, phase, tasks, audit log
- **Config**: `~/.danteforge/config.yaml` stores API keys; `./.danteforge/` is project state only
- **Skills**: YAML frontmatter in `SKILL.md` files, discovered at runtime
- **LLM providers**: Ollama (default/local), Grok, Claude, OpenAI, Gemini - dynamic SDK loading
- **Token estimation**: Warns before expensive API calls, auto-chunks large inputs
- **Self-improving lessons**: `.danteforge/lessons.md` captures corrections and failures; auto-compacts; feeds into forge/party/tech-decide
- **Design-as-Code**: `.op` JSON format for version-controlled design artifacts; 86-tool OpenPencil registry; native SVG renderer; design token extraction to CSS/Tailwind

## Workflow Pipeline

```
constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> forge/party (apply) -> verify -> synthesize
```

Build first, then refine visually. UX-refine runs after forge because you need live UI to push to Figma.

## Conventions

- `AGENTS.md` is the canonical agent instruction file (Codex/Claude/etc.); this file is adapter/context guidance
- ESM-only (`"type": "module"`)
- TypeScript strict mode, ES2022 target
- tsup bundles to single `dist/index.js`
- Skills live in `src/harvested/dante-agents/skills/<name>/SKILL.md`
- Tests use Node.js built-in test runner with tsx
- Attribution in NOTICE.md
