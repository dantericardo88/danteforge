// Tests for src/core/go-wizard.ts (Sprint 50)
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runGoWizard } from '../src/core/go-wizard.js';
import type { GoWizardOptions } from '../src/core/go-wizard.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAnswerSequence(answers: string[]): () => Promise<string> {
  let idx = 0;
  return async () => answers[idx++] ?? '';
}

function makeOpts(answers: string[], overrides: Partial<GoWizardOptions> = {}): GoWizardOptions {
  return {
    _isTTY: true,
    _askQuestion: makeAnswerSequence(answers),
    _stdout: () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('go-wizard', () => {
  it('returns null and emits helpful message in non-TTY environment', async () => {
    const lines: string[] = [];
    const result = await runGoWizard({
      _isTTY: false,
      _stdout: (l) => lines.push(l),
    });
    assert.strictEqual(result, null, 'should return null in non-TTY');
    const text = lines.join('\n');
    assert.ok(text.includes('danteforge init --guided') || text.includes('Non-interactive'), 'should suggest guided init');
  });

  it('returns WizardAnswers with all 5 fields populated', async () => {
    const result = await runGoWizard(makeOpts([
      'A CLI tool for code review',  // Q1 description
      '1',                            // Q2 CLI
      'aider, gpt-engineer',          // Q3 competitors
      '2',                            // Q4 claude
      '3',                            // Q5 9.0
    ]));
    assert.ok(result !== null);
    assert.strictEqual(result.description, 'A CLI tool for code review');
    assert.strictEqual(result.projectType, 'CLI');
    assert.deepStrictEqual(result.competitors, ['aider', 'gpt-engineer']);
    assert.strictEqual(result.provider, 'claude');
    assert.strictEqual(result.qualityTarget, 9.0);
  });

  it('defaults to CLI, ollama, 9.0 when user hits Enter on all prompts', async () => {
    const result = await runGoWizard(makeOpts(['', '', '', '', '']));
    assert.ok(result !== null);
    assert.strictEqual(result.projectType, 'CLI');
    assert.strictEqual(result.provider, 'ollama');
    assert.strictEqual(result.qualityTarget, 9.0);
  });

  it('parses named project type inputs (not just numbers)', async () => {
    const result = await runGoWizard(makeOpts(['desc', 'Agent', 'gpt-engineer', '1', '2']));
    assert.ok(result !== null);
    assert.strictEqual(result.projectType, 'Agent');
    assert.strictEqual(result.qualityTarget, 8.5);
  });

  it('handles empty competitors string gracefully', async () => {
    const result = await runGoWizard(makeOpts(['My project', '3', '', '1', '1']));
    assert.ok(result !== null);
    assert.deepStrictEqual(result.competitors, []);
    assert.strictEqual(result.projectType, 'Web');
    assert.strictEqual(result.qualityTarget, 8.0);
  });

  it('emits progress lines to _stdout during wizard', async () => {
    const lines: string[] = [];
    await runGoWizard({
      _isTTY: true,
      _askQuestion: makeAnswerSequence(['desc', '1', '', '1', '3']),
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.ok(text.includes('DanteForge') || text.includes('Setup'), 'should emit header');
    assert.ok(text.includes('1/5') || text.includes('2/5'), 'should emit step numbers');
  });
});
