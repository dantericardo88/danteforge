# Matrix Development Engine

Matrix development is DanteForge's safe loop for competitive engineering:

`claim dimension -> run work -> propose score -> locked merge -> Time Machine snapshot -> guard verification`

No agent or command should edit `.danteforge/compete/matrix.json` directly after scoring work. Agents, CLI commands, slash-command workflows, Cursor/Codex/Claude Code sessions, and party lanes must use the same engine.

## Commands

```bash
danteforge matrix status --top 4
danteforge matrix claim --dimension <id-or-number> --agent <tool-name>
danteforge matrix propose --dimension <id-or-number> --score <n> --agent <tool-name> --rationale "<evidence>"
danteforge matrix merge --policy harsh-min
danteforge matrix ascend --dimension <id-or-number> --score <n> --rationale "<evidence>"
```

Compatibility wrapper:

```bash
npm run dimension:ascent -- status --top 4
```

## Concurrency Rules

- Multiple agents may claim the same dimension independently.
- Proposals never rewrite the canonical matrix.
- Only `MatrixDevelopmentEngine.mergeScoreProposals()` writes the matrix.
- Default merge policy is `harsh-min`, so skeptical downgrades beat optimistic progress claims.
- Merge receipts live in `.danteforge/score-proposals/merge-receipts/`.
- The agent guard blocks staged matrix edits without a merge receipt.

## Time Machine

Every score merge creates two Time Machine snapshots:

- before merge: matrix, pending proposals, evidence, and active claims
- after merge: updated matrix, history, and merge receipt

The merge receipt stores proposal IDs, rejected proposals, before/after matrix hashes, and Time Machine commit IDs.
