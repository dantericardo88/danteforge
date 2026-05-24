---
name: crusade
description: "Autonomous frontier crusade — drives all competitive dimensions to 9.0/10 via OSS harvest + inferno waves with full evidence-based scoring guards, Fix A capability_test gate, outcome triage, and Time Machine audit trail."
contract_version: "danteforge.workflow/v1"
stages: [harvest, forge, validate, score, verify, repeat]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: true
---

# /crusade — Autonomous Frontier Crusade

When the user invokes `/crusade`, run the fully autonomous crusade loop: OSS harvest → inferno wave → validate → evidence-rescore → harden gate → repeat. Every score accepted by the loop MUST be backed by evidence. Every scoring pass emits a Time Machine commit. The loop does not stop until all eligible dimensions reach the target or are classified at ceiling.

## Scoring Doctrine (MANDATORY — read before every cycle)

All scoring in this loop obeys the full 13-rule **Scoring Doctrine** from `src/core/scoring-doctrine.ts`. The critical enforcement rules for this loop:

**Rule 9 — Zero-evidence fallback**: If `node scripts/evidence-rescore.mjs` reports 0 evidence entries, do NOT accept existing matrix scores. Fall back to running every outcome command directly. Scores above 5.0 are not defensible until `danteforge validate` has produced at least one receipt per dimension.

**Rule 10 — Fix A (capability_test gate)**: For every dimension with a `capability_test` field: run it before accepting any score > 5.0. If the command exits non-zero, the score is **clamped to 5.0** regardless of outcomes. Record the capability_test command and its output as the receipt. NEVER declare `FRONTIER_REACHED` on a dimension whose `capability_test` is failing.

**Rule 11 — Outcome triage**: When an outcome command fails, determine root cause:
- **(a) Genuine capability gap** — code or integration is missing/broken → reduces score, appears in priority ranking
- **(b) Outcome definition bug** — wrong file path, wrong keyword, wrong expectation → flag in `OUTCOME_BUGS` section, do NOT penalize score, fix the outcome and re-run

**Rule 12 — Bootstrapping dependency flag**: If an outcome checks for artifacts produced by the scoring system itself (e.g., `outcome-evidence/` files), flag it in `BOOTSTRAP_DEPS` section. Score on all other passing outcomes. Fix = run `danteforge validate`, not write new code.

**Rule 13 — Time Machine**: Every cycle MUST emit a Time Machine causal commit via `createTimeMachineCommit` with: `gitSha`, `dimensionId`, `scoreBefore`, `scoreAfter`, `outcomesPassed`, `capabilityTestResult`, loop name `"crusade"`. A cycle that does not record a Time Machine commit MUST NOT write scores to `matrix.json`.

## Default invocation

```bash
danteforge crusade                        # drive all dims to 9.0
danteforge crusade --target 8.5           # custom target
danteforge crusade --dim <id>             # single dimension
danteforge crusade --max-cycles 30        # cycle cap
danteforge crusade --parallel 4           # concurrent dims
danteforge crusade --dry-run              # plan + ceiling report, no execution
```

## Per-cycle execution (repeat until ALL_DONE or cycle cap)

### Step 0 — Check zero-evidence state (Rule 9)

```bash
node scripts/evidence-rescore.mjs --dry-run 2>&1 | grep "evidence entries:"
```

If the output shows `0 evidence entries`:
- Report: "Evidence pipeline has never run end-to-end. Scores above 5.0 are not defensible."
- For each target dimension: run all its outcome commands directly, compute tier score from raw pass/fail, write to matrix.json.
- Continue crusade — but flag the bootstrap state prominently in output.

### Step 1 — Pick target dimensions

```bash
danteforge compete --next-dims <parallel> --json
```

Sort by gap-to-leader descending. Skip dims where `score >= ceiling`. Use `MIN_T7_HIGH_TIER_OUTCOMES = 3` for T7 threshold check.

### Step 2 — OSS harvest (breadth)

```bash
danteforge harvest-forge --dim <dimId> --time 20m
```

Produces candidate code changes. These are breadth contributions — score ceiling for this step is **6.0**.

Every new module MUST answer before the wave closes:
1. What production `src/` function calls this? (not a test)
2. What is the observable output artifact?
3. What breaks silently if this fails?

