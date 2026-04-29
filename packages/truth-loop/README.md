# @danteforge/truth-loop

Portable Truth Loop schemas, ID helpers, and proof helpers for evidence-backed agent workflows.

This package is the public v1 surface for the six irreducible Truth Loop records:

- `Run`
- `Artifact`
- `Evidence`
- `Verdict`
- `NextAction`
- `BudgetEnvelope`

It intentionally stays small. Runtime orchestration still lives in DanteForge, while DanteCode, DanteAgents, and future hosts can share the same record shapes and proof helpers.

## Install

```bash
npm install @danteforge/truth-loop @danteforge/evidence-chain
```

## Usage

```ts
import { nextRunId, proofArtifact, type Artifact } from '@danteforge/truth-loop';
import { verifyBundle } from '@danteforge/evidence-chain';

const runId = nextRunId(process.cwd());
const artifact: Artifact = {
  artifactId: 'artifact_001',
  runId,
  type: 'repo_snapshot',
  source: 'repo',
  createdAt: new Date().toISOString(),
  uri: '.danteforge/truth-loop/run/artifacts/repo.json',
  hash: '0'.repeat(64),
};

const proofed = proofArtifact(artifact, 'abc123');
const verified = verifyBundle(proofed.proof!);
```

## Stability

The v1 schema names and required fields are stable for the 1.x line. Optional fields may be added as the Truth Loop gains richer causal metadata.

## License

MIT
