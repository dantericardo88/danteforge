---
name: retro
domain: general
source: gstack-harvest
version: 0.8.0
integrates:
  - autoforge-loop
  - synthesize
  - lessons-index
---

# Retrospective Skill

## Iron Law
Every shipped phase deserves reflection. Retro metrics are computed from git data with zero PII — no author names, no email addresses, no external identifiers.

## Process
1. **Gather Metrics**: Analyze git log for commit count, LOC added/removed (no author info)
2. **Score**: Composite score (0–100) from commit activity, code volume, test coverage, lessons, waves
3. **Compare**: Delta against prior retro (↑ improving, ↓ regressing, → stable)
4. **Reflect**: Generate praise (what went well) and growth areas (what to improve)
5. **Record**: Write JSON + markdown to `.danteforge/retros/`, update STATE.yaml

## Red Flags
- Score declining across 3+ retros
- Zero lessons captured
- No test coverage improvement
- High LOC added with zero LOC removed (tech debt accumulation)
