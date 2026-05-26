# Session Brief — 2026-05-26

**Project:** danteforge
**Score:** 7.1/10 — target: 9.0
**Top gaps:** communityAdoption (6.9), autonomy (7.5), tokenEconomy (7.5)

## Architecture
ESM-only TypeScript. Commander.js CLI. tsup → dist/index.js.
Tests: Node built-in runner + tsx. Injection seams throughout.
State: .danteforge/STATE.yaml.  Stage: synthesize.

## Anti-Patterns (do not repeat)
- Do NOT: Ensure: No successful forge wave was recorded
- Do NOT: Ensure: Light mode: test suite failed
- Do NOT: Ensure: Light mode: build failed
- Do NOT: Ensure: Constitution is not defined
- Do NOT: Ensure: Constitution (CONSTITUTION.md) missing

## Load in Claude Code
@.danteforge/PRIME.md
