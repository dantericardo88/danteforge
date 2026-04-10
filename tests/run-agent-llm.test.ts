// run-agent-llm.test.ts — injection seam tests for runAgentPrompt (v0.23.0)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentPrompt } from '../src/harvested/dante-agents/agents/run-agent-llm.js';

describe('runAgentPrompt — injection seam tests', () => {
  it('throws when _isLLMAvailable returns false', async () => {
    await assert.rejects(
      () => runAgentPrompt(
        'TestAgent',
        'test prompt',
        'success!',
        async () => false,
      ),
      (err: Error) => {
        assert.ok(err.message.includes('requires a verified live LLM provider'), `Unexpected error: ${err.message}`);
        return true;
      },
    );
  });

  it('returns LLM response when _isLLMAvailable returns true', async () => {
    const result = await runAgentPrompt(
      'TestAgent',
      'test prompt',
      'success!',
      async () => true,
      async () => 'the llm response',
    );
    assert.equal(result, 'the llm response');
  });

  it('wraps callLLM errors with agent name context', async () => {
    await assert.rejects(
      () => runAgentPrompt(
        'MyAgent',
        'fail prompt',
        'success',
        async () => true,
        async () => { throw new Error('provider unavailable'); },
      ),
      (err: Error) => {
        assert.ok(err.message.includes('MyAgent failed'), `Expected "MyAgent failed" in message: ${err.message}`);
        assert.ok(err.message.includes('provider unavailable'), `Expected original error in message: ${err.message}`);
        return true;
      },
    );
  });
});
