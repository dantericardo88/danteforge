---
name: danteforge-lessons
description: "View and add to the project's self-improving lessons log — captures what worked, what failed, and feeds into future forge sessions"
---

# /danteforge-lessons — Lessons Log

When the user invokes `/danteforge-lessons`, view and manage the project's accumulated lessons.

## Execution

```
danteforge lessons            # view recent lessons
danteforge lessons --all      # view full lessons log
danteforge lessons add "lesson text"   # add a new lesson manually
danteforge lessons compact    # compact the log (remove duplicates, summarize)
```

## What It Shows

```
.danteforge/lessons.md — 23 lessons captured

Recent (last 5):
─────────────────────────────────────────
[2026-04-14] FIXED: Score oscillation was caused by plateau penalty in assessment-history.
  → score() now injects empty history stubs. assess() retains real history.

[2026-04-14] AVOIDED: SELECT* regex self-matched its own source code comment.
  → Use stripStringLiterals() + strip comments before running code-pattern checks.

[2026-04-14] PATTERN: Token bucket rate limiter needs _now injection for deterministic tests.
  → Real timer (setInterval) only starts when no _now is injected.
─────────────────────────────────────────
Run: danteforge lessons --all  to see all 23 lessons
```

## Lessons Feed Forward

Lessons are automatically injected into:
- `/danteforge-forge` context (avoids repeating mistakes)
- `/danteforge-assess` (informs quality evaluation)
- `/danteforge-retro` (retrospective pattern recognition)

## When to Add Lessons

Add a lesson whenever:
- A bug is fixed that could recur
- An approach was tried and failed
- A pattern worked unexpectedly well
- A false positive was found in the scorer

CLI parity: `danteforge lessons [--all] [add "text"] [compact]`
