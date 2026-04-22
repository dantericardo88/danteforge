import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DANTEFORGE_VERSION, generatedByLine } from '../src/core/version.js';

describe('DANTEFORGE_VERSION', () => {
  it('is a non-empty string', () => {
    assert.ok(typeof DANTEFORGE_VERSION === 'string' && DANTEFORGE_VERSION.length > 0);
  });

  it('matches semver format', () => {
    assert.match(DANTEFORGE_VERSION, /^\d+\.\d+\.\d+/);
  });
});

describe('generatedByLine', () => {
  it('contains the version number', () => {
    const line = generatedByLine();
    assert.ok(line.includes(DANTEFORGE_VERSION));
  });

  it('contains DanteForge branding', () => {
    const line = generatedByLine();
    assert.ok(line.includes('DanteForge'));
  });

  it('is a non-empty string', () => {
    assert.ok(generatedByLine().length > 0);
  });
});
