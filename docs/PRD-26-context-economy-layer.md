# PRD-26: Dante Context Economy Layer

**Status:** Ready for build after Article XIV ratification
**Owner:** DanteForge ecosystem
**Constitution:** Article XIV: Context Economy
**Harsh scorer dimension:** `contextEconomy`
**Harvest source:** RTK patterns, MIT, commit `80a6fe606f73b19e52b0b330d242e62a6c07be42`
**Language constraint:** TypeScript primary, Python shim where Python organs need native integration. No Rust dependency.
**Estimate:** 2-3 days of agent-orchestrated work at demonstrated build rate.

## Problem

DanteForge, DanteCode, and DanteAgents already estimate tokens, route work by cost, compact some transcripts, or track budgets. They do not yet share a constitutional economy layer that filters verbose tool output before context entry, compresses evidence at write time, preserves sacred content fail-closed, and emits a common savings ledger. This makes context cost invisible and lets boilerplate compete with signal inside LLM windows.

## Goals

1. Reduce tokens by 60%+ on tracked verbose commands without losing sacred content.
2. Compress `.danteforge/` evidence artifacts at write time by 40%+ where safe.
3. Preserve errors, warnings, violations, promotion gate failures, and security findings with zero information loss.
4. Emit token-savings telemetry to `.danteforge/evidence/context-economy/`.
5. Raise DanteForge, DanteCode, and DanteAgents to 7.0+ on `contextEconomy`.

## Non-Goals

- Do not install RTK as a dependency.
- Do not bundle Rust into the Dante stack.
- Do not implement PRD-26 during the harvest pass.
- Do not rewrite existing organs retroactively before Article XIV and this PRD are accepted.
- Do not use lossy compression for sacred content.

## Product Shape

PRD-26 ships one shared primitive, one CLI/reporting surface, one evidence-compression layer, and ten command filters.

### Shared Primitive

Create `src/core/context-economy/` in DanteForge with a packageable TypeScript core:

- `pretool-adapter.ts`: command inspection and rewrite/passthrough decision.
- `command-filter-registry.ts`: maps command families to filter modules.
- `sacred-content.ts`: detects and protects sacred content.
- `economy-ledger.ts`: writes local JSONL telemetry.
- `artifact-compressor.ts`: compresses `.danteforge/` artifacts at write time.
- `types.ts`: shared contracts for filters, artifacts, telemetry, and sacred spans.

Python organs receive a thin Python adapter with the same JSON contract. The Python layer calls the shared CLI contract and does not reimplement command logic unless the organ is Python-only.

### PreToolUse Pattern

The adapter must support Claude Code, Codex, and DanteAgents tool loops:

1. Receive a pending command plus tool metadata.
2. Identify whether the command is filterable.
3. Return a wrapped command when a safe filter exists.
4. Return passthrough when no filter exists, when shell form is unsafe to rewrite, or when trust rules fail.
5. Emit a telemetry record for filtered, passthrough, low-yield, sacred-bypass, and failed-filter outcomes.

Fail-closed rule: if command parsing, filtering, or telemetry fails, the original command output enters context unchanged and the failure is recorded.

## Top Ten Command Filters

| Command | Required filter behavior | Sacred content |
|---|---|---|
| `git` | Compact `status`, `diff`, `log`, `show`; summarize file lists; preserve hunks when requested. | conflict markers, rejected patches, failed merges, auth errors |
| `cargo` | Strip build noise; keep compiler errors, warnings, failing tests, and panic output. | errors, warnings, panics, failing test names |
| `pnpm` | Compact install/list/outdated/test output; remove progress and repeated lifecycle noise. | failed scripts, peer dependency errors, audit/security warnings |
| `npm` | Compact install/list/outdated/test output; remove update notices and progress boilerplate. | failed scripts, audit/security warnings, missing package errors |
| `eslint` | Keep rule id, file, line, severity, message; summarize repeated clean output. | all lint errors and warnings |
| `pytest` | Keep failing tests, tracebacks, assertion diffs, warnings summary; collapse passing-test noise. | tracebacks, assertion diffs, warnings, collection errors |
| `jest` | Keep failing suites, assertion diffs, stack snippets, snapshot failures; compact pass summary. | failed suites, diffs, setup errors |
| `vitest` | Keep failing suites, assertion diffs, stack snippets, unhandled errors; compact pass summary. | failed suites, diffs, unhandled errors |
| `docker` | Compact `ps`, `images`, `logs`; preserve recent logs and error lines. | container failures, daemon errors, security warnings |
| `find` | Summarize large file lists by directory/type; preserve exact matches for narrow queries. | permission errors, missing paths, unexpected traversal failures |

