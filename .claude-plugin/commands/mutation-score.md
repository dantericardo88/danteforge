---
name: danteforge-mutation-score
description: "Run mutation testing on specific source files — validates that tests actually catch bugs, not just pass"
---

# /mutation-score — Targeted Mutation Testing

When the user invokes `/mutation-score`, run mutation testing on specific source files to verify
that paired tests would catch real bugs.

1. **Identify targets**: Use the files specified, or default to the 6 core files
2. **Generate mutants**: Apply 5 mutation operators per file:
   - `condition-flip`: flips `>` to `<=`, `===` to `!==`, etc.
   - `boolean-literal`: flips `true` to `false` and vice versa
   - `return-null`: replaces a return value with `null` or `undefined`
   - `boundary-shift`: changes `> N` to `>= N`, `< N` to `<= N`
   - `arithmetic-flip`: changes `+` to `-`, `*` to `/`, etc.
3. **Run paired tests**: For each mutant, run ONLY the paired test file (not the full suite)
   — approximately 200ms per mutant
4. **Score**: A mutant is "killed" if the paired test fails when the mutation is applied
5. **Report**: Per-file kill rate and overall mutation score

## When to use this
- After writing new tests, to verify they actually test the logic
- Before claiming a feature is "complete with tests"
- When the test count looks healthy but you suspect tests are not asserting on real behavior
- On any single file after fixing a bug (did you actually write a test that would have caught it?)

## Output
- Per-file: mutations generated, killed, survived, kill rate
- Overall mutation score (kills / total)
- Gate: PASS (≥60%) or FAIL (<60%)
- Report saved to `.danteforge/mutation-report.json`

Options:
- `[file...]` — source files to mutate (default: 6 core files)
- `--min-score <n>` — Minimum kill rate to pass gate (default: 0.6)
- `--max-mutants <n>` — Maximum mutants per file (default: 10)

CLI parity: `danteforge self-mutate [--files src/core/my-file.ts] [--min-score 0.6]`
