import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  aggregateChildReceipts,
  createEvidenceBundle,
  createReceipt,
  verifyBundle,
  verifyReceipt,
} from '@danteforge/evidence-chain';

describe('@danteforge/evidence-chain aggregateChildReceipts', () => {
  it('verifies child receipts individually and as one aggregate parent bundle', () => {
    const children = [
      createReceipt({
        runId: 'run_package_surface_001',
        action: 'dantecode.edit',
        payload: { repo: 'DanteCode', file: 'packages/core/src/router.ts' },
        createdAt: '2026-04-29T12:00:00.000Z',
      }),
      createReceipt({
        runId: 'run_package_surface_001',
        action: 'danteagents.workflow',
        payload: { repo: 'DanteAgents', task: 'whatsapp_human_veto' },
        createdAt: '2026-04-29T12:01:00.000Z',
        prevHash: 'a'.repeat(64),
      }),
    ];

    assert.ok(children.every(child => verifyReceipt(child).valid));

    const aggregate = aggregateChildReceipts('run_package_surface_001', children);
    const aggregateCheck = verifyBundle(aggregate);

    assert.equal(aggregateCheck.valid, true);
    assert.equal(aggregate.runId, 'run_package_surface_001');
    assert.equal(aggregate.bundleId, 'aggregate_run_package_surface_001');
    assert.equal(aggregate.evidence.length, children.length);
  });

  it('fails verification when an embedded child receipt is tampered', () => {
    const child = createReceipt({
      runId: 'run_tamper_001',
      action: 'codex.patch',
      payload: { changed: 'time-machine' },
      createdAt: '2026-04-29T12:00:00.000Z',
    });
    const aggregate = aggregateChildReceipts('run_tamper_001', [child]);

    aggregate.evidence[0]!.payloadHash = 'f'.repeat(64);

    const result = verifyBundle(aggregate);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /payloadHash|evidenceHashes|merkleRoot/);
  });

  it('can anchor a higher-level evidence bundle for sister-repo workflows', () => {
    const child = createReceipt({
      runId: 'run_parent_001',
      action: 'danteforge.verify',
      payload: { status: 'green' },
      createdAt: '2026-04-29T12:00:00.000Z',
    });
    const aggregate = aggregateChildReceipts('run_parent_001', [child]);
    const parent = createEvidenceBundle({
      runId: 'run_parent_001',
      bundleId: 'sister_repo_parent',
      prevHash: aggregate.hash,
      evidence: [{ aggregate }],
      createdAt: '2026-04-29T12:05:00.000Z',
    });

    assert.equal(verifyBundle(aggregate).valid, true);
    assert.equal(verifyBundle(parent).valid, true);
    assert.equal(parent.prevHash, aggregate.hash);
  });
});
