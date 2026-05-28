---
name: confidence-tagging
description: "Tag every claim, relationship, and competitive score with EXTRACTED/INFERRED/AMBIGUOUS evidence quality. Use when writing dossiers, competitive analysis, lesson entries, or any structured knowledge where the difference between 'I saw this in their docs' and 'I guessed this from context' matters. Prevents confident-sounding hallucinations from polluting the competitive matrix."
---

# Confidence Tagging

> Every claim has a source quality. EXTRACTED is a fact. INFERRED is a deduction. AMBIGUOUS is a question.

## When to Use This Skill

- Writing dossier entries for competitors — tag every feature claim
- Recording lessons — tag whether the lesson came from observed behavior or assumption
- Scoring competitive matrix dimensions — tag the evidence behind each score
- Any research output where you want to distinguish observed facts from inferences
- Reviewing claims made by other agents — check confidence tags before acting on them

## The Three Tiers

### EXTRACTED (confidence = 1.0)

The relationship or claim is **explicitly stated** in a primary source:
- Found directly in official docs, changelog, README, or source code
- Demonstrated in a live demo or product screenshot
- Stated explicitly in a press release, blog post, or official announcement
- Captured from a direct API call or CLI output

**Never suppressed. Always trusted.**

Examples:
```
✓ "Competitor X supports OAuth2" — EXTRACTED from their docs at /auth/oauth2
✓ "Function calls ProcessPayment" — EXTRACTED from AST import analysis
✓ "Score 8.5 on testing" — EXTRACTED from passing capability_test shell command
```

### INFERRED (confidence = 0.55–0.95)

The claim is a **reasonable deduction** from available evidence, not directly stated. Use the discrete rubric — never interpolate between values:

| Score | Evidence Quality | Example |
|-------|-----------------|---------|
| `0.95` | Direct structural evidence — named cross-file reference, explicit pattern in code | "Uses rate limiting" inferred from seeing `RateLimiter` imported and called |
| `0.85` | Strong inference — clear functional alignment, no direct symbol link | "Has auth middleware" inferred from seeing protected routes pattern |
| `0.75` | Reasonable inference — shared problem domain + similar shape, requires interpretation | "Supports multi-tenancy" inferred from tenant_id field in API schema |
| `0.65` | Weak inference — thematically related, no concrete shape evidence | "Has enterprise tier" inferred from pricing page structure |
| `0.55` | Speculative — surface-level co-occurrence only | "Competes on performance" inferred from marketing language |

**Suppression rule:** Cross-domain INFERRED edges (e.g., inferring a Python-specific pattern from a JavaScript codebase) should be dropped or marked AMBIGUOUS. Terminology drift between domains creates false positives.

### AMBIGUOUS (confidence = 0.1–0.3)

The claim is **uncertain** — conflicting signals, insufficient evidence, or too many possible interpretations. Flag for research, not for acting on.

| Score | Situation |
|-------|-----------|
| `0.3` | Two plausible interpretations, one slightly more likely |
| `0.2` | Conflicting evidence in different sources |
| `0.1` | Complete speculation — include only if worth researching |

**Action rule:** Before acting on an AMBIGUOUS claim, verify it. An AMBIGUOUS competitive claim should generate a research question, not a fork decision.

---

## Discrete Rubric Rationale

Use exact values from the set {0.95, 0.85, 0.75, 0.65, 0.55} for INFERRED edges. **Never use 0.5.**

Why discrete? Continuous confidence ranges collapse in practice — agents default to 0.5 (middle) or 0.85+ (optimistic). Forcing discrete choice from a named rubric requires the agent to justify its confidence level:

- "Is this 0.85 (strong inference) or 0.75 (requires interpretation)?" forces an honest evaluation
- 0.5 has no meaning in this rubric — it's the lazy default. If nothing fits above 0.55, mark AMBIGUOUS

---

## Application in DanteForge Contexts

### Competitive Dossier Entries

```markdown
## Competitor: Cursor

### Feature: Multi-file editing
- **Claim:** Supports simultaneous edits across 10+ files in one action
- **Confidence:** EXTRACTED (1.0) — demonstrated in official demo video, docs at /features/edit
- **Source:** https://cursor.sh/docs/multi-edit

### Feature: Custom AI models
- **Claim:** Users can connect their own OpenAI API key
- **Confidence:** INFERRED (0.85) — seen in settings screenshots, no official docs page
- **Source:** Twitter screenshot from @user, 2026-03-15

### Feature: Real-time collaboration
- **Claim:** Multiple users can edit simultaneously
- **Confidence:** AMBIGUOUS (0.2) — conflicting: roadmap mentions it, product page doesn't list it
- **Research question:** Is collaborative editing shipping in v2.0 or still on roadmap?
```

