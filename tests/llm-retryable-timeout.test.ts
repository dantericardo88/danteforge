import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { isRetryableError } from '../src/core/llm.js';

test('Pass 49 — provider request timeout messages are retryable', () => {
  assert.equal(
    isRetryableError(new Error('Anthropic Claude request timed out after 120000ms.')),
    true,
  );
});
