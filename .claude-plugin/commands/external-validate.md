---
name: danteforge-external-validate
description: "Calibrate quality metrics against external OSS repos — verifies the scoring system isn't inflating your project's numbers"
---

# /external-validate — External Metric Calibration

When the user invokes `/external-validate`, clone and score external OSS repositories to verify
that DanteForge's quality metrics are calibrated correctly against the real world.

1. **Clone repos**: Shallow-clone the specified external repos to a temp directory
2. **Score each repo**: Run the same objective metrics pipeline (ESLint, TypeScript, test pass rate)
   that is used to score your own project
3. **Compare tiers**: Validate that high-quality repos score in the high tier [6.5, 10],
   medium-quality in the medium tier [4.0, 7.5], and low-quality in the low tier [0, 5.5]
4. **Calibration check**: Flag if your local scores are systematically higher than comparable
   external projects (sign of metric inflation)
5. **Clean up**: Remove all cloned repos after scoring

## When to use this
- When you suspect your quality score is inflated relative to real projects
- After adding a new scoring dimension (verify it gives sensible results on known projects)
- Before publishing pattern bundles to ensure your claimed improvements are real
- Periodically as a sanity check that your baselines haven't drifted

## Output
- Per-repo scores with tier assignments (high/medium/low)
- Ranking validation: PASS if tiers align with expected quality, FAIL if not
- Your project's score in context of the external cohort
- Report saved to `.danteforge/external-validate-report.json`

Options:
- `<url...>` — GitHub URLs of repos to use as calibration targets
- `--tier <high|medium|low>` — Expected tier for each URL (one per repo)

CLI parity: `danteforge external-validate <url...> [--tier high]`