### Competitive Matrix Scores

When scoring a dimension, tag the evidence:

```markdown
## Dimension: testing (score: 7.5)

Evidence:
- Unit test suite present — EXTRACTED (1.0) from GitHub CI badges
- Test coverage ~70% — INFERRED (0.75) from badge + visible test structure
- E2E tests present — INFERRED (0.65) from cypress/ directory seen in screenshot
- Mutation testing — AMBIGUOUS (0.2) from one tweet mentioning stryker

Score justification: EXTRACTED evidence supports ≥6, INFERRED at 0.75+ supports up to 8.
Penalized for AMBIGUOUS mutation claim (unverified).
Final: 7.5 (would be 8.0 if mutation testing confirmed EXTRACTED).
```

### Lessons Entries

```markdown
## [Testing] Verify mock behavior matches real behavior
_Added: 2026-05-28_
_Source confidence: EXTRACTED — direct observation from failing test in prod_

**Observation:** Integration test passed with mocked database but failed in prod migration.
**Rule:** Never mock internal modules; only mock at external system boundaries.
```

Source confidence tells you how much to trust the lesson:
- EXTRACTED lesson (direct observation) → follow immediately
- INFERRED lesson (pattern recognition) → follow with awareness of context
- AMBIGUOUS lesson (one-time occurrence) → treat as a hypothesis, verify before enshrining

### Agent Evidence Records

When agents produce `agent-evidence.json` for the matrix kernel:

```json
{
  "dimensionId": "testing",
  "agentId": "codex-worker-1",
  "claims": [
    {
      "claim": "All 172 smoke tests pass",
      "confidence": "EXTRACTED",
      "confidence_score": 1.0,
      "source": "npm run test:smoke output",
      "evidence_file": "agent-evidence/test-output.txt"
    },
    {
      "claim": "Coverage is above 80%",
      "confidence": "INFERRED",
      "confidence_score": 0.75,
      "source": "Test output shows 84.2% for sampled modules"
    },
    {
      "claim": "No flaky tests",
      "confidence": "AMBIGUOUS",
      "confidence_score": 0.2,
      "source": "Tests passed once, no repeated runs done"
    }
  ]
}
```

The merge court can then weight claims by confidence: EXTRACTED claims are blocking evidence; AMBIGUOUS claims generate research tasks before score increases.

---

## Suppression Rules (Don't Propagate False Positives)

### Cross-Domain Suppression

Don't infer patterns across incompatible domains:

| Suppressed | Reason |
|-----------|--------|
| "Python patterns → TypeScript behavior" | Different type systems, different conventions |
| "Marketing claims → Technical capability" | Marketing language doesn't guarantee implementation |
| "OSS repo → Paid product feature" | Different codebases, different feature sets |
| "Past version → Current behavior" | Software changes; stale docs create false EXTRACTED claims |

### Staleness

EXTRACTED claims have expiration:
- API docs: valid for ~6 months (products iterate fast)
- Architecture diagrams: valid for ~3 months
- Changelog entries: valid indefinitely (historical fact)
- Screenshots: valid for ~1 month (UIs change frequently)

If the source is older than the validity window, downgrade from EXTRACTED → INFERRED and note the staleness.

---

## Review Checklist

Before publishing any competitive analysis, dossier, or structured knowledge output:

- [ ] Every claim has a confidence tag (EXTRACTED, INFERRED, or AMBIGUOUS)
- [ ] No claim uses 0.5 as a confidence score (use a named tier or AMBIGUOUS)
- [ ] AMBIGUOUS claims have research questions attached (not just flagged and forgotten)
- [ ] Cross-domain INFERRED claims are suppressed or marked AMBIGUOUS
- [ ] EXTRACTED sources include the specific URL/file/line where the claim was found
- [ ] Date-sensitive EXTRACTED claims include when the source was captured

---

## Integration with Adversarial Scoring

When running `danteforge score --adversary`, provide the adversary with confidence-tagged evidence rather than bare scores. This gives the adversary the ability to:
- Confirm EXTRACTED claims (verify the source is real and current)
- Challenge INFERRED claims (question the inference chain)
- Research AMBIGUOUS claims (resolve open questions)

A score supported entirely by EXTRACTED evidence should survive adversarial review. A score built on INFERRED (0.55) evidence deserves healthy skepticism.

See the [adversarial-score skill](../adversarial-score/SKILL.md) for how to prevent the adversary from anchoring on your confidence tags.
