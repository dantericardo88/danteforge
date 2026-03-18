---
name: ceo-review
domain: architecture
source: gstack-harvest
version: 0.8.0
integrates:
  - specify
  - plan
  - autoforge-loop
  - pdse
---

# CEO Review Skill

## Iron Law
Challenge every goal before building. The 10-star product framework asks: "What would the best possible version of this look like?" This prevents spending 40 forge waves implementing a locally optimal solution to a strategically irrelevant problem.

## Process
1. **Ambiguity Detection**: Scan goal for >= 3 ambiguity signals (maybe, something, probably, etc.)
2. **Auto-Trigger**: If >= 3 signals, automatically apply CEO review
3. **Challenge Questions**: Generate 3–5 hard questions a founder should consider
4. **10-Star Vision**: Describe the ideal implementation
5. **Append**: Add `## CEO Review Notes` section to SPEC.md (non-destructive)

## Ambiguity Signals
something, kind of, maybe, probably, might, could, a bit, somehow, sort of, roughly, approximately, TBD, figure out, not sure, unclear

## PDSE Integration
- Clarity dimension gets +5 bonus (capped) when `## CEO Review Notes` present
- Autoforge auto-triggers CEO review when goal has >= 3 ambiguity signals
