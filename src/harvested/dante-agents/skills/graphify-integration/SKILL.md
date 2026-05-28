---
name: graphify-integration
description: "Use Graphify to build a queryable knowledge graph of any codebase before doing OSS research, architecture analysis, or competitive intelligence. Invoke before /oss or /inferno on an unfamiliar codebase, when answering 'how does X work?', when doing PR impact analysis, or when needing to find god nodes (core abstractions) in a project."
---

# Graphify Integration

> Build a knowledge graph once. Query it forever instead of grepping.

## When to Use This Skill

- Before `/oss` or `/inferno` on a codebase you don't know deeply — graph first, then forge
- When asked "how does X work?" or "what calls Y?" — prefer `graphify query` over grep
- Before merging work packets in the matrix kernel — use `graphify prs --conflicts` to detect architectural coupling risk
- When you need to identify a project's core abstractions (god nodes) before planning changes
- When doing competitive intelligence — graph the competitor's public code/docs to find their architecture

## Install

```bash
# Recommended (puts graphify on PATH automatically)
uv tool install graphifyy

# Alternatives
pipx install graphifyy
pip install graphifyy
```

Then register the skill with your AI assistant:
```bash
graphify install           # user-level (works in any project)
graphify install --project # project-level (committed to the repo)
```

## Quick Start: Build a Graph

```bash
# Build graph for current directory
/graphify .

# Build for a specific GitHub repo (clones automatically)
/graphify https://github.com/owner/repo

# Update only changed files (fast, no LLM needed for code-only changes)
/graphify . --update
```

Outputs to `graphify-out/`:
- `graph.html` — interactive browser visualization
- `GRAPH_REPORT.md` — god nodes, surprising connections, suggested questions
- `graph.json` — queryable graph (used by all query commands)

## Querying the Graph

Once `graphify-out/graph.json` exists, use queries instead of grep:

```bash
# Natural language questions (BFS — broad context, nearest neighbors first)
graphify query "what connects auth to the database?"
graphify query "how does the token refresh flow work?"

# Trace a specific dependency chain (DFS)
graphify query "how does UserService reach DatabasePool?" --dfs

# Find the relationship between two named concepts
graphify path "UserService" "DatabasePool"

# Explain everything connected to a node
graphify explain "RateLimiter"
```

### Constrained Vocabulary Expansion

Before running a query, extract vocabulary from the graph to avoid zero-hit queries:

```bash
# Get actual node label vocabulary
python3 -c "
import json, re
from pathlib import Path
data = json.loads(Path('graphify-out/graph.json').read_text())
vocab = set()
for n in data['nodes']:
    for c in re.findall(r'[^\W\d_]+', n.get('label','') or '', re.UNICODE):
        parts = re.findall(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+', c) or [c]
        for p in parts:
            t = p.lower()
            if 3 <= len(t) <= 30:
                vocab.add(t)
print(sorted(vocab))
"
```

Map your question to tokens from this vocabulary before querying. The graph matcher is literal — "authentication" won't match a node labeled "Guardian" unless you use the right token.

## DanteForge-Specific Workflows

### Before /oss or /inferno

Build the graph first to understand the codebase structure before harvesting patterns:

```bash
# 1. Clone the OSS repo (OSSHarvest)
git clone --depth 1 <oss-repo> X:\Projects\OSSHarvest\<name>

# 2. Build knowledge graph
cd X:\Projects\OSSHarvest\<name>
graphify . --no-viz   # skip HTML for large repos

# 3. Read GRAPH_REPORT.md to understand god nodes and architecture
cat graphify-out/GRAPH_REPORT.md | head -100

# 4. Query for DanteForge-relevant patterns
graphify query "agent loop orchestration"
graphify query "skill command dispatch"
graphify query "test gate verification"

# 5. Now run /oss patterns with graph context
```

This replaces blind grepping with targeted, graph-aware pattern extraction.

### PR Impact Analysis Before Matrix Kernel Merges

Before merging a work packet back to main via the merge court:

```bash
# 1. Ensure graph is current
graphify . --update

# 2. Check which PRs touch overlapping graph communities (merge-order risk)
graphify prs --conflicts

# 3. Deep dive on a specific PR's blast radius
graphify prs <PR_NUMBER>

# 4. Triage review queue by AI-ranked priority
graphify prs --triage
```

The `--conflicts` output shows PRs that touch nodes in the same graph community — these are architecturally coupled and should be merged in sequence, not parallel, to avoid conflicts.

