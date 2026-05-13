# DanteForge Unified Vision

**One Living Decision Graph. Scoring as the Universal Health Metric. Time Machine as the Immutable Backbone. Cross-Pollination as Default Behavior.**

## The Problem (Current State)

DanteForge has extraordinary depth:
- 100+ specialized commands
- Excellent scoring, Time Machine, Ascend, Universe, Competitive Intel, Harvest, Inferno levels
- Strong individual pieces (DecisionNode schema, evidence-chain, adversarial scoring, etc.)

But it feels fragmented:
- Commands are too autonomous
- Scoring, universe, ascend, compete, inferno do not automatically interconnect
- Time Machine is powerful but opt-in for most flows
- No single "source of truth" dashboard or recommended-next-action engine
- Cross-pollination (research → score → universe → ascend → re-score) is manual

## The Unified Vision (Target State)

**Every action in DanteForge participates in one living project state:**

```
[User Goal / Constitution]
        ↓
[Decision Graph (Time Machine)] ←→ [Current Score + Gaps + Universe Branches]
        ↕
[Research / Harvest / OSS / Competitive Intel] ↔ [Ascend / Synthesis / Parallel Universes]
        ↕
[Forge Intensity (spark→inferno) / Matrix-Dev] ↔ [Verify / Proof / Gates]
        ↕
[Ship / Retro / Lessons] → back into Graph
```

### Core Principles

1. **Time Machine is Always On**  
   Every command *must* emit a standardized `DecisionNode` (with `fileStateRef`, prompt, output, qualityScore, costUsd, causal links). No exceptions. This makes counterfactual replay, attribution, and "what if we chose X instead?" first-class and automatic.

2. **Scoring is the Universal Connector**  
   `src/scoring/` (and adversarial-scorer, harsh-scorer, canvas-quality-scorer, etc.) produces a multi-dimensional score vector + gaps.  
   - Low score or new gaps → auto-suggest / trigger Universe scan + Ascend synthesis + Competitive Intel + targeted Harvest.  
   - High frontier gap → aggressive OSS research.  
   - Score becomes the health metric shown in every `go` / `hub` / `magic` run.

3. **One Entry Hub (`danteforge go` / `hub`)**  
   Beautiful, always-up-to-date view of:
   - Current overall score + dimension breakdown
   - Active timeline + recent DecisionNodes
   - Universe branches with their scores
   - Top 3 recommended next actions (one-key shortcuts)
   - Gaps + auto-generated cross-pollination plan

4. **Cross-Pollination as Default**  
   After any significant run (forge, verify, harvest, compete):
   - Record node + update score
   - If score < threshold or new gaps → log + optionally auto-launch "universe + ascend + re-score" cycle
   - Shared session context persists across commands

5. **Intensity & Matrix-Dev are Score-Aware**  
   `inferno` / `matrix-dev` mode automatically focuses on lowest-scoring dimensions + competitive gaps.  
   `ascend` synthesizes the best edges from parallel branches to maximize score delta.

6. **Unified UX Layer**  
   All commands use shared `src/cli/ui/` helpers (consistent tables, progress, score badges, inquirer flows).  
   No more raw output or inconsistent prompts.

## Implementation Roadmap (Phased)

### Phase 1: Foundation (Immediate)
- Create `UNIFIED-VISION.md` (this doc)
- Add mandatory `recordDecisionNode()` helper + scoring hook in `src/core/decision-node-recorder.ts` and `src/core/state.ts`
- Enforce in top 10 commands (go, magic, forge*, verify, score, harvest*, compete, ascend, universe*)
- Make `go.ts` / new `hub.ts` the beautiful dashboard that reads live state + recommends actions

### Phase 2: Wiring (Next 2-4 weeks)
- Every major command reads current score/gaps before running and writes result + delta after
- Build `cross-pollinate.ts` orchestrator (or enhance `magic`/`autoforge`)
- Enhance Time Machine CLI with `graph`, `health`, `suggest-next`, `compare-branches`
- Standardize all CLI output via shared UI helpers

### Phase 3: Intelligence Layer (4-8 weeks)
- `ascend` / `universe` / `inferno` / `matrix-dev` become score-aware by default
- Automatic background cross-pollination after verify/harvest
- Visual dashboard (terminal or lightweight web) powered by Decision Graph
- Full "matrix-dev" mode = inferno + multi-agent + ascend + competitive in one orchestrated, scored run

### Phase 4: Polish & Deprecation
- Merge/ deprecate thin or duplicate commands (assess/score/quality variants, etc.)
- Complete test coverage + anti-stub on new core wiring
- Updated README + interactive tutorial walking through full scored → researched → ascended → verified cycle

## Success Metrics
- New user can run `danteforge go` and immediately understand current health + what to do next
- Every command automatically contributes to and benefits from the Decision Graph + Score
- Time Machine replay / counterfactual becomes the default way to debug or explore alternatives
- Score improvements are measurable and attributable across research, synthesis, and intensity choices

## Key Files to Evolve
- `src/core/decision-node.ts` + `decision-node-recorder.ts` (make mandatory + richer causal links)
- `src/core/state.ts` (central living project state: score, gaps, universe branches, active timeline)
- `src/cli/commands/go.ts` + new `hub.ts` (the unified dashboard)
- `src/core/time-machine.ts` (always-on recording + enhanced query/suggest APIs)
- `src/scoring/` (universal connector that feeds universe/ascend/compete)
- `src/core/ascend-engine.ts`, `feature-universe.ts`, `compete-matrix.ts` (make them consume + update central score)
- `src/cli/ui/` (new shared helpers)

This is the version of DanteForge that makes the 2027 vision in the README real and automatic: "Show me the exact decision that caused the vulnerability. What would the codebase look like if we had chosen the secure path instead?"

Let's build it.