Acceptance for each filter: unit tests with representative noisy output, sacred-output fixtures, passthrough fixture, and at least one telemetry fixture.

## Evidence Chain Compression

All new writes to `.danteforge/` must pass through artifact-type rules:

| Artifact type | Expected footprint | Expected compression ratio | Sacred content |
|---|---:|---:|---|
| audit log | <= 2 KB injected per prompt | 50%+ | failed commands, gate failures, timestamps, actor ids |
| verify output | <= 4 KB when passing; raw when failing | 60%+ on pass output | all failures, stack traces, warnings |
| PRD/spec/plan/task docs | <= 8 KB injected unless explicitly requested raw | 40%+ | acceptance criteria, gates, non-goals |
| OSS harvest notes | <= 10 KB injected unless actively editing | 40%+ | license evidence, citations, excluded claims |
| UPR/current-state summaries | <= 6 KB injected | 50%+ | top gaps, blockers, verification status |
| score reports | <= 4 KB injected | 40%+ | any score below threshold, P0 action items |

Evidence compression must be write-time and reversible by reference: compressed artifacts include a hash pointer to the raw artifact when raw retention is required. Sacred content stays in the compressed copy, not only in the raw copy.

## Telemetry

Write JSONL records under `.danteforge/evidence/context-economy/YYYY-MM-DD.jsonl`:

- timestamp
- organ
- command or artifact type
- filter id
- input token estimate
- output token estimate
- saved tokens
- savings percentage
- sacred span count
- status: `filtered`, `passthrough`, `low-yield`, `sacred-bypass`, `filter-failed`
- rule source: built-in, user, trusted-project
- raw evidence hash when retained

No raw prompts, secrets, command arguments containing secrets, or private file content may be emitted to shared telemetry.

## CLI

Add `danteforge economy`:

- default: human-readable summary of total savings, average savings, top filters, top passthroughs, sacred bypasses, and failures.
- `--json`: machine-readable report for the harsh scorer.
- `--since <date>`: date-windowed report.
- `--organ <forge|code|agents|dojo|harvest>`: organ filter.
- `--fail-below <score>`: exits non-zero when the calculated Context Economy score is below threshold.

## Harsh Scorer Integration

`computeContextEconomyScore()` must read the telemetry ledger and calculate:

1. Filter coverage.
2. Evidence compression.
3. Telemetry emission.
4. Fail-closed compression.
5. Per-type rules.

Each sub-metric scores 0-10 and the dimension score is the average. Production-ready threshold is 7.0+.

## Work Plan

### Day 1: Safety and Adapter

- Build TypeScript contracts and registry.
- Add sacred-content detector and tests.
- Add PreToolUse adapter for command decisioning.
- Implement passthrough telemetry.
- Implement `git`, `npm`, and `pnpm` filters first.

### Day 2: Command Coverage and Evidence

- Implement `cargo`, `eslint`, `pytest`, `jest`, `vitest`, `docker`, and `find`.
- Add `.danteforge/` artifact compressor with per-artifact rules.
- Add JSONL ledger and `danteforge economy --json`.
- Wire score reader to ledger.

### Day 3: Ecosystem Integration and Hardening

- Add DanteCode and DanteAgents adapter docs/contracts.
- Add fail-closed integration tests.
- Add fixture benchmark proving 60%+ command reduction and 40%+ evidence reduction.
- Raise scorer ceiling once evidence exists.

## Acceptance Criteria

- 60%+ token reduction on tracked command fixtures and at least one real local command sample per filter.
- `.danteforge/` artifacts compressed by minimum 40% where safe.
- Zero information loss on sacred content types.
- `danteforge economy --json` emits complete telemetry.
- DanteForge, DanteCode, and DanteAgents baseline remediation reports show 7.0+ on Context Economy after PRD-26 ships.
- Tests are real fixtures and real assertions, not mocks of success.
- No RTK dependency and no Rust component.

## Test Requirements

- Unit tests for every command filter.
- Sacred-content tests for errors, warnings, violations, security findings, and promotion gate failures.
- Artifact compression tests for each artifact type.
- Ledger append/read/report tests.
- Scorer tests for the five sub-metrics.
- Integration test proving filter failure returns raw content.
- Benchmark fixture comparing raw versus filtered token counts.

## Risks

- Over-compression hides actionable evidence. Mitigation: sacred content bypass and fail-closed raw passthrough.
- Telemetry becomes privacy-sensitive. Mitigation: aggregate metrics only, hash raw references, no secrets or raw prompts.
- Generic summarization dilutes the dimension. Mitigation: production threshold requires per-command and per-artifact rules.
