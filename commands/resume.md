---
name: resume
description: Resume a paused autoforge loop from the last checkpoint (.danteforge/AUTOFORGE_PAUSED)
---

# Resume Autoforge

Resume a convergence loop that was paused via `--pause-at <score>`.

## Usage

```
danteforge resume
```

Reads `.danteforge/AUTOFORGE_PAUSED`, restores loop context, and continues from where it left off.

## When to Use

Run after `danteforge autoforge --auto --pause-at <score>` reaches the target score and pauses.
The pause snapshot records the cycle count, retry counters, and goal so the loop can resume cleanly.
