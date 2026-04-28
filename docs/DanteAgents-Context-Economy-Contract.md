# DanteAgents Context Economy Contract

This contract applies to DanteForge executor and party flows that feed command output, repair context, or artifact context into an LLM.

## Required Runtime

All command-like output must enter prompts through:

```ts
filterShellResult({ command, stdout, stderr, cwd, organ })
```

All `.danteforge/` artifacts read for tool or prompt context must enter through:

```ts
getEconomizedArtifactForContext({ path, type, cwd })
```

The raw artifact remains the source of truth on disk. Economized views carry `rawHash`, original/compressed byte sizes, savings percentage, and sacred span count.

## Sacred Bypass

These categories must bypass compression and remain byte-preserved:

- failed tests and typecheck errors
- stack traces
- warnings
- audit and security findings
- policy/gate failures
- rejected patches or failed apply output

The ledger status must be `sacred-bypass` when this happens.

## DanteAgents Flow Coverage

- Forge executor repair prompts call `runProjectTests` and `formatErrorsForLLM`; `runProjectTests` now filters through `filterShellResult` before returning stdout/stderr.
- `runTypecheck` uses the same facade before typecheck output can enter repair context.
- MCP `danteforge_artifact_read` returns economized artifact context plus raw hash metadata.
- SDK exports the facade and ledger summary contracts for DanteAgents, DanteForgeEngine, and DanteCode integrations.

## Regression Tests

Current test coverage:

- `tests/context-economy-runtime.test.ts`
- `tests/test-runner.test.ts`
- `tests/mcp-handlers.test.ts`
- `tests/economy-cli.test.ts`
- `tests/context-economy-score.test.ts`

The key contract assertions are:

- noisy passing stdout can be filtered before repair context;
- sacred failure stderr remains byte-identical;
- MCP artifact reads compress large context views without mutating raw artifacts;
- `danteforge economy --since` filters by timestamp;
- `--fail-below` gates the Context Economy score, not average savings percent;
- file presence alone cannot max the Context Economy score.
