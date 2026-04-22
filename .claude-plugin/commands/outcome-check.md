---
name: danteforge-outcome-check
description: "Validate pattern adoption outcomes — checks if adopted patterns actually improved quality and updates the attribution log"
---

# /outcome-check — Pattern Outcome Validation

When the user invokes `/outcome-check`, validate whether recently adopted patterns have
actually improved quality over the past 7 days.

1. **Load attribution log**: Read `.danteforge/attribution-log.json`
2. **Check lagging deltas**: For each pattern adopted in the last 7 days, compute the
   7-day average score delta to see if improvement held
3. **Validate hypotheses**: If a pattern had an `outcomeHypothesis` (expected dimension to improve),
   verify whether that dimension actually improved
4. **Falsify failed hypotheses**: Patterns where the hypothesis is false are automatically
   added to the refused-patterns blocklist so they won't be re-adopted
5. **Update records**: Save `hypothesisValidated` and `laggingDelta` back to the log

## When to use this
- 7-14 days after adopting a batch of patterns from OSS harvest
- After `/magic` or `/inferno` runs to validate the claimed improvements held
- Before sharing your pattern bundle with others (ensures you're not exporting garbage)

## Output
- Patterns checked: N
- Improved: N | Regressed: N | Neutral: N
- Hypotheses validated: N | Falsified: N
- Patterns added to refused list (auto-blocked for future adoption)

CLI parity: `danteforge outcome-check [--window 7]`