**Example output:**
```
PR #42 (feat: add council streaming) — affects 18 nodes across 2 communities
PR #38 (fix: lease timeout) — affects 6 nodes across 1 community
⚠ CONFLICT RISK: #42 and #38 both touch "Council Orchestration" community
  Merge order: #38 first (smaller blast radius), then #42
```

### Architecture Understanding Before Planning

Before writing a SPEC or PLAN for a new feature:

```bash
# 1. Build graph of current codebase
/graphify .

# 2. Find god nodes — the core abstractions everything flows through
graphify query "most connected concepts"

# 3. Check if your planned change crosses community boundaries
graphify path "LeaseEngine" "MergeCourt"

# 4. Understand what a key module connects to
graphify explain "CapabilityTestRunner"
```

God nodes are the abstractions you MUST NOT break. Any forge wave touching a god node needs extra review.

## Understanding the Graph Report

`GRAPH_REPORT.md` sections to read first:

### God Nodes
The 10 most-connected concepts — core abstractions everything flows through. If your change touches a god node, treat it as high-risk and add extra tests.

```
God Nodes (degree centrality):
  LeaseEngine         (degree: 47) — touches agents, matrix, merge, verify
  CapabilityRunner    (degree: 31) — gate for all score increases
  WorkPacketDispatch  (degree: 28) — routes all work to agents
```

### Surprising Connections
Cross-community edges ranked by surprise score. These are non-obvious couplings — often the source of hard-to-debug issues.

```
Surprising Connections:
  SecurityScan → TokenEstimator  [INFERRED, 0.75]  — shared context management
  LessonCapture → MergeCourt     [INFERRED, 0.65]  — lessons feed merge decisions
```

High-surprise AMBIGUOUS edges are research questions: do these really connect, or is it a false positive?

### Suggested Questions
4-5 questions the graph is uniquely positioned to answer — use these as starting points for architecture review or forge planning.

## Confidence Tags in Graph Output

Every edge in the graph is tagged with a confidence level (see the `confidence-tagging` skill for the full rubric):

| Tag | Meaning | Trust Level |
|-----|---------|-------------|
| `EXTRACTED` | Explicit in source (import, call, citation) | Full trust |
| `INFERRED` | Reasonable deduction (0.55–0.95 score) | Context-dependent |
| `AMBIGUOUS` | Uncertain, flagged for review (0.1–0.3) | Verify before acting |

When building on graph findings, always check the confidence tag. Don't design around an AMBIGUOUS edge without verifying it first.

## MCP Server Mode

Expose the graph as an MCP tool for persistent agent access:

```bash
# Start MCP stdio server
python3 -m graphify.serve graphify-out/graph.json
```

Available tools: `query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`.

Add to `.mcp.json` for always-on access:
```json
{
  "mcpServers": {
    "graphify": {
      "command": "python3",
      "args": ["-m", "graphify.serve", "graphify-out/graph.json"]
    }
  }
}
```

Then agents can call `query_graph("how does auth work?")` without rebuilding the graph each session.

## Auto-Rebuild on Git Commit

```bash
# Install post-commit hook (rebuilds AST graph on every commit, no LLM needed)
graphify hook install
```

After every `git commit`, the hook detects changed code files and re-runs AST extraction. Doc/image changes require a manual `graphify . --update`.

Also installs a **git merge driver** for `graph.json` — two devs committing in parallel get their graphs union-merged automatically instead of conflict markers.

## Team Setup

Commit `graphify-out/` to git so everyone starts with a map:

```bash
# Recommended .gitignore additions:
echo "graphify-out/manifest.json" >> .gitignore
echo "graphify-out/cost.json" >> .gitignore
```

**Workflow:**
1. One person runs `/graphify .` and commits `graphify-out/`
2. Team pulls — their AI assistant reads the graph immediately
3. `graphify hook install` keeps it updated after each commit

## Anti-Patterns

1. **Grepping for architecture questions** — If `graphify-out/graph.json` exists, use `graphify query` instead. The graph is faster and provides relationship context grep can't.
2. **Building the graph without reading GRAPH_REPORT.md** — The report's god nodes and surprising connections are the highest-signal output. Read it before querying.
3. **Treating AMBIGUOUS edges as facts** — AMBIGUOUS means uncertain. Verify before designing around it.
4. **Forgetting `--update`** — After significant code changes, run `graphify . --update` to keep the graph current. Stale graphs give stale answers.
5. **Rebuilding from scratch every time** — Use `--update` to re-extract only changed files. Full rebuilds cost tokens; incremental updates are often free (code-only changes use AST, no LLM).
