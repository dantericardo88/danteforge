# Dimension Ascent Automation

This is the automated version of the repeated prompt cycle:

1. harshly score the matrix
2. pick the next dimensions
3. focus agents on one dimension
4. ask "is this your best work?"
5. repeat until 9+ or an honest ceiling

## Concurrency Rule

Agents never rewrite `.danteforge/compete/matrix.json` directly after a sprint.
They write score proposals to `.danteforge/score-proposals/`. A single locked
merge applies proposals to the matrix.

This avoids the stale-write problem:

- Agent A reads score 6.0 and proposes 7.5.
- Agent B reads score 6.0 and proposes 8.2.
- Agent C harshly rechecks and proposes 7.0.
- The merge step reloads the current matrix and applies the harsh minimum, 7.0,
  unless an operator explicitly selects `--policy latest`.

## Commands

Show matrix status and next dimensions:

```bash
npm run dimension:ascent -- status --top 4
```

Claim a dimension before work:

```bash
npm run dimension:ascent -- claim --dimension 27 --agent codex-1
```

Write a score proposal after work:

```bash
npm run dimension:ascent -- propose \
  --dimension 27 \
  --score 8.1 \
  --agent codex-1 \
  --rationale "Added benchmark evidence and main-path integration" \
  --evidence ".danteforge/evidence/dim-27.json"
```

Merge all pending proposals under lock:

```bash
npm run dimension:ascent -- merge --policy harsh-min --agent matrix-merger
```

## Prompt Translation

When you ask:

> What would you harshly score the 50 dimension competitive matrix right now?

The agent should:

1. run `npm run dimension:ascent -- status --top 4`
2. run the existing scorer/compete command if it needs fresh evidence
3. write score proposals instead of editing the matrix directly
4. merge only once, under the lock

When you ask:

> Move Dimension 27 long run reasoning to 9+.

The agent should:

1. `claim --dimension 27`
2. run `/inferno`, `/party`, `/oss`, `/ascend`, or focused implementation
3. run `npm run check:agent-guard -- --staged --workstream <workstream>`
4. run `npm run check:file-size`
5. `propose --dimension 27 --score <harsh-score> --rationale <why>`
6. `merge --policy harsh-min`

When you ask:

> What would you harshly score this dimension now. Is this your best work?

The agent should propose the corrected score. If it downgrades itself, the
harsh-min merge policy preserves the downgrade and prevents inflated score drift.

## Bloat Prevention

Dimension ascent is paired with the agent guard:

- `.danteforge/agent-guard.json` freezes kernel files.
- `.danteforge/agent-ownership.json` scopes each workstream.
- `scripts/check-agent-guard.mjs` fails frozen edits, ownership drift, claim file
  commits, partial score updates, and LOC violations.
- `scripts/dimension-ascent.mjs` serializes canonical matrix rewrites.

The result: many agents can improve and score the same dimension, but only one
small locked merge updates the matrix, and no agent has an excuse to bloat a
shared file.