If answer 1 is "nothing yet" → mark `orphan-pending`, ceiling **5.0**. Do not proceed to inferno on orphan-pending modules.

### Step 3 — Inferno wave (depth push)

```bash
danteforge inferno --dim <dimId> --target <score>
```

If Ollama times out or is unavailable, fall back to:
```bash
danteforge autoresearch --metric <dimId> --time 30m --allow-dirty
```

### Step 4 — Run outcomes (Rule 9, 11, 12)

```bash
danteforge outcomes --dim <dimId> --force-cold
```

For each failing outcome, perform triage:
- Is the file path correct? Is the expected string actually present?
- If the check is looking for `outcome-evidence/` files → **BOOTSTRAP_DEP**, not a capability gap
- If the check is looking for code that doesn't exist → **GENUINE_GAP**, reduces score
- If the check has a wrong expectation → **OUTCOME_BUG**, flag and skip penalty

### Step 5 — Validate (write receipts)

```bash
danteforge validate <dimId> --force-cold
```

This produces `OutcomeEvidenceEntry` receipts in `.danteforge/outcome-evidence/`. Until this passes, the dimension is structurally capped at **7.0**.

T7 (9.0) requires ≥ 3 high-tier (T5+) outcomes, ALL passing, ALL receipts ≤ 7 days old.

### Step 6 — Evidence rescore (Rule 9)

After receipts are written:

```bash
node scripts/evidence-rescore.mjs
```

This reads the evidence files and computes the evidence-derived score. This score is the **authoritative input** to Fix A.

### Step 7 — Fix A gate (Rule 10)

For each dimension with a declared `capability_test`:

```bash
# Run the capability_test command
<capability_test.command>
echo "Exit code: $?"
```

If exit code ≠ 0 AND evidence-derived score > 5.0:
- **Clamp reported score to 5.0**
- Record: `{ outcome_derived: <N>, capped: 5.0, capability_test_command: "...", capability_test_output: "...", reason: "FIX_A" }`
- Do NOT declare `FRONTIER_REACHED`
- Root cause the failure and either fix the code or fix the `capability_test` definition

If exit code = 0:
- Accept the evidence-derived score
- Record capability_test as PASS receipt

### Step 8 — Harden gate

```bash
danteforge harden --dim <dimId>
```

The 7-check harden gate applies additional structural caps. Any check that fails applies its cap:
- `orphan-audit` fail → cap at 6.0
- `claim-auditor` fail → cap at 7.0
- `recency-check` fail → cap at 7.0
- etc.

The final accepted score is `min(evidence_derived_score, fix_a_cap, harden_gate_cap)`.

### Step 9 — Time Machine commit (Rule 13, MANDATORY)

Before writing any score to `matrix.json`, emit a Time Machine causal commit:

```typescript
await createTimeMachineCommit({
  gitSha: currentGitSha,
  dimensionId: dimId,
  scoreBefore: preCycleScore,
  scoreAfter: finalAcceptedScore,
  outcomesPassed: passingOutcomeIds,
  capabilityTestResult: 'PASS' | 'FAIL' | 'NOT_DECLARED',
  agentLabel: 'crusade',
  materials: [evidenceFilePaths],
  products: [hardenReceiptPath],
});
```

If `createTimeMachineCommit` throws or is unavailable, **do NOT write scores** — log the error and mark the cycle as `PROVENANCE_MISSING`.

### Step 10 — Write score

Only after Time Machine commit succeeds:

```bash
npm run dimension:ascent -- propose --dimension <id> --score <finalAcceptedScore> --agent crusade --rationale "<evidence summary>"
npm run dimension:ascent -- merge --policy harsh-min --agent crusade
```

### Step 11 — Classify verdict

| Verdict | Condition |
|---------|-----------|
| `FRONTIER_REACHED` | Score ≥ target AND `capability_test` PASS AND harden gate PASS |
| `AT_CEILING` | Harden gate or Fix A caps below target (legitimate) |
| `CAPABILITY_TEST_BLOCKED` | Fix A clamped to 5.0 — code exists but test proves it broken |
| `OUTCOME_BUGS_BLOCKING` | All failures are outcome definition bugs — no genuine gap, fix the outcomes |
| `BOOTSTRAP_DEP` | Outcome-evidence dir empty — run `danteforge validate` end-to-end first |
| `GATE_BLOCKED` | Score Δ < 0.05 after 2 autoresearch runs |
| `PROVENANCE_MISSING` | Time Machine commit failed — score not written, cycle repeated |
| `MAX_CYCLES` | Ran cycle cap without reaching target |
| `FAILED` | Unhandled error |

