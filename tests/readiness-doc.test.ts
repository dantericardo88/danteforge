import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOperationalReadinessDoc,
  type ReceiptSnapshot,
} from '../src/core/readiness-doc.js';

function makeReceipt(overrides: Partial<ReceiptSnapshot>): ReceiptSnapshot {
  return {
    id: 'verify',
    label: 'Repo verify',
    command: 'npm run verify',
    path: '.danteforge/evidence/verify/latest.json',
    exists: true,
    status: 'pass',
    timestamp: '2026-04-16T18:00:00.000Z',
    version: '0.17.0',
    gitSha: 'abc123',
    detailLines: [],
    ...overrides,
  };
}

describe('operational readiness doc generation', () => {
  it('renders receipt-backed status, proof paths, and regeneration commands', () => {
    const doc = buildOperationalReadinessDoc({
      version: '0.17.0',
      generatedAt: '2026-04-16T18:30:00.000Z',
      currentGitSha: 'fedcba9876543210',
      receiptSnapshots: [
        makeReceipt({}),
        makeReceipt({
          id: 'release',
          label: 'Release proof',
          command: 'npm run release:proof',
          path: '.danteforge/evidence/release/latest.json',
          status: 'warn',
          detailLines: ['Receipt version 0.9.2 does not match the current package version 0.17.0.'],
        }),
        makeReceipt({
          id: 'live',
          label: 'Live verification',
          command: 'npm run verify:live',
          path: '.danteforge/evidence/live/latest.json',
          exists: false,
          status: 'missing',
          timestamp: null,
          version: null,
          gitSha: null,
          detailLines: ['No local receipt was found for this surface.'],
        }),
      ],
      supportedSurfaces: [
        {
          id: 'local-cli',
          label: 'local-only CLI',
          status: 'pass',
          proof: ['.github/workflows/ci.yml', 'scripts/check-cli-smoke.mjs'],
        },
      ],
    });

    assert.match(doc, /Current Git SHA: fedcba9876543210/);
    assert.match(doc, /Generated on 2026-04-16T18:30:00\.000Z from the latest local receipt snapshots/i);
    assert.match(doc, /\.danteforge\/evidence\/verify\/latest\.json/);
    assert.match(doc, /\.danteforge\/evidence\/release\/latest\.json/);
    assert.match(doc, /\.danteforge\/evidence\/live\/latest\.json/);
    assert.match(doc, /Receipt version 0\.9\.2 does not match the current package version 0\.17\.0/i);
    assert.match(doc, /Release proof receipt was captured at abc123, not the current workspace SHA fedcba9876543210/i);
    assert.match(doc, /missing\. Run `npm run verify:live`/i);
    assert.match(doc, /Regenerate this guide with `npm run sync:readiness-doc`/i);
    assert.doesNotMatch(doc, /npm run typecheck\s+# 0 errors/i);
  });
});
