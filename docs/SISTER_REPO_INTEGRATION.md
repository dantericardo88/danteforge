# Sister Repo Integration

Status: Forge v1.1 substrate contract  
Applies to: DanteCode v2, DanteAgents v1, future DanteComposer-style hosts

Forge now exposes three portable package surfaces plus MCP and Time Machine contracts. The goal is one shared spine with specialized organs, not a monolith.

## Packages

### `@danteforge/evidence-chain` v1.1.0

Use for tamper-evident receipts, hash chains, Merkle bundles, and parent proofs.

```ts
import {
  aggregateChildReceipts,
  createReceipt,
  verifyBundle,
} from '@danteforge/evidence-chain';

const editReceipt = createReceipt({
  runId: 'run_20260429_001',
  action: 'dantecode.edit',
  payload: { repo: 'DanteCode', file: 'packages/core/src/router.ts' },
  gitSha: 'abc123',
});

const reviewReceipt = createReceipt({
  runId: 'run_20260429_001',
  action: 'claude.review',
  payload: { verdict: 'approved_with_notes' },
  gitSha: 'abc123',
});

const parentProof = aggregateChildReceipts('run_20260429_001', [editReceipt, reviewReceipt]);
if (!verifyBundle(parentProof).valid) throw new Error('Parent proof failed');
```

Use this whenever child agents, sister repos, or tool calls need to be folded into one parent claim.

### `@danteforge/truth-loop` v1.0.0

Use for shared Truth Loop types and proof helpers.

```ts
import {
  proofArtifact,
  proofVerdict,
  type Artifact,
  type Verdict,
} from '@danteforge/truth-loop';

const artifact: Artifact = {
  artifactId: 'artifact_repo_snapshot',
  runId: 'run_20260429_001',
  type: 'repo_snapshot',
  source: 'repo',
  createdAt: new Date().toISOString(),
  uri: '.danteforge/truth-loop/run/artifacts/repo.json',
  hash: '0'.repeat(64),
};

const proofedArtifact = proofArtifact(artifact, 'abc123');
```

DanteCode should use these records for implementation handoff evidence. DanteAgents should use them for long-running workflow verdicts and human-veto checkpoints.

### `@danteforge/three-way-gate` v1.0.0

Use when a sister repo wants the same promotion semantics as Forge.

```ts
import { evaluateThreeWayGate } from '@danteforge/three-way-gate';

const gate = evaluateThreeWayGate({
  artifacts: [proofedArtifact],
  scores: { autonomy: 9.2 },
  requiredDimensions: ['autonomy'],
  gitSha: 'abc123',
});

if (gate.overall !== 'green') {
  throw new Error(gate.blockingReasons.join('\n'));
}
```

The gate fails closed when a proof envelope is missing, invalid, or bound to the wrong git SHA.

## DanteCode v2 Contract

DanteCode should consume Forge as the verification substrate while owning code edits and IDE/runtime behavior.

Recommended integration points:

- Create one evidence-chain receipt per meaningful edit, test run, model critique, and slash-command result.
- Use `aggregateChildReceipts` to fold Codex/Claude/Kilo child work into a parent run proof.
- Use `@danteforge/truth-loop` records for implementation handoffs and critique imports.
- Use `@danteforge/three-way-gate` before claiming a feature is complete.
- Call DanteForge MCP quality-gate tools documented in [MCP_TOOL_SURFACE.md](./MCP_TOOL_SURFACE.md).
- Store long-lived handoff packets in Time Machine when restoration or causal query may matter.

Do not let DanteCode become the final truth judge. It should produce artifacts; Forge verifies them.

## DanteAgents v1 Contract

DanteAgents should consume Forge as the governed execution proof layer while owning long-running operations, browser/desktop/tool execution, and human veto loops.

Recommended integration points:

- Emit a receipt per tool call, human checkpoint, external side effect, and workflow verdict.
- Aggregate child operator receipts into one parent workflow proof.
- Use Truth Loop `Verdict` records for workflow status and rejected/unsupported claim traces.
- Use Time Machine commits for reversible workflow evidence bundles.
- Use MCP `danteforge_verify`, `danteforge_assess`, and `danteforge_quality_certificate` before promoting autonomous workflow outputs.

Do not let DanteAgents bypass founder-gated operations. Human approval remains explicit.

## Time Machine Surfaces

Sister repos can rely on the CLI and library behavior established by Forge:

- `danteforge time-machine commit --path <fileOrDir> --label <label>`
- `danteforge time-machine verify`
- `danteforge time-machine restore --commit <id> --out <dir>`
- `danteforge time-machine query --commit <id> --kind evidence|dependents|file-history --path <path>`
- `danteforge time-machine validate --class A,B,C,D,E,F,G --delegate52-mode harness`

Restore defaults to an output directory. Destructive working-tree restore remains explicitly gated.

## Founder-Gated Status

These are prepared or documented, but not complete until Ricky performs or approves them:

- live DELEGATE-52 spend/run: `founder_gated_pending`
- npm publication: `founder_gated_pending`
- arXiv submission: `founder_gated_pending`
- Microsoft outreach email send: `founder_gated_pending`
- Sean Lippay actual outreach send: `founder_gated_pending`
- Article XIV formal ratification: `founder_gated_pending`
- 5-10 founder-rated Truth Loop runs: `founder_gated_pending`

## Community Adoption Note

`communityAdoption` is a distribution dimension, not a substrate dimension. These package surfaces, docs, and MCP contracts make external adoption possible, but they do not prove GitHub stars, npm downloads, public users, videos, posts, or third-party installs. That remains post-v1.1 distribution work.

## Compatibility

Existing DanteForge internal imports from `src/spine/truth_loop/*` and `src/spine/three_way_gate.ts` remain compatibility adapters over the packages. New sister-repo work should import from the packages directly.
