---
name: oss-loop
description: "Competitive landscape discovery loop — repeatedly runs LLM-driven OSS discovery seeded from the competitive matrix until no new repos are found (plateau), then oss-sync to guarantee everything is on disk. Set it and forget it."
---
# /oss-loop — Competitive Landscape Discovery Loop

When the user invokes `/oss-loop`, run the full automated OSS discovery loop until the competitive landscape is complete.

## Native host rule for Codex/Claude

When this command is being executed inside Codex, Claude Code, or another host AI, the host agent MUST do the OSS discovery reasoning itself with its native model/session. Do not run bare `danteforge oss-loop` and wait for the CLI's configured LLM provider; that may route to Ollama or another local provider.

Host-native flow:

1. Read `.danteforge/compete/matrix.json`, `.danteforge/oss-registry.json`, and `.danteforge/titan-registry.json`.
2. Use the host model plus web/GitHub research to find candidate repos not already known.
3. Write `.danteforge/host-discovery/oss-loop-candidates.json`:

```json
{
  "repos": [
    { "name": "repo-name", "url": "https://github.com/org/repo", "reason": "why it is relevant" }
  ]
}
```

4. Run:

```bash
danteforge oss-loop --discovery-file .danteforge/host-discovery/oss-loop-candidates.json
```

With `--discovery-file`, the CLI skips `callLLM()` entirely and only performs deterministic clone/license/registry/sync work.

## What it does

1. Reads the competitive matrix to build context: project name, known competitors, top capability gaps by `gap_to_oss_leader`
2. Runs repeated LLM-driven discovery passes, each targeting the highest-gap dimensions
3. Each pass asks the LLM: "Find OSS projects relevant to these gaps that aren't already known"
4. Clones newly found repos (shallow, `--depth 1`), classifies their license, blocks GPL/AGPL
5. Registers each clone in `.danteforge/oss-registry.json` with its GitHub URL
6. Stops when N consecutive passes find zero new repos (**plateau = complete**)
7. Runs `danteforge oss-sync` at the end to ensure every matrix `oss_leader` is on disk

## Usage

```bash
danteforge oss-loop                          # run until plateau (3 empty passes)
danteforge oss-loop --plateau-passes 5       # require 5 empty passes before stopping
danteforge oss-loop --max-passes 30          # allow up to 30 total passes
danteforge oss-loop --max-repos-per-pass 10  # clone up to 10 new repos per pass
danteforge oss-loop --discovery-file .danteforge/host-discovery/oss-loop-candidates.json
danteforge oss-loop --no-sync                # skip final oss-sync
danteforge oss-loop --dry-run                # show discovery plan without cloning
```

## Plateau detection

The loop considers the competitive landscape **complete** when `--plateau-passes` consecutive passes find zero new repos. This means the LLM has exhausted its knowledge of relevant tools for this project's capability gaps.

Default: 3 consecutive empty passes → stop.

## When to run

- **Before a crusade** — ensures every relevant OSS tool is discovered and cloned for harvest
- **When expanding dimensions** — after adding new matrix dimensions, re-run to find new leaders
- **Periodic refresh** — re-run monthly to catch new OSS tools that have emerged
- **After `oss-clean`** — use `oss-sync` for restore (faster, no LLM), use `oss-loop` to discover new tools too

## Output example

```
[oss-loop] Building project context from competitive matrix...
[oss-loop] Context:
  Project: DanteForge
  Known OSS competitors: Aider, OpenHands, MetaGPT, CrewAI...
  Top capability gaps:
    - Multi-agent orchestration: gap 2.1 behind CrewAI
    - Context management: gap 1.8 behind Aider

[oss-loop] ── Pass 1/20 ──────────────────────
[oss-loop] Registry has 14 known repos. Discovering more...
[oss-loop] Found 4 new candidate(s):
  • smolagents — https://github.com/huggingface/smolagents
  • agno       — https://github.com/agno-agi/agno
  • controlflow — https://github.com/PrefectHQ/ControlFlow
  • pydantic-ai — https://github.com/pydantic/pydantic-ai
[oss-loop] ✓ Cloned and registered "smolagents" (MIT)
[oss-loop] ✓ Cloned and registered "agno" (Apache-2.0)
[oss-loop] Pass 1 complete: 4 cloned, 0 failed.

[oss-loop] ── Pass 8/20 ──────────────────────
[oss-loop] No new repos found (plateau 1/3).

[oss-loop] ── Pass 10/20 ─────────────────────
[oss-loop] No new repos found (plateau 3/3).
[oss-loop] PLATEAU REACHED — competitive landscape is complete.

─────────────────────────────────────────────
[oss-loop] Passes run:       10
[oss-loop] New repos found:  23
[oss-loop] Registry total:   37 repos
[oss-loop] Plateau reached:  YES — landscape is complete
─────────────────────────────────────────────
Next: run `danteforge oss-intel` to extract patterns from all cloned repos.
```

## After oss-loop

Once the loop completes, run:

```bash
danteforge oss-intel          # extract patterns from all cloned repos
danteforge compete --rescore  # update matrix with new OSS leader data
danteforge crusade            # start the frontier loop with full OSS context
```

## Relationship to other OSS commands

| Command | LLM needed | Purpose |
|---|---|---|
| `danteforge oss` | Yes | One-shot discovery pass |
| `danteforge oss-loop` | Yes | Repeated discovery until plateau |
| `danteforge oss-sync` | No | Restore from registry (fastest) |
| `danteforge oss-intel` | Yes | Extract patterns from cloned repos |
| `danteforge oss-clean` | No | Wipe disk cache |

CLI parity: `danteforge oss-loop [--plateau-passes N] [--max-passes N] [--max-repos-per-pass N] [--discovery-file path] [--no-sync] [--dry-run]`
