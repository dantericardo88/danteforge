# DanteForge — Honest Status (what works, what doesn't)

_Last updated: 2026-06-08. This is a deliberately honest, evidence-grounded status — written the same way the tool scores itself. No aspirational claims._

## The thesis

DanteForge scores a project against its real competitors and pushes it toward the frontier — **honestly**. The defining property: **a score cannot be typed, only earned.** Every gate (callsite-coupling, injection-seam, production-wiring/orphan, declared-ceiling, evidence-tier, frontier court) exists to cap anything unproven. If you fabricate evidence to move a number, the gate finds it and caps you.

## What works (proven this cycle, with receipts)

- **Honest scoring is real.** The 7→9 frontier path was repaired (it had been structurally unreachable); scores now flow from evidence through the integrity gates, not from self-assessment. DanteForge's own headline fell from a fabricated ~8.9 to an earned ~7.5 when measured honestly.
- **It generalizes beyond itself.** Cold-probing a second, structurally-different project (a monorepo VS Code extension) surfaced exactly one overfit bug (a display crash, fixed); the scoring/integrity/frontier machinery ran unchanged. It also correctly flagged that project's claimed 8.6 as fiction (all 54 outcomes fabricated).
- **One command on any repo.** `danteforge matrix-orchestrate cold-start` bootstraps an arbitrary repo with no PRD and no matrix → detects intent (package.json + README) → discovers real competitors (`gh` search) → synthesizes + scores a dimension matrix. Proven on two fresh cold repos.
- **A dimension can climb a rung honestly.** `planning_quality` went 7.0→8.0 by building real features (a clarify-blocking gate + cross-artifact analysis) and earning a passing T5 cli-smoke — the machine refused to inflate at every shortcut.

## What's partial / what doesn't (yet)

- **Most scores are an honest 5–8, and that's the point.** Reaching 9–10 requires real, multi-feature capability work (each dimension's `universe/*.md` Score Ladder defines exactly what) plus, for 9.5+, external adoption/telemetry the tool deliberately cannot fabricate.
- **`planning_quality` is at the FLOOR of rung 8** (2 of N Spec-Kit-grade elements), not the full rung.
- **Project auto-detect reads only the root `package.json`** — a monorepo whose signals live in `packages/*` detects as `other` (honest but coarse).
- **The `matrix*` parent-command collision is unresolved** — `matrix` (legacy claim/propose/merge), `matrix-orchestrate` (cold-start/detect/discover/…), and `matrix-kernel` are three different parents. Use the full name.
- **Fleet projects (DanteAgents, DanteSecurity) are scaffolded-but-unbuilt** — their dimensions are honest placeholders, not capabilities.

## How to start using it

- **New project from a PRD:** `danteforge matrix-orchestrate <prd.md>`
- **Any existing/cold repo:** `danteforge matrix-orchestrate cold-start`
- **See the honest state:** `danteforge compete status`  ·  **earn a score:** `danteforge validate <dim> --force-cold`
- **What unlocks the next tier:** `danteforge gap <dim>`

The honest way to use DanteForge is to let it tell you the truth, then do the real work it names — never to chase the number.
