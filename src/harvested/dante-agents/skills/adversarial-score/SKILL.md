---
name: adversarial-score
description: "Use when validating a self-score or quality assessment with an independent adversarial second opinion. Invoke after running `danteforge score` when you want to catch score inflation before declaring a feature complete or convergence reached."
---
# Adversarial Score

> Challenge your self-score with an independent LLM adversary. Catches score inflation before you declare victory.

## When To Use This Skill

- After `danteforge score` returns a score you want to validate
- Before declaring convergence in an improvement loop (e.g. after `/magic` or `/inferno`)
- When you suspect the same model that built the code is being lenient on its own work
- When preparing a quality certificate or release report that needs an honest external signal

## Why It Matters

When the same LLM builds code AND scores it, scores inflate. This has been validated empirically:
Claude re-scored a DanteAgents session from 6.1/10 to 5.5/10 the moment it was asked to be honest.
A second opinion — especially a different model — produces scores you can actually trust.

The better the adversary, the more honest the signal. Two providers with different training data
produce the sharpest critique.

## Commands

```bash
# Run adversarial scoring (uses Ollama auto-detect or self-challenge fallback)
danteforge score --adversary

# Per-dimension breakdown (all 18 dimensions)
danteforge score --adversary --full

# Adversarial gating in autonomous ascent loop
danteforge ascend --adversarial-gating

# Custom tolerance (how much lower adversarial score is acceptable vs target)
danteforge ascend --adversarial-gating --adversary-tolerance 0.3
```

## Adversary Resolution Chain

DanteForge automatically picks the best available adversary in this order:

1. **Configured provider** — set `adversary.provider` in `~/.danteforge/config.yaml`
2. **`DANTEFORGE_ADVERSARY_PROVIDER` env var** — runtime override
3. **Ollama auto-detect** — if Ollama is running locally and primary provider is not ollama,
   uses local model (free, zero config, different training → honest critique)
4. **Self-challenge fallback** — same provider, adversarial framing:
   "Do NOT validate your own previous output. Play a skeptical external evaluator."

## Divergence Panel Output

```
Dual-Score Panel  (adversary: ollama/llama3 — auto-detected)
─────────────────────────────────────────────────────────────
Self score:        7.2 / 10
Adversarial score: 5.8 / 10    Divergence: -1.4
Verdict:           INFLATED ▼

Most inflated dimensions:
  testing    self: 7.8  adv: 5.1  (-2.7)  "tests exist but don't cover failure paths"
  security   self: 7.5  adv: 5.3  (-2.2)  "input validation bypassed via MCP route"
```

## Verdict Thresholds

| Verdict | Divergence | Meaning |
|---------|-----------|---------|
| `trusted` | \|div\| ≤ 0.5 | Self-score and adversary agree — reliable signal |
| `watch` | -1.5 < div < -0.5 | Mild inflation — review flagged dimensions |
| `inflated` | div ≤ -1.5 | Significant inflation — do NOT declare victory |
| `underestimated` | div ≥ +1.0 | You're underselling — adversary is more optimistic |

## Provider Setup

```bash
# Enable adversarial scoring (done during `danteforge init`)
danteforge init

# Or manually in ~/.danteforge/config.yaml:
# adversary:
#   enabled: true
#   provider: grok          # optional: explicit adversary provider
#   model: grok-3-mini      # optional: model override
#   apiKey: xai-...         # optional: adversary-specific billing key
#   tolerance: 0.5          # optional: acceptable gap before 'inflated' verdict
```

## Ascend Integration

When `--adversarial-gating` is active, `danteforge ascend` will NOT declare convergence
until the adversarial score also meets the target (minus tolerance):

```
[Ascend] Self-score target reached but adversarial gate not passed.
  Self: 9.1 / Adv: 8.2 / Required: 8.5
[Ascend] Continuing to improve...
```

This prevents the loop from stopping at a self-congratulatory plateau.

## MCP Tool (for coding assistants)

When DanteForge is wired as an MCP server, invoke via:

```json
{
  "tool": "danteforge_adversarial_score",
  "arguments": {
    "cwd": "/path/to/project",
    "summaryOnly": false
  }
}
```

Returns the full `AdversarialScoreResult` including divergence, verdict, and per-dimension scores.
