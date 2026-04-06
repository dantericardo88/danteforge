---
name: wiki-query
description: "Search the wiki for entity pages, decisions, and patterns relevant to a topic."
---

# /wiki-query — Wiki Knowledge Search

When the user invokes `/wiki-query <topic>`, search the compiled wiki in two stages:

1. **Stage 1 — fast keyword search (zero LLM)**: Extract key terms from the query (stop-word filtered). Score each wiki entity page against terms (keyword match + recency bonus). Return ranked results.

2. **Stage 2 — LLM relationship inference (optional)**: If Stage 1 returns fewer than 3 results and the query appears complex, ask the LLM to identify implicit entity relationships that keyword matching would miss.

3. **Present results**: For each result, show entity ID, type, relevance score bar, excerpt, and source provenance.

Output formats:
- Default: human-readable table with score bars
- `--json`: Structured JSON array for programmatic use

CLI usage: `danteforge wiki-query <topic> [--json]`

Example: `danteforge wiki-query "scoring pipeline anomaly detection"`
