# DanteForge Integration Guide

Four ways to connect DanteForge to your AI coding environment.

## Method 1: CLI (Universal)

Works with any agent that can invoke shell commands.

```bash
npm install -g danteforge
danteforge --version
```

Agents can invoke any DanteForge command directly:
```bash
danteforge forge --light   # execute current task wave
danteforge assess          # run quality report
danteforge maturity        # check maturity level
```

## Method 2: MCP Server (Claude Code, Cursor, Codex, Windsurf)

DanteForge exposes 15 tools via the Model Context Protocol.

**Configure in Claude Code** — add to `.claude/settings.json` or your global Claude Code MCP config:
```json
{
  "mcpServers": {
    "danteforge": {
      "command": "danteforge",
      "args": ["mcp-server"],
      "description": "DanteForge spec-driven agentic dev pipeline"
    }
  }
}
```

**Configure in Cursor** — add to `.cursor/mcp.json`:
```json
{
  "danteforge": {
    "command": "danteforge",
    "args": ["mcp-server"]
  }
}
```

**Available MCP tools** (Claude Code / Cursor can call these directly):
- `danteforge_forge` — execute a task wave
- `danteforge_verify` — run verification and emit receipt
- `danteforge_assess` — 18-dimension quality scoring
- `danteforge_plan` — generate implementation plan
- `danteforge_tasks` — break plan into tasks
- `danteforge_constitution` — write/update project constitution
- `danteforge_specify` — generate SPEC.md from constitution
- `danteforge_clarify` — review spec for gaps and ambiguities
- `danteforge_synthesize` — generate summary handoff
- `danteforge_maturity` — check maturity level
- `danteforge_lessons_add` — record a lesson to lessons.md
- `danteforge_state_read` — read current project state
- `danteforge_masterplan` — generate gap-closing masterplan
- `danteforge_workflow` — show current pipeline position
- `danteforge_universe` — feature universe coverage assessment

Start the server manually to test:
```bash
danteforge mcp-server
# Outputs JSON-RPC on stdio — Claude Code connects automatically
```

## Method 3: Claude Code Plugin

DanteForge ships with a `.claude-plugin/plugin.json` manifest. If your Claude Code instance supports plugins, it picks up the manifest automatically from any project directory containing `.claude-plugin/`.

The plugin injects all 50+ slash commands into the session context via `hooks/session-start.mjs`.

## Method 4: Skills Export

Export DanteForge's harvested skill library to any agent's skills directory:

```bash
# Export to Claude Code
danteforge skills-import --export --target claude-code

# Export to Codex
danteforge skills-import --export --target codex

# Export to Cursor
danteforge skills-import --export --target cursor

# Export to all supported agents
danteforge skills-import --export --target all
```

Exported skills include: api-patterns, frontend-developer, frontend-design, senior-fullstack, react-patterns, nextjs-best-practices, database-design, and the danteforge-workflow meta-skill that teaches agents how to use DanteForge commands.

## Using DanteForge as a Library (SDK)

For programmatic integration in Node.js projects:

```bash
npm install danteforge
```

```typescript
import { assess, computeHarshScore, loadState } from 'danteforge/sdk';

// Run quality assessment programmatically
const result = await assess({ cwd: '/my/project', json: false });
console.log(result.overallScore); // 7.4

// Score a project directly
const score = await computeHarshScore({ cwd: '/my/project', targetLevel: 4 });
console.log(score.displayScore); // 6.8
```

## Which Method Should I Use?

| Scenario | Recommended method |
|---|---|
| You want the richest integration, fewest setup steps | MCP server (Method 2) |
| You're using Claude Code with plugins enabled | Plugin manifest (Method 3) |
| You want specific skills in any agent | Skills export (Method 4) |
| You're building a tool on top of DanteForge | SDK (Method 5) |
| Your agent can't do any of the above | CLI (Method 1) |
