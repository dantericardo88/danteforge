---
name: compete
description: Competitive Harvest Loop — autonomously close competitive gaps via OSS discovery, /inferno sprints, and PDSE certification
---

# /compete — Competitive Harvest Loop (CHL)

You are the CHL engine. When invoked, execute the full 6-phase competitive engineering loop autonomously. Do not ask the user what to do next — work through each phase and report results.

## The 6 Phases (always in order)

| Phase | What you do |
|-------|------------|
| **1. INVENTORY** | Load or bootstrap the scoring matrix |
| **2. GAP** | Identify the highest-priority unclosed dimension |
| **3. SOURCE** | WebSearch for real OSS that solved this gap |
| **4. SPRINT** | Invoke /inferno to close the gap |
| **5. CERTIFY** | Verify tests pass, then rescore the dimension |
| **6. LOOP** | Show updated matrix, offer to continue |

---

## Phase 1 — INVENTORY: Load the Matrix

```bash
danteforge compete
```

Parse the output. If you see "No CHL matrix found", run:

```bash
danteforge compete --init
```

Wait for it to complete. Note the `overallSelfScore` and the list of dimensions.

---

## Phase 2 — GAP: Identify the Target

Read the "Next sprint:" line from `danteforge compete` output. That is the dimension for this sprint.

Extract:
- **dimension_id** — the snake_case ID (e.g., `ux_polish`)
- **dimension_label** — the human label (e.g., "UX Polish & Onboarding")
- **self_score** — current self score (e.g., 4.5)
- **gap** — gap to leader (e.g., 4.7)

**Rule**: One dimension per sprint. Never attempt to close 2 dimensions simultaneously.

---

## Phase 3 — SOURCE: Real OSS Discovery

Do NOT rely on your training data for OSS tool names — it may be outdated. Execute real WebSearch:

1. `WebSearch: "{dimension_label} open source MIT Apache github"`
2. `WebSearch: "best {dimension_keyword} implementation github 2025 stars"`
3. `WebSearch: "awesome {dimension_keyword} open source tools list"`

For each search result:
- Check license: accept only MIT, Apache-2.0, BSD-2-Clause, ISC, Unlicense. Skip GPL/AGPL/SSPL/proprietary.
- Note star count: prefer >1000 stars, accept >500.
- Note last commit: prefer active repos (commits within 6 months).

Select the **top 2-3 repos** that most directly implement the target dimension. Note:
- What specific pattern to harvest (not general features — a specific mechanism)
- Why this repo's approach beats alternatives

---

## Phase 4 — SPRINT: Get Masterplan and Invoke /inferno

First, get the CLI-generated masterplan:

```bash
danteforge compete --sprint
```

Read the "## /inferno Masterplan Goal" section from the output.

**Enrich the masterplan** with your Phase 3 OSS discoveries:
- Add the specific OSS repos to harvest from (with license confirmation)
- Add the specific patterns to extract from each repo
- Keep the explicit start score and target score from the CLI output

Now invoke /inferno with the enriched goal. **Do NOT tell the user to run it — execute it yourself.**

Example enriched goal:
```
Close "UX Polish & Onboarding" gap from 4.5 to 7.0.
Harvest from: Aider (MIT, 18k stars) — undo/redo diff display mechanism.
Also study: Continue.dev (Apache-2.0) — inline ghost text rendering approach.
Gold standard ceiling: Cursor at 9.2 — do not exceed scope.
```

Use the Skill tool or invoke the /inferno skill directly with this goal.

---

## Phase 5 — CERTIFY: Verify, Then Rescore

After /inferno completes, do NOT rescore immediately. Certify first:

```bash
npm run verify
```

Or:

```bash
danteforge verify
```

If verify fails:
- Fix all failures (this is part of the sprint — the sprint isn't done until verify passes)
- Do NOT rescore with a failing receipt — the CERTIFY gate will block it anyway
- Re-run /inferno steps to fix failures, then verify again

Once verify passes, get the commit SHA:

```bash
git log --oneline -1
```

Rescore the dimension:

```bash
danteforge compete --rescore "{dimension_id}={new_score},{commit_sha}"
```

**Scoring rules** — be hyper-critical:
- 0.0 = not built at all
- 3.0 = prototype / proof of concept
- 5.0 = basic / functional but rough
- 7.0 = solid implementation, handles edge cases
- 9.0 = Cursor-level execution — what users pay for
- 10.0 = industry-leading

Do not round up. If you built a 6.5, score it 6.5.

---

## Phase 6 — LOOP: Show Updated Matrix

```bash
danteforge compete
```

Show the user the updated matrix with trend lines. Report:
- Which dimension was closed and by how much (`+X.X↑`)
- New overall self score
- Time saved vs. Cursor gap remaining

Then ask: **"The next highest gap is '{next_dimension}' (gap: {gap}). Start another sprint?"**

If yes, return to Phase 2 with the new dimension.
If no, run `danteforge compete --report` to generate the full CHL report.

---

## Key Rules

1. **Always WebSearch in Phase 3** — do not guess OSS tool names from training data
2. **One dimension per sprint** — this rule is non-negotiable
3. **Always verify before rescoring** — the CERTIFY gate blocks unverified scores anyway
4. **If /inferno fails**, fix failures before rescoring — a broken sprint is still a sprint
5. **Score yourself harshly** — generous scores produce roadmaps, hyper-critical scores produce urgency
6. **Harvest OSS legally** — MIT/Apache-2.0/BSD only. Skip GPL/AGPL. Never copy code verbatim — extract the pattern, implement it fresh.

---

## CLI Reference

```bash
# Phase 1: Bootstrap or view matrix
danteforge compete --init      # first-time setup
danteforge compete             # view gap table + trend lines

# Phase 4: Get masterplan
danteforge compete --sprint

# Phase 5: Certify and rescore
danteforge compete --rescore "dimension_id=7.5,abc123sha"
danteforge compete --rescore "dimension_id=7.5,abc123sha" --skip-verify  # emergency override

# Generate full CHL report
danteforge compete --report
```

## Why This Works

The two-matrix structure (closed-source = gold standard, OSS = harvestable) is not cosmetic. It answers:
- "What do users pay for?" → closed-source scores
- "What can we legally harvest right now?" → OSS scores and harvest_source

The gap list drives every sprint. Without the matrix, sprints are feature work. With the matrix, sprints are a measurable march toward market parity.

CLI parity: `danteforge compete [--init] [--sprint] [--rescore <id=score[,sha]>] [--report] [--skip-verify]`
