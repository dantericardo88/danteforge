# @danteforge/three-way-gate

Portable DanteForge promotion gate for policy, evidence-chain, and harsh-score checks.

The gate is deliberately narrow:

- `forge_policy` catches policy-level blockers.
- `evidence_chain` requires verifiable proof envelopes.
- `harsh_score` requires the selected score dimensions to meet the production threshold or an explicit structural cap.

## Install

```bash
npm install @danteforge/three-way-gate @danteforge/truth-loop @danteforge/evidence-chain
```

## Usage

```ts
import { evaluateThreeWayGate, PRODUCTION_THRESHOLD } from '@danteforge/three-way-gate';

const result = evaluateThreeWayGate({
  artifacts: [proofedArtifact],
  scores: { tokenEconomy: 9.1 },
  requiredDimensions: ['tokenEconomy'],
  gitSha: 'abc123',
});

if (result.overall !== 'green') {
  throw new Error(result.blockingReasons.join('\n'));
}
```

## Stability

The public v1 evaluator and result shapes are stable for the 1.x line. Future releases may add optional gate metadata, but promotion semantics remain fail-closed when proof evidence is absent or invalid.

## License

MIT
