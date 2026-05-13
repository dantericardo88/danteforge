---
name: universe
description: "View the competitive feature universe — all unique capabilities across competitors, scored against the current project"
contract_version: "danteforge.workflow/v1"
stages: [build, score, display]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: false
---

# /universe - Feature Universe Inspector

When the user invokes `/universe`, show the competitive feature universe:

1. Load (or build) the feature universe from competitors. **No /oss prereq required** — when nothing is configured, the universe falls back to the canonical DanteForge peer list (spec-kit, BMAD, OpenSpec, claude-skills, Karpathy autoresearch, DSPy, MetaGPT, CrewAI, AutoGen, GPT-Engineer, OpenHands, Aider, SWE-Agent, LangChain Agents — 16 peers).
2. Score the project against each feature in the universe (batched LLM evaluation).
3. Display a categorized breakdown: ✓ implemented | △ partial | ✗ missing.
4. Show the overall score, coverage %, and gap count vs. the completion target.

**Where competitors are resolved from (in priority order):**
1. `state.competitors` in `.danteforge/STATE.yaml`
2. `competitors` array in `.danteforge/compete/matrix.json`
3. Canonical DanteForge peer list (built-in fallback — 16 peers)

**The universe grows as more competitors are analyzed:**
- 16 peers × 12 features each → ~40-80 unique feature line items (after dedup)
- This IS the grading universe — the definition of what "complete" looks like

To replace the matrix.json competitors with the canonical DanteForge peer list:
```
danteforge compete --reset --use-canonical
```
This backs up the old matrix to `.danteforge/compete/matrix.pre-<timestamp>.json` first.

Options:
- `--refresh` - Force rebuild of feature universe from competitors
- `--json` - Output machine-readable JSON

CLI parity: `danteforge universe [--refresh] [--json]`

## Equivalent surfaces (all backed by the same engine)

- **Slash command:** `/universe` (this file)
- **Skill catalog:** `danteforge:universe` (invokable via the Skill tool in Claude Code)
- **CLI:** `danteforge universe [--refresh]`
- **MCP tools** (programmatic from any MCP client):
  - `danteforge_universe` — read the current universe, or `refresh: true` to rebuild
  - `danteforge_ensure_universe_ready` — idempotent preflight (used by ascend, inferno, matrixdev)
  - `danteforge_canonical_competitors` — the 16-peer canonical seed, grouped by category
  - `danteforge_compete_reset` — replace matrix.json competitors (requires `confirm: true`)

The MCP tools mean Claude Code / Codex / DanteCode can call into the universe programmatically without shelling out to the CLI.
