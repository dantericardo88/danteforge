# Spec — truth-loop-diff

## Scope
- TBD (no constraints extracted from conversation)

## Contract
Exact interface contract surfaced as P1 NextAction; depends on chosen approach.

## Behavior under failure
Fail-closed: any unmet acceptance criterion blocks the three-way gate.

## Observability hooks
Evidence emitted to .danteforge/skill-runs/dante-to-prd/<runId>/.

## Security considerations
Inherits Article XII anti-stub enforcement and Article XIV sacred-content rules.
