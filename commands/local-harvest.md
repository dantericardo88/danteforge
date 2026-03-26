---
name: local-harvest
description: "Harvest patterns from local private repos, folders, and zip archives — combine with OSS intelligence for ultimate planning synthesis"
contract_version: "danteforge.workflow/v1"
stages: [local-harvest, oss, synthesize]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: optional
verification_required: false
---

# /local-harvest — Private Repository Intelligence

When the user invokes `/local-harvest`, harvest patterns from their local private projects:

1. Resolve sources from path arguments, `--config` YAML, or interactive picker
2. For each source (folder, zip, or git repo): extract planning docs + code insights
3. Run LLM pattern extraction: architecture, novel ideas, technical approaches
4. Synthesize all sources into a unified "what's worth keeping" report
5. Recommend OSS search queries to find complementary implementations

## Source Selection

**Path arguments** (quick):
```bash
danteforge local-harvest ./old-project-1 ./old-project-2 ~/archives/idea.zip
```

**Config file** (persistent):
```bash
danteforge local-harvest --config .danteforge/local-sources.yaml
```

**Interactive picker** (no args):
```bash
danteforge local-harvest
```

## Depth Levels

- `--depth shallow` — Planning docs only (UPR, SPEC, PLAN, CONSTITUTION, README)
- `--depth medium` — Planning docs + entry points (default)
- `--depth full` — Planning docs + top source files

## Ultimate One-Command Flow

For a new project: combine local harvest + OSS discovery + full inferno build:

```bash
danteforge inferno "my goal" --local-sources ./proj1,./proj2 --local-depth medium
```

Pipeline: **local-harvest → oss → specify → plan → tasks → autoforge → party → verify → convergence**

## Options

- `--config <path>` — YAML config file listing sources
- `--depth shallow|medium|full` — Analysis depth (default: medium)
- `--prompt` — Show harvest plan without executing
- `--dry-run` — Detect source types without reading
- `--max-sources <n>` — Limit sources (default: 5)

CLI parity: `danteforge local-harvest [paths...]`
