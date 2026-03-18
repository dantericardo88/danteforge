---
name: magic
description: "Balanced default preset - token-efficient follow-up work with autoforge reliability and lessons"
---

# /magic - Balanced Default Preset

When the user invokes `/magic`, follow this workflow:

1. Treat `/magic` as the default balanced combo command for daily work
2. Route through the magic preset runner with level `magic`
3. Use budget-profile autoforge with parallel execution lanes by default
4. Keep hard gates, PDSE scoring, and lessons cleanup enabled
5. Report which preset steps ran and what should happen next

Options:
- `--level spark|ember|magic|blaze|inferno` - Route through a specific preset level
- `--profile quality|balanced|budget` - Override the default budget profile
- `--prompt` - Show the preset plan without executing it
- `--worktree` - Use an isolated worktree for heavier presets
- `--isolation` - Enable isolation when party mode is used

Usage rule:
- First-time new matrix dimension + fresh OSS discovery -> `/inferno`
- All follow-up PRD gap closing -> `/magic`

CLI parity: `danteforge magic [goal]`
