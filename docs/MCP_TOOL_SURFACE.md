# DanteForge MCP Quality-Gate Tool Surface

Status: Forge v1.1 substrate contract  
Scope: the seven MCP tools that external coding hosts should treat as quality-gate surfaces. The MCP server exposes additional workflow and discovery tools; this document only freezes the quality-gate subset that DanteCode, DanteAgents, Cursor, Aider, Claude Code, and similar hosts can depend on.

## Shared Rules

- Tool responses are JSON-serializable MCP content.
- Read-only tools may run without confirmation. Mutating or expensive tools require explicit parameters such as `confirm: true`.
- Evidence-bearing outputs should be anchored through `@danteforge/evidence-chain` receipts or Time Machine commits when persisted by the caller.
- Missing files, invalid proof envelopes, or failed gates should be treated as blockers, not warnings, by autonomous callers.

## `danteforge_score`

Purpose: score one PDSE artifact such as `CONSTITUTION`, `SPEC`, `CLARIFY`, `PLAN`, or `TASKS`.

Params:

```json
{ "artifact": "SPEC" }
```

Return shape:

```json
{
  "artifact": "SPEC",
  "score": 8.7,
  "summary": "..."
}
```

Errors:

- Unknown artifact name.
- Artifact file missing or unreadable.

Example call:

```json
{ "tool": "danteforge_score", "arguments": { "artifact": "PLAN" } }
```

Proof/evidence emitted: caller should wrap the score response with `createReceipt({ action: "mcp.danteforge_score", payload })` if it will be used in a promotion decision.

## `danteforge_score_all`

Purpose: score all PDSE artifacts found on disk.

Params:

```json
{}
```

Return shape:

```json
{
  "scores": {
    "CONSTITUTION": 9.1,
    "SPEC": 8.9,
    "PLAN": 9.0
  },
  "overall": 9.0
}
```

Errors:

- Workspace cannot be read.
- No recognized artifacts exist.

Example call:

```json
{ "tool": "danteforge_score_all", "arguments": {} }
```

Proof/evidence emitted: suitable as an evidence bundle leaf for a gate check or quality certificate.

## `danteforge_gate_check`

Purpose: check one workflow gate such as `requireConstitution`, `requireSpec`, `requireClarify`, `requirePlan`, `requireTests`, or `requireDesign`.

Params:

```json
{ "gate": "requirePlan" }
```

Return shape:

```json
{
  "gate": "requirePlan",
  "passed": true,
  "reason": "PLAN exists and is readable"
}
```

Errors:

- Unknown gate.
- Workspace read failure.

Example call:

```json
{ "tool": "danteforge_gate_check", "arguments": { "gate": "requireTests" } }
```

Proof/evidence emitted: gate checks are mechanical evidence and can be persisted as `Evidence.kind = "file_inspection"` or `Evidence.kind = "test_result"` depending on the gate.

## `danteforge_verify`

Purpose: run project verification checks. This is an execution surface and requires confirmation.

Params:

```json
{ "confirm": true }
```

Return shape:

```json
{
  "status": "passed",
  "checks": ["typecheck", "lint", "anti-stub", "tests"],
  "summary": "Verification passed"
}
```

Errors:

- `confirm` is missing or false.
- Any verification step fails.
- Verification times out.

Example call:

```json
{ "tool": "danteforge_verify", "arguments": { "confirm": true } }
```

Proof/evidence emitted: verification output should be committed to Time Machine or wrapped in a receipt before being used as release evidence.

## `danteforge_assess`

Purpose: run the canonical harsh assessment for the current project or a provided directory.

Params:

```json
{ "cwd": "C:/Projects/DanteForge" }
```

Return shape:

```json
{
  "overall": 9.3,
  "dimensions": {
    "tokenEconomy": 9.5,
    "developerExperience": 9.0
  },
  "gitSha": "abc123"
}
```

Errors:

- Target directory is missing.
- Scorer cannot inspect the repository.

Example call:

```json
{ "tool": "danteforge_assess", "arguments": { "cwd": "C:/Projects/DanteCode" } }
```

Proof/evidence emitted: assessment output is a canonical candidate for `createReceipt({ action: "mcp.danteforge_assess", payload })`.

## `danteforge_quality_certificate`

Purpose: generate a tamper-evident quality certificate from the current convergence state.

Params:

```json
{ "cwd": "C:/Projects/DanteForge" }
```

Return shape:

```json
{
  "certificateId": "quality_...",
  "overall": 9.3,
  "evidenceFingerprint": "sha256:...",
  "gitSha": "abc123"
}
```

Errors:

- Convergence state missing.
- Evidence fingerprint cannot be computed.

Example call:

```json
{ "tool": "danteforge_quality_certificate", "arguments": { "cwd": "." } }
```

Proof/evidence emitted: certificate payloads should be stored as evidence-chain receipts and can become Time Machine commit entries.

## `danteforge_adversarial_score`

Purpose: challenge the current self-score with an independent adversarial model or configured scorer. Use it before declaring a feature or substrate complete.

Params:

```json
{
  "cwd": "C:/Projects/DanteForge",
  "summaryOnly": true,
  "dimensions": ["tokenEconomy", "developerExperience"]
}
```

Return shape:

```json
{
  "selfScore": 9.3,
  "adversarialScore": 8.8,
  "verdict": "watch",
  "inflatedDimensions": ["developerExperience"]
}
```

Errors:

- Adversarial provider is unavailable.
- Requested dimension is unknown.
- Budget or configuration blocks live scoring.

Example call:

```json
{ "tool": "danteforge_adversarial_score", "arguments": { "summaryOnly": true } }
```

Proof/evidence emitted: adversarial outputs are opinions until tied to file/test evidence. Persist them as external critique artifacts, not final truth.

## Caller Checklist

- Verify evidence bundles with `verifyBundle` before promotion.
- Aggregate multi-agent child receipts with `aggregateChildReceipts` before a parent workflow claims completion.
- Use Time Machine commits for long-lived artifacts that may need restoration or causal query.
- Treat `communityAdoption` as distribution evidence. MCP tool availability alone does not prove public adoption.
