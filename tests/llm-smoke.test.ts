import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { probeLLMProvider, callLLM, isLLMAvailable } from '../src/core/llm.js';
import { resetAllCircuits } from '../src/core/circuit-breaker.js';

// These tests only run when Ollama is available locally.
// They early-return (pass silently) when Ollama is not running.

describe('LLM smoke tests (Ollama)', () => {
  let skipReason: string | undefined;
  let tempHome: string;

  before(async () => {
    resetAllCircuits();
    // Create temp home to avoid polluting real state
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'df-smoke-'));
    const dfDir = path.join(tempHome, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(path.join(dfDir, 'STATE.yaml'), [
      'project: smoke-test',
      `created: ${new Date().toISOString()}`,
      'workflowStage: forge',
      'currentPhase: 1',
      'lastHandoff: none',
      'profile: balanced',
      'tasks: {}',
      'gateResults: {}',
      'auditLog: []',
    ].join('\n'));

    try {
      const probe = await probeLLMProvider('ollama');
      if (!probe.ok) {
        skipReason = `Ollama unavailable: ${probe.message}`;
      }
    } catch (err) {
      skipReason = `Ollama probe failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  after(async () => {
    await fs.rm(tempHome, { recursive: true, force: true }).catch(() => {});
  });

  it('probeLLMProvider resolves with ok=true and model name', async () => {
    if (skipReason) { console.log(`SKIP: ${skipReason}`); return; }
    const probe = await probeLLMProvider('ollama');
    assert.equal(probe.ok, true, 'Ollama probe should succeed');
    assert.ok(probe.model, 'Should resolve a model name');
    assert.ok(typeof probe.model === 'string' && probe.model.length > 0, 'Model name should be non-empty string');
  });

  it('isLLMAvailable returns true when Ollama is running', async () => {
    if (skipReason) { console.log(`SKIP: ${skipReason}`); return; }
    const available = await isLLMAvailable();
    assert.equal(available, true, 'LLM should be available');
  });

  it('callLLM returns non-empty response from Ollama', async () => {
    if (skipReason) { console.log(`SKIP: ${skipReason}`); return; }
    const result = await callLLM(
      'Reply with exactly the word "pong" and nothing else.',
      'ollama',
      { recordMemory: false, cwd: tempHome },
    );
    assert.ok(typeof result === 'string', 'Result should be a string');
    assert.ok(result.length > 0, 'Result should be non-empty');
    // Don't assert exact content — LLMs are non-deterministic
  });
});
