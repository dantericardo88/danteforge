# Session Brief — 2026-06-09

**Project:** danteforge
**Builder score:** 8.8/10 (needs-work) — target: 9.0
**Competitive score:** 7.5/10 vs OSS leaders (run: danteforge compete)
**Top gaps:** communityAdoption (6.2), autonomy (7.5), tokenEconomy (7.5)

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
