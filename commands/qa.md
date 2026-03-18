---
name: qa
description: "Structured QA pass — health score, regression comparison on live app"
---

# /qa — Quality Assurance

When the user invokes `/qa`, follow this workflow:

1. **Require URL**: A staging or production `--url` is required
2. **Run QA checks**: Execute structured checks:
   - Layout and visual integrity
   - Core functionality and user flows
   - Performance metrics (load time, responsiveness)
   - Accessibility (WCAG compliance)
   - Cross-browser compatibility
3. **Calculate health score**: Score from 0-100 based on check results
4. **Compare baseline**: If `--baseline` provided, show regression delta
5. **Report**: Output structured QA report with pass/fail details

Options:
- `--url <url>` — Staging or production URL to test (required)
- `--type full|quick|regression` — QA mode (default: full)
- `--baseline <path>` — Baseline JSON for regression comparison
- `--save-baseline` — Save current report as new baseline
- `--fail-below <score>` — Exit code 1 if score below threshold

CLI fallback: `danteforge qa --url <url>`
