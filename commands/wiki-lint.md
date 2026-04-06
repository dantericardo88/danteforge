---
name: wiki-lint
description: "Run self-evolution scan on the wiki: contradictions, staleness, link integrity, pattern synthesis."
---

# /wiki-lint — Wiki Self-Evolution Lint Cycle

When the user invokes `/wiki-lint`, run all four lint passes:

1. **Contradiction scan**: For entity pages with multiple source entries, use LLM to detect conflicting claims. Auto-resolve if one source is strictly newer. Flag ambiguous cases for human review.

2. **Staleness scan**: Flag wiki pages whose most recent source update is older than 30 days (configurable) AND whose entity is referenced by active project artifacts.

3. **Link integrity**: Verify all `[[wikilinks]]` and frontmatter `links[]` resolve to existing entities. Create stub pages for unresolved link targets. List pages with zero inbound links.

4. **Pattern synthesis**: Aggregate decision history entries across wiki entities. Use LLM to identify recurring patterns worth promoting to dedicated pattern entity pages.

5. **Write LINT_REPORT.md**: Produce `wiki/LINT_REPORT.md` with all findings, pass rate, and recommendations.

6. **Append audit entry**: Record lint event to `.audit-log.jsonl`.

Options:
- `--heuristic-only`: Skip all LLM calls. Runs passes 2 and 3 only (staleness + link integrity). Zero-cost mode.

CLI usage: `danteforge wiki-lint [--heuristic-only] [--prompt]`

This command is also automatically triggered every 5th autoforge cycle.
