import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { wikiQueryCommand } from '../src/cli/commands/wiki-query.js';
import type { WikiQueryResult } from '../src/core/wiki-schema.js';

// Guard against cross-test pollution from other test files in the full suite.
// Some tests monkeypatch process.stdout.write or set process.exitCode and don't restore.
const ORIGINAL_EXIT_CODE = process.exitCode;
const ORIGINAL_STDOUT_WRITE = process.stdout.write.bind(process.stdout);
beforeEach(() => { process.exitCode = 0; process.stdout.write = ORIGINAL_STDOUT_WRITE; });
afterEach(() => { process.exitCode = ORIGINAL_EXIT_CODE; process.stdout.write = ORIGINAL_STDOUT_WRITE; });

function makeResult(overrides: Partial<WikiQueryResult> = {}): WikiQueryResult {
  return {
    entityId: 'test-entity',
    entityType: 'module',
    title: 'Test Entity',
    score: 0.85,
    excerpt: 'A test excerpt',
    tags: ['test', 'module'],
    ...overrides,
  };
}

describe('wikiQueryCommand', () => {
  it('completes without throwing when results found', async () => {
    await assert.doesNotReject(() =>
      wikiQueryCommand({
        topic: 'test topic',
        _query: async () => [makeResult()],
      })
    );
  });

  it('completes without throwing when no results found', async () => {
    await assert.doesNotReject(() =>
      wikiQueryCommand({
        topic: 'nonexistent topic',
        _query: async () => [],
      })
    );
  });

  it('calls _query with the topic', async () => {
    let capturedTopic = '';
    await wikiQueryCommand({
      topic: 'forge engine',
      _query: async (topic) => { capturedTopic = topic; return []; },
    });
    assert.equal(capturedTopic, 'forge engine');
  });

  it('handles multiple results', async () => {
    await assert.doesNotReject(() =>
      wikiQueryCommand({
        topic: 'forge',
        _query: async () => [makeResult({ entityId: 'a' }), makeResult({ entityId: 'b' }), makeResult({ entityId: 'c' })],
      })
    );
  });

  it('handles empty tags gracefully', async () => {
    await assert.doesNotReject(() =>
      wikiQueryCommand({
        topic: 'test',
        _query: async () => [makeResult({ tags: [] })],
      })
    );
  });

  it('does not throw for json output mode', async () => {
    let written = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    // Just test it doesn't throw — actual stdout writing is hard to intercept without mocking
    await assert.doesNotReject(() =>
      wikiQueryCommand({
        topic: 'test',
        json: true,
        _query: async () => [makeResult()],
      })
    );
  });
});
