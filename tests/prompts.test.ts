import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectProvider,
  selectPreset,
  confirmDestructive,
  inputWithDefault,
} from '../src/core/prompts.js';

// All functions short-circuit to defaults in non-TTY environments (CI/test)

describe('selectProvider: non-TTY fallback', () => {
  it('returns default provider when no default given', async () => {
    const result = await selectProvider();
    assert.equal(result, 'ollama');
  });

  it('returns specified default provider', async () => {
    const result = await selectProvider('claude');
    assert.equal(result, 'claude');
  });

  it('returns openai when specified', async () => {
    const result = await selectProvider('openai');
    assert.equal(result, 'openai');
  });
});

describe('selectPreset: non-TTY fallback', () => {
  it('returns default preset when no default given', async () => {
    const result = await selectPreset();
    assert.equal(result, 'magic');
  });

  it('returns specified default preset', async () => {
    const result = await selectPreset('spark');
    assert.equal(result, 'spark');
  });

  it('returns inferno when specified', async () => {
    const result = await selectPreset('inferno');
    assert.equal(result, 'inferno');
  });
});

describe('confirmDestructive: non-TTY fallback', () => {
  it('returns false in non-TTY (safe default)', async () => {
    const result = await confirmDestructive('delete all files');
    assert.equal(result, false);
  });
});

describe('inputWithDefault: non-TTY fallback', () => {
  it('returns the provided default value', async () => {
    const result = await inputWithDefault('Enter project name:', 'my-project');
    assert.equal(result, 'my-project');
  });

  it('returns empty string default when given empty string', async () => {
    const result = await inputWithDefault('Enter value:', '');
    assert.equal(result, '');
  });
});