### Step 12 — Re-rank and repeat

Read updated matrix → re-rank by gap-to-leader → pick next batch → return to Step 0.

Stop when: ALL dims are `FRONTIER_REACHED` or `AT_CEILING` → report `ALL_DONE`.

## Autonomy rules (all inherited from /harden-crusade)

- **Regrade cadence** — blocks if `wavesSinceLastRegrade > 3` (run `danteforge honest-rescore --regrade` first)
- **R1 halt-stuck-dim** — already-stuck dim halts the pass
- **R2 refuse-on-dispensation** — active dispensation blocks (TTL-aware)
- **R3 refuse-new-dims** — no new dims while old ones below frontier
- **R4 halt-infinite-refinement** — detects thrashing
- **R5 report-end-state** — always emit final verdict table
- **R6 document-irreducible-human-loop** — surfaces manual actions required

## Outcome triage report format

```
OUTCOME_BUGS (not scored as gaps):
  [dim: mcp_integration] outcome "mcp_plugin_manifest" — wrong file path: checks .claude/plugin.json, actual location .claude-plugin/plugin.json. Fix the outcome definition.

BOOTSTRAP_DEPS (run danteforge validate, not new code):
  [dim: depth_doctrine] outcome "evidence_receipts" — checks outcome-evidence/ dir which is produced by validate itself. Run danteforge validate --all first.

GENUINE_GAPS (scored, priority ranked):
  [dim: maintainability] capability_test FAIL — hardener.ts 904 LOC > 750 LOC limit. Score clamped to 5.0. Fix: split hardener.ts.
  [dim: mcp_integration] outcome "mcp_server_module" — mcp-adapter.ts missing 'Tool' registration. Genuine capability gap.
```

## Competitor comparison (anti-inflation guard)

Compare ONLY against the 14 actual competitors (2 closed-source + 12 OSS) defined in `scripts/evidence-rescore.mjs`:
- Closed-source: Kiro (AWS), Replit Agent
- OSS: spec-kit, BMad-METHOD, MetaGPT, CrewAI, AutoGen, GPT-Engineer, OpenHands, Aider, SWE-Agent, LangChain Agents, Dagger, re_gent

The 16 reference-tier tools (Cursor, Claude Code, Devin, Copilot, etc.) are EXCLUDED from gap and priority calculations. They are context only.

No adoption penalty. Never penalize for: no public users, no web UI, no community, being pre-release.

## Output

```
[Crusade] Cycle 3 — targeting: maintainability, mcp_integration

[Crusade] Step 6: evidence-rescore → maintainability: 0 evidence entries (bootstrap state)
[Crusade] Step 6: evidence-rescore → mcp_integration: 4/7 outcomes passing → T4/7.0

[Crusade] Step 7: Fix A gate
  maintainability: capability_test FAIL (hardener.ts 904 LOC > 750) → score clamped 9.0→5.0
  mcp_integration: capability_test PASS → accepting 7.0

[Crusade] Step 9: Time Machine commit abc123 (crusade/cycle-3)
  maintainability: 9.0 → 5.0 (CAPABILITY_TEST_BLOCKED)
  mcp_integration: 7.0 → 7.0 (AT_CEILING — bootstrap dep on mcp_server_module)

[Crusade] Outcome triage:
  OUTCOME_BUGS: mcp_plugin_manifest (wrong path)
  BOOTSTRAP_DEPS: evidence_receipts (run danteforge validate first)
  GENUINE_GAPS: mcp_server_module (missing Tool registration)

[Crusade] Cycle 3 complete. Verdicts:
  maintainability: CAPABILITY_TEST_BLOCKED (5.0/9.0) — fix: split hardener.ts (904→<750 LOC)
  mcp_integration: AT_CEILING (7.0/9.0) — fix: implement Tool registration in mcp-adapter.ts

Report: .danteforge/CRUSADE_REPORT.md
Time Machine: .danteforge/time-machine/<sha>.json
```

CLI parity: `danteforge crusade [--target N] [--dim <id>] [--max-cycles N] [--parallel N] [--dry-run]`
