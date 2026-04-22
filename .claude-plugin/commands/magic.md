---
name: danteforge-magic
description: "Run a magic preset — targeted autoforge with LLM-driven convergence loops. Best for follow-up gap-closing after /danteforge-inferno."
---

# /danteforge-magic — Magic Preset Execution

When the user invokes `/danteforge-magic [goal]`, run a focused improvement sprint using the magic preset pipeline.

## Execution

```
danteforge magic "improve security dimension"     # focused goal
danteforge magic "close testing coverage gaps"    # coverage sprint
danteforge magic --preset ember                   # named preset
danteforge magic --preset nova                    # deeper preset
danteforge magic --preset inferno                 # maximum depth (same as /danteforge-inferno)
```

## Presets (Depth Order)

| Preset | Depth | Best For |
|---|---|---|
| `spark` | 1 step | Quick targeted fix |
| `ember` | 3 steps | Small gap closure |
| `nova` | 5 steps + convergence | Medium sprint |
| `canvas` | 5 steps + design | UX/design work |
| `magic` (default) | 7 steps + convergence | Standard sprint |
| `inferno` | Full + OSS discovery | First attack on new dimension |

## Difference from /danteforge-inferno

- `/danteforge-inferno` = first-time attack on a new matrix dimension + fresh OSS discovery
- `/danteforge-magic` = follow-up gap closing when you know the target

## Convergence Loop

After the main execution, magic runs verify → score → loop until the score moves or max cycles is reached. This self-heals failures without human intervention.

## Usage Rule

```
First-time new dimension + OSS discovery → /danteforge-inferno
Follow-up PRD gap closing               → /danteforge-magic
```

CLI parity: `danteforge magic [goal] [--preset name] [--cycles N]`
