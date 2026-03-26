// clarify CLI command — behavioral tests using injection seams
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { clarify } from '../src/cli/commands/clarify.js';

// Reset process.exitCode between tests
let _savedExitCode: number | undefined;
beforeEach(() => { _savedExitCode = process.exitCode as number | undefined; process.exitCode = undefined; });
afterEach(() => { process.exitCode = _savedExitCode; });

describe('clarify CLI command — injection seam tests', () => {
  it('sets exitCode=1 and returns when gate fails', async () => {
    await clarify({
      _runGate: async () => false,
    });
    assert.strictEqual(process.exitCode, 1, 'gate failure should set exitCode=1');
  });

  it('does not set exitCode=1 when gate passes and LLM is unavailable (local fallback)', async () => {
    let writtenName = '';
    let writtenContent = '';
    await clarify({
      _runGate: async () => true,
      _isLLMAvailable: async () => false,
      _writeArtifact: async (name, content) => { writtenName = name; writtenContent = content; },
    });
    assert.strictEqual(process.exitCode, undefined, 'local fallback should not set exitCode');
    assert.strictEqual(writtenName, 'CLARIFY.md', '_writeArtifact should be called with CLARIFY.md');
    assert.ok(writtenContent.length > 0, 'local content should not be empty');
  });

  it('writes CLARIFY.md via LLM when LLM is available and call succeeds', async () => {
    let writtenName = '';
    let writtenContent = '';
    const fakeClarifyContent = '# CLARIFY.md\n\n## Ambiguities\n- None found.\n';
    await clarify({
      _runGate: async () => true,
      _isLLMAvailable: async () => true,
      _callLLM: async (_prompt) => fakeClarifyContent,
      _writeArtifact: async (name, content) => { writtenName = name; writtenContent = content; },
    });
    assert.strictEqual(process.exitCode, undefined, 'LLM success should not set exitCode');
    assert.strictEqual(writtenName, 'CLARIFY.md');
    assert.strictEqual(writtenContent, fakeClarifyContent, 'should write LLM response verbatim');
  });

  it('falls back to local artifact when LLM is available but call throws', async () => {
    let writeCallCount = 0;
    await clarify({
      _runGate: async () => true,
      _isLLMAvailable: async () => true,
      _callLLM: async () => { throw new Error('LLM timeout'); },
      _writeArtifact: async (_name, _content) => { writeCallCount++; },
    });
    assert.strictEqual(process.exitCode, undefined, 'LLM fallback should not set exitCode');
    assert.strictEqual(writeCallCount, 1, '_writeArtifact should be called once via fallback path');
  });

  it('returns early without writing when options.prompt is true', async () => {
    let writeCallCount = 0;
    let isLLMCalled = false;
    await clarify({
      _runGate: async () => true,
      prompt: true,
      _isLLMAvailable: async () => { isLLMCalled = true; return true; },
      _writeArtifact: async () => { writeCallCount++; },
    });
    assert.strictEqual(process.exitCode, undefined);
    assert.strictEqual(writeCallCount, 0, 'prompt mode should not call _writeArtifact');
    assert.strictEqual(isLLMCalled, false, 'prompt mode should not call _isLLMAvailable');
  });
});
