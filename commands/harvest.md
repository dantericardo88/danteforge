---
name: harvest
description: "Run a Titan Harvest V2 track — 5-step constitutional harvest of OSS patterns with hash-verifiable ratification"
---

# /harvest — Titan Harvest V2

When the user invokes `/harvest <system>`, execute the 5-step Titan Harvest V2 framework to extract clean-room patterns from OSS donors and produce a constitutionally ratified track.

## Core Principles

1. **Pattern Learning Only** — Extract superpowers, mechanical patterns, and donor-agnostic metacode idioms. Never copy code, schemas, assets, or visuals. Every implementation must be original.
2. **Constitutional Lock-In** — Once ratified, the track is immutable. Changes = new track or additive expansion only.
3. **Mechanical Purity + Determinism** — Every operation is hash-verifiable. Systems are regulators, not thinkers. No semantics, no discretion.
4. **Ruthless Deletion & Simplicity** — If anything can be deleted, merged, or skipped without breaking invariants → it must be.
5. **Evidence-Driven + Agile Immutability** — 100% replayable via hashes. Scope expansion only through mechanical protocols.

## Track Structure

Every track follows exactly 5 steps:

### Step 1: Discovery
- System Objective (1 sentence, locked)
- Donors (3-8 max; 2-3 in Lite Mode): Name + Why + 1-2 superpowers each
- Superpower Clusters (3-5 max)
- Proposed Organs (3-6 max): Name + Mandate + Prohibition + Boundary note

### Step 2: Constitution & Behavior
- For each organ: Mandates (4-6), Prohibitions (4-6), States (3-5), Operations (4-7)
- Global mandates (3-5) and prohibitions (3-5)

### Step 3: Wiring
- Signals (5-10 max): Name + Schema + Invariants
- Wiring Map (OrganA → Signal → OrganB)
- Dependency Graph
- Spine Compliance Declaration (SPINE-REV-0)

### Step 4: Evidence & Tests *(full mode only)*
- Evidence Rules (4-6 types + sufficiency gates)
- Test Charters (4-6 categories + 2-3 adversarials each)
- Golden Flows (1-3 flows + invariants/evidence guaranteed)

### Step 5: Ratification & Metacode
- Metacode Catalog (2-5 patterns + 2-4 anti-patterns)
- Gate Sheet Result
- Expansion Readiness Score (1-10, must be ≥8)
- Reflection ("One waste we deleted this track: …")
- SHA-256 hash of full track + `summary.json`

## Scope Expansion Protocol (SEP)

- **Type 1 Refinement** — better pattern for existing organ → SEP-LITE (Steps 1-3 + 5)
- **Type 2 Extension** — new organ or cluster → SEP-LITE (Steps 1-3 + 5)
- **Type 3 Overhaul** — changes mandates → full new track

Use `--lite` flag to run in SEP-LITE mode.

## Meta-Evolution

Every 5 tracks, run a meta-harvest on "Titan Harvest Framework" itself to self-evolve the doctrine.

## Options

- `--prompt` — Display the 5-step copy-paste template without calling the LLM
- `--lite` — Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)

## Output

Track files are written to `.danteforge/harvest/<trackId>/`:
- `track.json` — Full ratified track with all 5 steps
- `summary.json` — Compact summary: `{ trackId, organs, goldenFlows, expansionReadiness }`

CLI fallback: `danteforge harvest "<system>"`
