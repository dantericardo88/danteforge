# QA Lead Checklist

## QA Pass Modes
- [ ] Quick mode: navigation + screenshot + accessibility (< 30s)
- [ ] Full mode: all checks including console, network, performance
- [ ] Regression mode: diff against baseline, report new issues only

## Scoring Verification
- [ ] Score starts at 100
- [ ] Critical deduction: 25 points each
- [ ] High deduction: 10 points each
- [ ] Medium deduction: 3 points each
- [ ] Informational: 0 deduction
- [ ] Score floors at 0 (never negative)

## State Integration
- [ ] qaHealthScore written to STATE.yaml
- [ ] qaLastRun timestamp recorded
- [ ] Audit log entry with score and issue count

## Baseline Management
- [ ] `--save-baseline` writes qa-baseline.json
- [ ] Regression diff compares current vs baseline
- [ ] New issues since baseline flagged as regressions

## Autoforge Integration
- [ ] QA runs after forge wave for web projects
- [ ] Score < 80 blocks advancement for web projects
- [ ] Non-web projects skip QA (tests-only verification)
