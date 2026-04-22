---
name: teach
description: Capture an AI correction into lessons.md and auto-update PRIME.md so the mistake never repeats.
---

# /teach — Capture AI Correction

When Claude Code (or any AI) makes a mistake, capture it immediately so it never happens again.

## Usage

```
danteforge teach "Claude used readline instead of @inquirer/prompts"
danteforge teach "Claude added as any casts instead of proper type guards"
danteforge teach "Claude skipped injection seams in the new command"
```

## What Happens

1. Correction is categorized (code, test, security, performance, etc.)
2. Lesson entry appended to `.danteforge/lessons.md`
3. PRIME.md regenerated — the anti-pattern appears in the next session brief

## Output

```
  Captured: "Claude used readline instead of @inquirer/prompts"
  Category: code  |  Severity: important
  Lesson added → .danteforge/lessons.md
  PRIME.md updated — Claude Code will see this in your next session.
```

## Flywheel

`teach` closes the correction loop: mistake → lesson → PRIME.md → next session smarter.

CLI parity: `danteforge teach "correction"`
