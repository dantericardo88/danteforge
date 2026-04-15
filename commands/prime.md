---
name: prime
description: Generate .danteforge/PRIME.md — a 200-word compressed session brief for Claude Code.
---

# /prime — Session Primer

Generates `.danteforge/PRIME.md`: a sharp ~200-word project brief that Claude Code loads at session start.

## Usage

```
danteforge prime          # write PRIME.md
danteforge prime --copy   # also show clipboard copy hint
```

## What Gets Written

- Current score + top 3 gaps
- Architecture summary (derived from STATE.yaml)
- Anti-patterns from critical-severity lessons (do NOT repeat)
- How to load: `@.danteforge/PRIME.md`

## Load in Claude Code

```
@.danteforge/PRIME.md
```

This gives Claude Code full project context in every new session without repeating setup prompts.

CLI parity: `danteforge prime`
