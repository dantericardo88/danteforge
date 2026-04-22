---
name: danteforge-ci-report
description: "Run CI attribution gate — captures current metrics, diffs vs baseline, attributes regressions to recently adopted patterns"
---

# /ci-report — CI Quality Gate

When the user invokes `/ci-report`, run the CI attribution gate to detect quality regressions
and trace them back to recently adopted patterns.

1. **Capture metrics**: Run ESLint, TypeScript check, and test pass rate
2. **Build snapshot**: Compute current hybrid score
3. **Diff vs baseline**: Compare against last stored snapshot — detect regressions
4. **Attribute**: Find patterns adopted in the last 7 days that may have caused regressions
5. **Gate**: Fail (exit code 1) if score dropped more than 0.5 points or regressions detected
6. **Update baseline**: Save current snapshot as the new baseline (unless `--no-update`)

## When to use this
- In GitHub Actions / pre-push hooks as a quality gate
- After adopting a new batch of patterns to verify no regressions slipped through
- When CI is failing and you need to know which recent change caused it

## Output
- Current score vs baseline (+ or -)
- Regressions detected (if any)
- Suspect patterns (adopted last 7 days that may explain regressions)
- Gate: PASS or FAIL
- Report saved to `.danteforge/ci-report.json`

Options:
- `--window <days>` — Attribution lookback window (default: 7)
- `--threshold <score>` — Score drop that triggers failure (default: 0.5)
- `--no-update` — Do not update baseline after running

CLI parity: `danteforge ci-report [--window 7] [--threshold 0.5] [--no-update]`
