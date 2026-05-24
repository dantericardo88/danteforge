---
name: universe
description: "View the competitive feature universe — all unique capabilities across competitors, scored against the current project"
---
# /universe - Feature Universe Inspector

When the user invokes `/universe`, show the competitive feature universe:

1. Load (or build) the feature universe from competitors. **No /oss prereq required** — when nothing is configured, the universe falls back to a per-project preset (DanteForge gets `dev-tool-optimizer`; DanteCode / Cursor-class projects get `coding-assistant`).
2. Score the project against each feature in the universe (batched LLM evaluation).
3. Display a categorized breakdown: ✓ implemented | △ partial | ✗ missing.
4. Show the overall score, coverage %, and gap count vs. the completion target.

**Where competitors are resolved from (priority order):**

1. `state.competitors` in `.danteforge/STATE.yaml` — explicit user-defined list
2. `competitors` array in `.danteforge/compete/matrix.json` — calibrated list
3. `.danteforge/peers.json` — explicit per-project override (`{ "preset": "..." }` or `{ "competitors": [...] }`)
4. `state.peerPreset` field — explicit preset name
5. Per-project preset fallback — `package.json#name` and `state.project` are checked against the preset keywords:
   - `danteforge` → `dev-tool-optimizer` (spec-kit, BMAD, OpenSpec, claude-skills, DSPy, MetaGPT/CrewAI/etc.)
   - Names matching coding-assistant keywords (`cli`, `agent`, `ide`, `coding`, `copilot`, …) → `coding-assistant` (Cursor, Cline, Aider, OpenHands, Continue, Codex CLI, Claude Code, Devin, etc.)
6. If nothing matches → empty universe + a hint to configure `.danteforge/peers.json`

**Available presets** (ship with the CLI):

- **`coding-assistant`** — AI coding assistants and inner-loop dev agents. Used by sibling projects like DanteCode that directly compete with Cursor / Cline / Aider / OpenHands.
- **`dev-tool-optimizer`** — Agentic dev-tool optimizers that sit ON TOP OF coding assistants. DanteForge's own category (spec-kit / BMAD / OpenSpec / claude-skills / DSPy / etc.).
- **`agent-framework`** — Pure multi-agent orchestration frameworks (MetaGPT / CrewAI / AutoGen / LangGraph / etc.).

**To replace the matrix.json competitors:**

```bash
danteforge compete --reset --preset coding-assistant    # explicit preset
danteforge compete --reset --use-canonical              # auto-resolves project preset
```
Either form backs up the old matrix to `.danteforge/compete/matrix.pre-<timestamp>.json` first.

Options:
- `--refresh` — Force rebuild of feature universe from competitors
- `--json` — Output machine-readable JSON

CLI parity: `danteforge universe [--refresh] [--json]`

## Equivalent surfaces (all backed by the same engine)

- **Slash command:** `/universe` (this file)
- **Skill catalog:** `danteforge:universe` (invokable via the Skill tool in Claude Code)
- **CLI:** `danteforge universe [--refresh]`
- **MCP tools** (programmatic from any MCP client):
  - `danteforge_universe` — read the current universe, or `refresh: true` to rebuild
  - `danteforge_ensure_universe_ready` — idempotent preflight (used by ascend, inferno, matrixdev)
  - `danteforge_canonical_competitors` — returns the project's resolved preset (or pass `preset: "<name>"` for a specific one)
  - `danteforge_compete_reset` — replace matrix.json competitors (requires `confirm: true`; pass `preset: "<name>"` or `useCanonical: true`)

The MCP tools mean Claude Code / Codex / DanteCode can call into the universe programmatically without shelling out to the CLI.
