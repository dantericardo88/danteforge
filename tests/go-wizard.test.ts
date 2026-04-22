import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runGoWizard } from '../src/core/go-wizard.js';
import type { GoWizardOptions } from '../src/core/go-wizard.js';

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

describe('go-wizard', () => {
  it('returns null and emits helpful message in non-TTY environment', async () => {
    const lines: string[] = [];
    const result = await runGoWizard({
      _isTTY: false,
      _stdout: (l) => lines.push(l),
    });
    assert.strictEqual(result, null);
    assert.match(lines.join('\n'), /init --guided|Non-interactive/i);
  });

  it('returns WizardAnswers with beginner defaults populated', async () => {
    const result = await runGoWizard(makeOpts([
      'A CLI tool for code review',
      '2',
      '3',
    ]));
    assert.ok(result !== null);
    assert.strictEqual(result.description, 'A CLI tool for code review');
    assert.strictEqual(result.projectType, 'CLI');
    assert.deepStrictEqual(result.competitors, []);
    assert.strictEqual(result.provider, 'ollama');
    assert.strictEqual(result.qualityTarget, 9.0);
    assert.strictEqual(result.preferredLevel, 'magic');
    assert.strictEqual(result.startMode, 'later');
  });

  it('defaults to magic and offline when user hits Enter on all prompts', async () => {
    const result = await runGoWizard(makeOpts(['', '', '']));
    assert.ok(result !== null);
    assert.strictEqual(result.preferredLevel, 'magic');
    assert.strictEqual(result.startMode, 'offline');
  });

  it('maps work style choices to preferred levels', async () => {
    const spark = await runGoWizard(makeOpts(['desc', '1', '1']));
    const inferno = await runGoWizard(makeOpts(['desc', '3', '1']));
    assert.strictEqual(spark?.preferredLevel, 'spark');
    assert.strictEqual(inferno?.preferredLevel, 'inferno');
  });

  it('maps start choices to live and later modes', async () => {
    const live = await runGoWizard(makeOpts(['desc', '2', '2']));
    const later = await runGoWizard(makeOpts(['desc', '2', '3']));
    assert.strictEqual(live?.startMode, 'live');
    assert.strictEqual(later?.startMode, 'later');
  });

  it('emits progress lines during the wizard', async () => {
    const lines: string[] = [];
    await runGoWizard({
      _isTTY: true,
      _askQuestion: makeAnswerSequence(['desc', '1', '2']),
      _stdout: (l) => lines.push(l),
    });
    const text = lines.join('\n');
    assert.match(text, /DanteForge - New Project Setup/i);
    assert.match(text, /1\/3/);
    assert.match(text, /3\/3/);
  });
});
