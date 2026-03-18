---
name: qa-lead
domain: testing
source: gstack-harvest
version: 0.8.0
requires:
  - browse-binary
integrates:
  - autoforge-loop
  - verify
  - completion-tracker
---

# QA Lead Skill

## Iron Law
Web projects cannot reach "verified" status without a QA health score of 80 or above. The score is computed from runtime evidence, not file existence.

## Process
1. **Quick Pass**: `danteforge qa --url <url> --type quick` — navigation + screenshot + accessibility only (<30s).
2. **Full Pass**: `danteforge qa --url <url>` — navigation + screenshot + accessibility + console + network + performance.
3. **Regression Pass**: `danteforge qa --url <url> --type regression --baseline .danteforge/qa-baseline.json` — compare against baseline, report new issues.
4. **Baseline Save**: `danteforge qa --url <url> --save-baseline` — establish regression baseline.
5. **Gate**: `danteforge qa --url <url> --fail-below 80` — exit code 1 if score below threshold.

## Scoring
- Start at 100 points
- Critical issue: −25 points each
- High issue: −10 points each
- Medium issue: −3 points each
- Informational: no deduction

## Red Flags
- QA score drops below 80 on a previously passing project
- Regression diff shows new critical issues
- Navigation failure indicates broken deployment
- Performance degradation between forge waves

## Checklist
- [ ] QA report generated with score and issues
- [ ] Issues ranked by severity (critical → informational)
- [ ] STATE.yaml updated with qaHealthScore and qaLastRun
- [ ] Baseline saved for future regression comparison
- [ ] Evidence screenshots captured to `.danteforge/evidence/`
- [ ] Autoforge blocks advancement when score < 80 for web projects
