---
name: local-harvest
description: "Harvest patterns from local private repos, folders, and zip archives - combine with OSS intelligence for planning synthesis"
contract_version: "danteforge.workflow/v1"
stages: [local-harvest, oss, synthesize]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: optional
verification_required: false
---

# /local-harvest - Private Repository Intelligence

When the user invokes `/local-harvest`, harvest patterns from their local private projects:

1. Resolve sources from path arguments, `--config` YAML, or the interactive picker.
2. For each source, extract planning docs plus code insights.
3. Run LLM pattern extraction across architecture, novel ideas, and reusable decisions.
4. Synthesize the sources into a unified report.
5. Recommend OSS search queries to find complementary implementations.

Options:
- `--config <path>` - YAML config file listing sources
- `--depth shallow|medium|full` - Analysis depth (default: `medium`)
- `--prompt` - Show the harvest plan without executing
- `--dry-run` - Detect source types without reading
- `--max-sources <n>` - Limit sources (default: `5`)

CLI parity: `danteforge local-harvest [paths...]`
