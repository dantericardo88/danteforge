---
name: refused-patterns
description: "Show and manage the blocklist of patterns proven not to work — prevents re-adoption of failed experiments"
---

# /refused-patterns — Pattern Blocklist

When the user invokes `/refused-patterns`, display the list of patterns that have been
refused (blocked) and allow managing the blocklist.

1. **List** (default): Show all refused patterns with reason, date, and score delta
2. **Add** (`--add <name>`): Manually block a pattern by name
3. **Remove** (`--remove <name>`): Unblock a pattern (e.g., if circumstances changed)
4. **Clear** (`--clear`): Wipe the entire blocklist

Refused patterns are automatically added when `outcome-check` falsifies a hypothesis
(lagging delta ≤ 0). They prevent OSS-intel from re-suggesting the same failed work.

## When to use this
- After hitting a plateau — see what was already tried and failed
- Before running `/harvest-forge` — verify the blocklist is accurate
- If a pattern was incorrectly refused — use `--remove` to unblock it
- As part of Workflow 5 (Recover from plateau): `/status → /refused-patterns → /respec`

## Output
- List of refused patterns (name, source repo, reason, date, lagging delta)
- Or confirmation of add/remove/clear action

CLI parity: `danteforge refused-patterns [--add <name>] [--remove <name>] [--clear]`
