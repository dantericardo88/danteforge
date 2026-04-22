---
name: go
description: Daily driver — run the self-improve loop with no flags. One word, max 5 cycles, target 9.0/10.
---

# /go — Daily Driver

The simplest way to improve your project. One command. No flags required.

## Usage

```
danteforge go                        # improve loop, 5 cycles, target 9.0
danteforge go "focus on security"    # optional goal for the loop
```

## What Happens

Equivalent to `danteforge self-improve --max-cycles 5 --min-score 9.0`.

1. Shows entry score
2. Runs up to 5 assess → forge → verify cycles
3. Shows exit score + cycle count
4. Reports whether target was achieved or offers next step

## Output

```
  Starting improvement loop — target: 9.0/10, max 5 cycles

  Before: 7.2/10
  After:  8.4/10  (3 cycles)
  Stopped after 3 cycles. Run again to continue.
```

## When to Use

Use at the start of a work session after `danteforge score` and `danteforge prime`.

CLI parity: `danteforge go [goal]`
