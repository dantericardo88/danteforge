import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { withErrorBoundary } from '../src/core/cli-error-boundary.js';

describe('withErrorBoundary — newly wrapped commands', () => {
  it('sets exitCode=1 when wrapped function throws', async () => {
    const original = process.exitCode;
    try {
      process.exitCode = 0;
      await withErrorBoundary('test-cmd', async () => {
        throw new Error('test error');
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = original;
    }
  });

  it('does not set exitCode when function succeeds', async () => {
    const original = process.exitCode;
    try {
      process.exitCode = 0;
      await withErrorBoundary('test-cmd', async () => {});
      assert.equal(process.exitCode, 0);
    } finally {
      process.exitCode = original;
    }
  });

  it('handles non-Error throws gracefully', async () => {
    const original = process.exitCode;
    try {
      process.exitCode = 0;
      await withErrorBoundary('test-cmd', async () => {
        throw 'string error';
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = original;
    }
  });
});
