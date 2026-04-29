# Design — truth-loop-list

## Chosen approach
Approach A — incremental — see tradeoffs below.

## Alternatives considered
### Approach A — incremental
- smaller scope but slower to ship "danteforge truth-loop list" — a CL
- lower risk per increment

### Approach B — big-bang
- faster end-state but higher risk
- requires more upfront design

### Approach C — hybrid
- mixes incremental + big-bang per subsystem
- more coordination overhead

## Rollback path
If chosen approach proves wrong, revert to alternative B or C; partial state captured in evidence chain so the rollback target is concrete.
