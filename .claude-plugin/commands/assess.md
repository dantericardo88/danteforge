---
name: danteforge-assess
description: "LLM-powered competitive assessment — score all 18 dimensions, benchmark against AI coding tool competitors, generate a gap-closing masterplan"
---

# /danteforge-assess — Harsh Self-Assessment

When the user invokes `/danteforge-assess`, run a comprehensive LLM-powered quality evaluation.

## What it Does

Unlike `/danteforge-score` (pure filesystem, deterministic), `assess` uses an LLM to:

1. **Score all 18 dimensions** (0–10) with contextual reasoning — not just file signals
2. **Benchmark against competitors**: Devin, GitHub Copilot Workspace, Cursor, Aider, SWE-Agent, MetaGPT, GPT-Engineer, Claude Code
3. **Identify gaps**: Dimensions below 9.0 and where competitors lead
4. **Generate a prioritized masterplan** (P0/P1/P2) with specific forge commands and verify conditions
5. **Save** `MASTERPLAN.md` and `masterplan.json` to `.danteforge/`

## Harsh Penalties Applied

- Stub/TODO patterns in source: -10 per file (max -30)
- Fake completion risk (high): -20
- Test coverage < 70%: -15
- Plateau (score unchanged ±2 for 3+ cycles): -5
- Missing error handling: up to -15

## Execution

```
danteforge assess                    # full LLM assessment with competitor benchmarking
danteforge assess --no-competitors   # skip competitor scan (faster)
danteforge assess --no-harsh         # normal PDSE thresholds (not strict mode)
danteforge assess --min-score 9.0    # custom passing threshold
```

## When to Use

- Before a major sprint (understand the real gaps)
- After several `/danteforge-forge` cycles (check if the score actually moved)
- When preparing for a release (confirm quality gates)
- When `/danteforge-score` shows a plateau and you want LLM context on why

## Difference from /danteforge-score

| `/danteforge-score` | `/danteforge-assess` |
|---|---|
| No LLM, pure filesystem | LLM-powered contextual analysis |
| Deterministic, < 5s | ~30–60s, contextual |
| Daily use, pulse check | Weekly or pre-sprint deep dive |
| 3 P0 items | Full 18-dimension breakdown + competitor benchmark + masterplan |

CLI parity: `danteforge assess [options]`
